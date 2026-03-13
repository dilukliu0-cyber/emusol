import type { PlatformId } from './types';

export interface NetplayPresenceUser {
  userId: string;
  displayName: string;
  avatarDataUrl?: string;
  roomId: string | null;
  connectedAt: string;
}

export interface NetplayRoomMember {
  userId: string;
  displayName: string;
  avatarDataUrl?: string;
  ready: boolean;
  joinedAt: string;
  isHost: boolean;
}

export interface NetplayRoom {
  id: string;
  gameId: string;
  gameTitle: string;
  romFileName: string | null;
  platform: PlatformId;
  hostUserId: string;
  createdAt: string;
  launchedAt: string | null;
  members: NetplayRoomMember[];
}

export interface NetplayInvite {
  id: string;
  roomId: string;
  fromUserId: string;
  fromDisplayName: string;
  fromAvatarDataUrl?: string;
  gameTitle: string;
  platform: PlatformId;
  createdAt: string;
}

export interface NetplaySignalMessage {
  roomId: string;
  fromUserId: string;
  channel: string;
  payload: unknown;
  createdAt: string;
}

interface NetplayClientOptions {
  serverUrl: string;
  userId: string;
  displayName: string;
  avatarDataUrl?: string;
  onOpen: () => void;
  onClose: (reason: string) => void;
  onPresence: (users: NetplayPresenceUser[]) => void;
  onRoom: (room: NetplayRoom | null) => void;
  onInvite: (invite: NetplayInvite) => void;
  onLaunch: (room: NetplayRoom) => void;
  onSignal: (signal: NetplaySignalMessage) => void;
  onError: (message: string) => void;
}

export interface NetplayClient {
  disconnect: () => void;
  createRoom: (gameId: string, gameTitle: string, platform: PlatformId, romFileName?: string) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  setReady: (ready: boolean) => void;
  sendInvite: (toUserId: string, roomId?: string) => void;
  launchRoom: () => void;
  sendSignal: (channel: string, payload: unknown) => void;
}

const EMUSOL_NETPLAY_ID_KEY = 'emusol.netplay.userId';
const EMUSOL_SIGNALING_URL_KEY = 'emusol.netplay.serverUrl';
export const DEFAULT_SIGNALING_URL = 'wss://emusol-signaling.dilukliu0.workers.dev/ws';
const LEGACY_SIGNALING_URLS = new Set(['ws://127.0.0.1:43123', 'ws://localhost:43123']);

const getCloseReason = (event: CloseEvent): string => {
  if (event.reason?.trim()) {
    return event.reason;
  }

  if (event.code === 1000) {
    return 'Соединение закрыто.';
  }

  if (event.code === 1006) {
    return 'Соединение потеряно.';
  }

  return 'Онлайн-соединение закрыто.';
};

export const getDefaultSignalingUrl = (): string => {
  const storedValue = localStorage.getItem(EMUSOL_SIGNALING_URL_KEY)?.trim() || '';
  if (!storedValue || LEGACY_SIGNALING_URLS.has(storedValue)) {
    localStorage.setItem(EMUSOL_SIGNALING_URL_KEY, DEFAULT_SIGNALING_URL);
    return DEFAULT_SIGNALING_URL;
  }

  return storedValue;
};

export const setDefaultSignalingUrl = (value: string): void => {
  const nextValue = value.trim() || DEFAULT_SIGNALING_URL;
  localStorage.setItem(EMUSOL_SIGNALING_URL_KEY, nextValue);
};

const createShortNetplayId = (seed: string): string => {
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36).padStart(5, '0').slice(0, 5);
};

export const getNetplayUserId = (): string => {
  const storedValue = localStorage.getItem(EMUSOL_NETPLAY_ID_KEY)?.trim() ?? '';
  if (storedValue) {
    const normalizedValue = storedValue.toLowerCase().replace(/[^a-z0-9]/g, '');
    const shortValue = normalizedValue && normalizedValue.length <= 5 ? normalizedValue : createShortNetplayId(storedValue);
    localStorage.setItem(EMUSOL_NETPLAY_ID_KEY, shortValue);
    return shortValue;
  }

  const seed = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `user_${Date.now()}`;
  const nextValue = createShortNetplayId(seed);
  localStorage.setItem(EMUSOL_NETPLAY_ID_KEY, nextValue);
  return nextValue;
};

const send = (socket: WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
};

export const createNetplayClient = (options: NetplayClientOptions): NetplayClient => {
  const socket = new WebSocket(options.serverUrl);
  let isOpen = false;

  socket.addEventListener('open', () => {
    isOpen = true;
    send(socket, {
      type: 'hello',
      userId: options.userId,
      displayName: options.displayName,
      avatarDataUrl: options.avatarDataUrl
    });
    options.onOpen();
  });

  socket.addEventListener('close', (event) => {
    isOpen = false;
    options.onClose(getCloseReason(event));
  });

  socket.addEventListener('error', () => {
    options.onError('Не удалось подключиться к онлайн-серверу.');
  });

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        users?: NetplayPresenceUser[];
        room?: NetplayRoom | null;
        invite?: NetplayInvite;
        message?: string;
        selfUserId?: string;
        channel?: string;
        payload?: unknown;
        roomId?: string;
        fromUserId?: string;
        createdAt?: string;
      };

      switch (message.type) {
        case 'session.welcome':
          options.onPresence(message.users ?? []);
          options.onRoom(message.room ?? null);
          break;
        case 'presence.snapshot':
          options.onPresence(message.users ?? []);
          break;
        case 'room.update':
          options.onRoom(message.room ?? null);
          break;
        case 'invite.received':
          if (message.invite) {
            options.onInvite(message.invite);
          }
          break;
        case 'room.launched':
          if (message.room) {
            options.onLaunch(message.room);
          }
          break;
        case 'netplay.signal':
          if (message.roomId && message.fromUserId && message.channel && message.createdAt) {
            options.onSignal({
              roomId: message.roomId,
              fromUserId: message.fromUserId,
              channel: message.channel,
              payload: message.payload ?? null,
              createdAt: message.createdAt
            });
          }
          break;
        case 'error':
          options.onError(typeof message.message === 'string' ? message.message : 'Ошибка signaling-сервиса.');
          break;
        default:
          break;
      }
    } catch {
      options.onError('Пришел битый ответ от signaling-сервиса.');
    }
  });

  return {
    disconnect: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Пользователь отключился.');
      }
    },
    createRoom: (gameId, gameTitle, platform, romFileName) => {
      if (!isOpen) return;
      send(socket, { type: 'room.create', gameId, gameTitle, platform, romFileName });
    },
    joinRoom: (roomId) => {
      if (!isOpen) return;
      send(socket, { type: 'room.join', roomId });
    },
    leaveRoom: () => {
      if (!isOpen) return;
      send(socket, { type: 'room.leave' });
    },
    setReady: (ready) => {
      if (!isOpen) return;
      send(socket, { type: 'room.ready', ready });
    },
    sendInvite: (toUserId, roomId) => {
      if (!isOpen) return;
      send(socket, { type: 'invite.send', toUserId, roomId });
    },
    launchRoom: () => {
      if (!isOpen) return;
      send(socket, { type: 'room.launch' });
    },
    sendSignal: (channel, payload) => {
      if (!isOpen) return;
      send(socket, { type: 'netplay.signal', channel, payload });
    }
  };
};
