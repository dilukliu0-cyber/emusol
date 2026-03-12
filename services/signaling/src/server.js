const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 43123);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOM_MEMBERS = 2;

const peers = new Map();
const peersByUserId = new Map();
const rooms = new Map();

const createId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const send = (socket, message) => {
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
};

const toPresenceUser = (peer) => ({
  userId: peer.userId,
  displayName: peer.displayName,
  roomId: peer.roomId ?? null,
  connectedAt: peer.connectedAt
});

const getPresenceSnapshot = () =>
  Array.from(peers.values())
    .filter((peer) => Boolean(peer.userId))
    .map(toPresenceUser)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru'));

const serializeRoom = (room) => ({
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
    ready: member.ready,
    joinedAt: member.joinedAt,
    isHost: member.userId === room.hostUserId
  }))
});

const broadcastPresence = () => {
  const users = getPresenceSnapshot();

  for (const socket of peers.keys()) {
    send(socket, { type: 'presence.snapshot', users });
  }
};

const broadcastRoom = (roomId) => {
  const room = roomId ? rooms.get(roomId) : null;
  const payload = { type: 'room.update', room: room ? serializeRoom(room) : null };

  if (!room) {
    return;
  }

  for (const member of room.members) {
    const memberSocket = peersByUserId.get(member.userId);
    if (memberSocket) {
      send(memberSocket, payload);
    }
  }
};

const leaveRoom = (peer) => {
  if (!peer.roomId) {
    return;
  }

  const room = rooms.get(peer.roomId);
  const previousRoomId = peer.roomId;
  peer.roomId = null;

  if (!room) {
    send(peer.socket, { type: 'room.update', room: null });
    broadcastPresence();
    return;
  }

  room.members = room.members.filter((member) => member.userId !== peer.userId);

  if (!room.members.length) {
    rooms.delete(previousRoomId);
  } else {
    if (!room.members.some((member) => member.userId === room.hostUserId)) {
      room.hostUserId = room.members[0].userId;
    }

    broadcastRoom(previousRoomId);
  }

  send(peer.socket, { type: 'room.update', room: null });
  broadcastPresence();
};

const attachToRoom = (peer, room) => {
  leaveRoom(peer);
  room.members.push({
    userId: peer.userId,
    displayName: peer.displayName,
    ready: false,
    joinedAt: new Date().toISOString()
  });
  peer.roomId = room.id;
  broadcastRoom(room.id);
  broadcastPresence();
};

const handleHello = (socket, peer, message) => {
  const userId = typeof message.userId === 'string' && message.userId.trim() ? message.userId.trim() : createId('user');
  const displayName =
    typeof message.displayName === 'string' && message.displayName.trim() ? message.displayName.trim().slice(0, 28) : 'Игрок';

  const previousSocket = peersByUserId.get(userId);
  if (previousSocket && previousSocket !== socket) {
    previousSocket.close(4001, 'Другая сессия заняла этот userId.');
  }

  peer.userId = userId;
  peer.displayName = displayName;
  peersByUserId.set(userId, socket);

  send(socket, {
    type: 'session.welcome',
    selfUserId: userId,
    displayName,
    users: getPresenceSnapshot(),
    room: peer.roomId ? serializeRoom(rooms.get(peer.roomId)) : null
  });

  broadcastPresence();
};

const handleCreateRoom = (peer, message) => {
  if (!peer.userId) {
    throw new Error('Сначала отправьте hello.');
  }

  const gameId = typeof message.gameId === 'string' ? message.gameId : '';
  const gameTitle = typeof message.gameTitle === 'string' ? message.gameTitle : 'Игра';
  const romFileName = typeof message.romFileName === 'string' && message.romFileName.trim() ? message.romFileName.trim() : null;
  const platform = typeof message.platform === 'string' ? message.platform : 'UNKNOWN';

  const room = {
    id: createId('room'),
    gameId,
    gameTitle,
    romFileName,
    platform,
    hostUserId: peer.userId,
    createdAt: new Date().toISOString(),
    launchedAt: null,
    members: []
  };

  rooms.set(room.id, room);
  attachToRoom(peer, room);
};

const handleJoinRoom = (peer, message) => {
  if (!peer.userId) {
    throw new Error('Сначала отправьте hello.');
  }

  const roomId = typeof message.roomId === 'string' ? message.roomId : '';
  const room = rooms.get(roomId);

  if (!room) {
    throw new Error('Комната не найдена.');
  }

  if (room.members.some((member) => member.userId === peer.userId)) {
    return;
  }

  if (room.members.length >= MAX_ROOM_MEMBERS) {
    throw new Error('Комната уже заполнена.');
  }

  attachToRoom(peer, room);
};

