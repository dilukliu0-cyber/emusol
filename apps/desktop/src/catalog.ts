import type { FriendEntry, PlatformId } from './types';

export const FRIENDS: FriendEntry[] = [
  { id: 'mira', name: 'Мира', status: 'online', note: 'Ждет кооператив, когда дойдем до онлайна.' },
  { id: 'teo', name: 'Тео', status: 'playing', note: 'Тестирует текущий интерфейс библиотеки.' },
  { id: 'lena', name: 'Лена', status: 'offline', note: 'Подключится позже.' }
];

export const V1_PLATFORMS: Array<{ id: PlatformId; label: string }> = [
  { id: 'NES', label: 'NES' },
  { id: 'SNES', label: 'SNES' },
  { id: 'GB', label: 'GB' },
  { id: 'GBC', label: 'GBC' },
  { id: 'GBA', label: 'GBA' },
  { id: 'MEGADRIVE', label: 'Mega Drive' },
  { id: 'N64', label: 'N64' },
  { id: 'DS', label: 'DS' }
];

export const FUTURE_PLATFORMS: Array<{ id: PlatformId; label: string }> = [
  { id: 'GCN', label: 'GameCube' },
  { id: '3DS', label: '3DS' }
];
