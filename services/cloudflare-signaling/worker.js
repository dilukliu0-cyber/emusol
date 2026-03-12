import { DurableObject } from "cloudflare:workers";

const MAX_ROOM_MEMBERS = 2;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const cloneRoom = (room) => ({
  id: room.id,
  gameId: room.gameId,
  gameTitle: room.gameTitle,
  romFileName: room.romFileName ?? null,
  platform: room.platform,
  hostUserId: room.hostUserId,
  createdAt: room.createdAt,
  launchedAt: room.launchedAt ?? null,
  members: room.members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    ready: Boolean(member.ready),
    joinedAt: member.joinedAt,
    isHost: member.userId === room.hostUserId,
  })),
});

export class SignalingHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.peers = new Map();
    this.peersByUserId = new Map();
    this.rooms = new Map();

    this.ctx.blockConcurrencyWhile(async () => {
      const storedRooms = (await this.ctx.storage.get("rooms")) ?? [];
      for (const room of Array.isArray(storedRooms) ? storedRooms : []) {
        if (room?.id) {
          this.rooms.set(room.id, cloneRoom(room));
        }
      }

      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() ?? {};
        const peer = {
          socket: ws,
          userId: typeof attachment.userId === "string" ? attachment.userId : null,
          displayName: typeof attachment.displayName === "string" && attachment.displayName ? attachment.displayName : "Player",
          connectedAt:
            typeof attachment.connectedAt === "string" && attachment.connectedAt
              ? attachment.connectedAt
              : new Date().toISOString(),
          roomId: typeof attachment.roomId === "string" && attachment.roomId ? attachment.roomId : null,
        };

        this.peers.set(ws, peer);
        if (peer.userId) {
          this.peersByUserId.set(peer.userId, ws);
        }
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        users: this.getPresenceSnapshot().length,
        rooms: this.rooms.size,
      });
    }

    if (url.pathname !== "/ws") {
      return new Response("Emusol signaling worker is running.", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "GET") {
      return new Response("Expected GET", { status: 405 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const peer = {
      socket: server,
      userId: null,
      displayName: "Player",
      connectedAt: new Date().toISOString(),
      roomId: null,
    };

    this.ctx.acceptWebSocket(server);
    this.setPeerAttachment(server, peer);
    this.peers.set(server, peer);
    this.send(server, { type: "server.ready" });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, rawMessage) {
    const peer = this.peers.get(ws);
    if (!peer || typeof rawMessage !== "string") {
      return;
    }

    try {
      const message = JSON.parse(rawMessage);
      const type = typeof message.type === "string" ? message.type : "";

      switch (type) {
        case "hello":
          await this.handleHello(ws, peer, message);
          break;
        case "room.create":
          await this.handleCreateRoom(peer, message);
          break;
        case "room.join":
          await this.handleJoinRoom(peer, message);
          break;
        case "room.leave":
          await this.leaveRoom(peer);
          break;
        case "room.ready":
          await this.handleSetReady(peer, message);
          break;
        case "invite.send":
          await this.handleSendInvite(peer, message);
          break;
        case "room.launch":
          await this.handleLaunchRoom(peer);
          break;
        case "netplay.signal":
          await this.handleRelaySignal(peer, message);
          break;
        default:
          throw new Error(`Unknown message type: ${type || "empty"}`);
      }
    } catch (error) {
      this.send(ws, {
        type: "error",
        message: error instanceof Error ? error.message : "Signaling error.",
      });
    }
  }

  async webSocketClose(ws) {
    await this.disconnectPeer(ws);
  }

  async webSocketError(ws) {
    await this.disconnectPeer(ws);
  }

  send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  setPeerAttachment(ws, peer) {
    ws.serializeAttachment({
      userId: peer.userId,
      displayName: peer.displayName,
      connectedAt: peer.connectedAt,
      roomId: peer.roomId,
    });
  }

  async persistRooms() {
    await this.ctx.storage.put(
      "rooms",
      Array.from(this.rooms.values()).map((room) => cloneRoom(room)),
    );
  }

  toPresenceUser(peer) {
    return {
      userId: peer.userId,
      displayName: peer.displayName,
      roomId: peer.roomId ?? null,
      connectedAt: peer.connectedAt,
    };
  }

  getPresenceSnapshot() {
    return Array.from(this.peers.values())
      .filter((peer) => Boolean(peer.userId))
      .map((peer) => this.toPresenceUser(peer))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ru"));
  }

  serializeRoom(room) {
    return cloneRoom(room);
  }

  broadcastPresence() {
    const users = this.getPresenceSnapshot();
    for (const ws of this.peers.keys()) {
      this.send(ws, { type: "presence.snapshot", users });
    }
  }

  broadcastRoom(roomId) {
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) {
      return;
    }

    const payload = { type: "room.update", room: this.serializeRoom(room) };
    for (const member of room.members) {
      const memberSocket = this.peersByUserId.get(member.userId);
      if (memberSocket) {
        this.send(memberSocket, payload);
      }
    }
  }

  async disconnectPeer(ws) {
    const peer = this.peers.get(ws);
    if (!peer) {
      return;
    }

    await this.leaveRoom(peer);
    this.peers.delete(ws);

    if (peer.userId && this.peersByUserId.get(peer.userId) === ws) {
      this.peersByUserId.delete(peer.userId);
    }

    this.broadcastPresence();
  }

  async leaveRoom(peer) {
    if (!peer.roomId) {
      return;
    }

    const room = this.rooms.get(peer.roomId);
    const previousRoomId = peer.roomId;
    peer.roomId = null;
    this.setPeerAttachment(peer.socket, peer);

    if (!room) {
      this.send(peer.socket, { type: "room.update", room: null });
      this.broadcastPresence();
      return;
    }

    room.members = room.members.filter((member) => member.userId !== peer.userId);

    if (!room.members.length) {
      this.rooms.delete(previousRoomId);
    } else {
      if (!room.members.some((member) => member.userId === room.hostUserId)) {
        room.hostUserId = room.members[0].userId;
      }
      this.broadcastRoom(previousRoomId);
    }

    await this.persistRooms();
    this.send(peer.socket, { type: "room.update", room: null });
    this.broadcastPresence();
  }

  async attachToRoom(peer, room) {
    await this.leaveRoom(peer);

    room.members.push({
      userId: peer.userId,
      displayName: peer.displayName,
      ready: false,
      joinedAt: new Date().toISOString(),
    });

    peer.roomId = room.id;
    this.setPeerAttachment(peer.socket, peer);
    await this.persistRooms();
    this.broadcastRoom(room.id);
    this.broadcastPresence();
  }

  async handleHello(socket, peer, message) {
    const userId =
      typeof message.userId === "string" && message.userId.trim()
        ? message.userId.trim()
        : createId("user");
    const displayName =
      typeof message.displayName === "string" && message.displayName.trim()
        ? message.displayName.trim().slice(0, 28)
        : "Player";

    const previousSocket = this.peersByUserId.get(userId);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(4001, "This userId is already active.");
    }

    peer.userId = userId;
    peer.displayName = displayName;
    this.peersByUserId.set(userId, socket);
    this.setPeerAttachment(socket, peer);

    this.send(socket, {
      type: "session.welcome",
      selfUserId: userId,
      displayName,
      users: this.getPresenceSnapshot(),
      room: peer.roomId ? this.serializeRoom(this.rooms.get(peer.roomId)) : null,
    });

    this.broadcastPresence();
  }

  async handleCreateRoom(peer, message) {
    if (!peer.userId) {
      throw new Error("Send hello first.");
    }

    const room = {
      id: createId("room"),
      gameId: typeof message.gameId === "string" ? message.gameId : "",
      gameTitle: typeof message.gameTitle === "string" ? message.gameTitle : "Game",
      romFileName:
        typeof message.romFileName === "string" && message.romFileName.trim()
          ? message.romFileName.trim()
          : null,
      platform: typeof message.platform === "string" ? message.platform : "UNKNOWN",
      hostUserId: peer.userId,
      createdAt: new Date().toISOString(),
      launchedAt: null,
      members: [],
    };

    this.rooms.set(room.id, room);
    await this.attachToRoom(peer, room);
  }

  async handleJoinRoom(peer, message) {
    if (!peer.userId) {
      throw new Error("Send hello first.");
    }

    const roomId = typeof message.roomId === "string" ? message.roomId : "";
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found.");
    }

    if (room.members.some((member) => member.userId === peer.userId)) {
      return;
    }

    if (room.members.length >= MAX_ROOM_MEMBERS) {
      throw new Error("Room is full.");
    }

    await this.attachToRoom(peer, room);
  }

  async handleSetReady(peer, message) {
    const room = peer.roomId ? this.rooms.get(peer.roomId) : null;
    if (!room) {
      throw new Error("You are not in a room.");
    }

    const member = room.members.find((entry) => entry.userId === peer.userId);
    if (!member) {
      throw new Error("Room member not found.");
    }

    member.ready = Boolean(message.ready);
    await this.persistRooms();
    this.broadcastRoom(room.id);
  }

  async handleSendInvite(peer, message) {
    if (!peer.userId) {
      throw new Error("Send hello first.");
    }

    const targetUserId = typeof message.toUserId === "string" ? message.toUserId : "";
    const roomId = typeof message.roomId === "string" ? message.roomId : peer.roomId;
    const room = roomId ? this.rooms.get(roomId) : null;
    const targetSocket = this.peersByUserId.get(targetUserId);

    if (!room) {
      throw new Error("Create a room first.");
    }

    if (!targetSocket) {
      throw new Error("Friend is offline right now.");
    }

    this.send(targetSocket, {
      type: "invite.received",
      invite: {
        id: createId("invite"),
        roomId: room.id,
        fromUserId: peer.userId,
        fromDisplayName: peer.displayName,
        gameTitle: room.gameTitle,
        platform: room.platform,
        createdAt: new Date().toISOString(),
      },
    });
  }

  async handleLaunchRoom(peer) {
    const room = peer.roomId ? this.rooms.get(peer.roomId) : null;
    if (!room) {
      throw new Error("You are not in a room.");
    }

    if (room.hostUserId !== peer.userId) {
      throw new Error("Only the host can launch the room.");
    }

    if (room.members.length < 2) {
      throw new Error("A second player is required.");
    }

    if (room.members.some((member) => !member.ready)) {
      throw new Error("Not all players are ready.");
    }

    room.launchedAt = new Date().toISOString();
    await this.persistRooms();
    this.broadcastRoom(room.id);

    for (const member of room.members) {
      const memberSocket = this.peersByUserId.get(member.userId);
      if (memberSocket) {
        this.send(memberSocket, {
          type: "room.launched",
          room: this.serializeRoom(room),
        });
      }
    }
  }

  async handleRelaySignal(peer, message) {
    const room = peer.roomId ? this.rooms.get(peer.roomId) : null;
    if (!room) {
      throw new Error("You are not in a room.");
    }

    for (const member of room.members) {
      if (member.userId === peer.userId) {
        continue;
      }

      const memberSocket = this.peersByUserId.get(member.userId);
      if (!memberSocket) {
        continue;
      }

      this.send(memberSocket, {
        type: "netplay.signal",
        roomId: room.id,
        fromUserId: peer.userId,
        channel: typeof message.channel === "string" ? message.channel : "generic",
        payload: message.payload ?? null,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const stub = env.SIGNALING_HUB.getByName("global");
      return stub.fetch("https://signaling.internal/health");
    }

    if (url.pathname === "/ws") {
      if (request.method !== "GET") {
        return new Response("Expected GET", { status: 405 });
      }

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const stub = env.SIGNALING_HUB.getByName("global");
      return stub.fetch("https://signaling.internal/ws", {
        headers: request.headers,
      });
    }

    return new Response("Emusol signaling worker is running.", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