const handleSetReady = (peer, message) => {
  const room = peer.roomId ? rooms.get(peer.roomId) : null;
  if (!room) {
    throw new Error('Вы не в комнате.');
  }

  const member = room.members.find((entry) => entry.userId === peer.userId);
  if (!member) {
    throw new Error('Участник комнаты не найден.');
  }

  member.ready = Boolean(message.ready);
  broadcastRoom(room.id);
};

const handleSendInvite = (peer, message) => {
  if (!peer.userId) {
    throw new Error('Сначала отправьте hello.');
  }

  const targetUserId = typeof message.toUserId === 'string' ? message.toUserId : '';
  const roomId = typeof message.roomId === 'string' ? message.roomId : peer.roomId;
  const room = roomId ? rooms.get(roomId) : null;
  const targetSocket = peersByUserId.get(targetUserId);

  if (!room) {
    throw new Error('Сначала создайте комнату для инвайта.');
  }

  if (!targetSocket) {
    throw new Error('Друг сейчас не в сети.');
  }

  send(targetSocket, {
    type: 'invite.received',
    invite: {
      id: createId('invite'),
      roomId: room.id,
      fromUserId: peer.userId,
      fromDisplayName: peer.displayName,
      gameTitle: room.gameTitle,
      platform: room.platform,
      createdAt: new Date().toISOString()
    }
  });
};

const handleLaunchRoom = (peer) => {
  const room = peer.roomId ? rooms.get(peer.roomId) : null;
  if (!room) {
    throw new Error('Вы не в комнате.');
  }

  if (room.hostUserId !== peer.userId) {
    throw new Error('Запуск комнаты доступен только хосту.');
  }

  if (room.members.length < 2) {
    throw new Error('Для netplay MVP нужен второй участник.');
  }

  if (room.members.some((member) => !member.ready)) {
    throw new Error('Не все участники отметились как готовые.');
  }

  room.launchedAt = new Date().toISOString();
  broadcastRoom(room.id);

  for (const member of room.members) {
    const memberSocket = peersByUserId.get(member.userId);
    if (memberSocket) {
      send(memberSocket, {
        type: 'room.launched',
        room: serializeRoom(room)
      });
    }
  }
};

const handleRelaySignal = (peer, message) => {
  const room = peer.roomId ? rooms.get(peer.roomId) : null;
  if (!room) {
    throw new Error('Вы не в комнате.');
  }

  for (const member of room.members) {
    if (member.userId === peer.userId) {
      continue;
    }

    const memberSocket = peersByUserId.get(member.userId);
    if (!memberSocket) {
      continue;
    }

    send(memberSocket, {
      type: 'netplay.signal',
      roomId: room.id,
      fromUserId: peer.userId,
      channel: typeof message.channel === 'string' ? message.channel : 'generic',
      payload: message.payload ?? null,
      createdAt: new Date().toISOString()
    });
  }
};

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        ok: true,
        users: getPresenceSnapshot().length,
        rooms: rooms.size
      })
    );
    return;
  }

  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Emusol signaling service is running.');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  const peer = {
    socket,
    userId: null,
    displayName: 'Игрок',
    connectedAt: new Date().toISOString(),
    roomId: null
  };

  peers.set(socket, peer);

  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(String(raw));
      const type = typeof message.type === 'string' ? message.type : '';

      switch (type) {
        case 'hello':
          handleHello(socket, peer, message);
          break;
        case 'room.create':
          handleCreateRoom(peer, message);
          break;
        case 'room.join':
          handleJoinRoom(peer, message);
          break;
        case 'room.leave':
          leaveRoom(peer);
          break;
        case 'room.ready':
          handleSetReady(peer, message);
          break;
        case 'invite.send':
          handleSendInvite(peer, message);
          break;
        case 'room.launch':
          handleLaunchRoom(peer);
          break;
        case 'netplay.signal':
          handleRelaySignal(peer, message);
          break;
        default:
          throw new Error(`Неизвестный тип сообщения: ${type || 'empty'}`);
      }
    } catch (error) {
      send(socket, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Ошибка signaling-сервиса.'
      });
    }
  });

  socket.on('close', () => {
    leaveRoom(peer);
    peers.delete(socket);
    if (peer.userId && peersByUserId.get(peer.userId) === socket) {
      peersByUserId.delete(peer.userId);
    }
    broadcastPresence();
  });

  send(socket, {
    type: 'server.ready',
    port: PORT
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Emusol signaling listening on ws://${HOST}:${PORT}`);
});
