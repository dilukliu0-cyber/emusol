import type { ChangeEvent, MutableRefObject } from 'react';
import type { Nostalgist as NostalgistInstance } from 'nostalgist';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FUTURE_PLATFORMS, V1_PLATFORMS } from './catalog';
import {
  getBuiltInPlatformDescriptor,
  getBuiltInRuntime,
  getEmulatorJsCore,
  getEmulatorJsDataPath,
  launchBuiltInGame
} from './emulation';
import {
  createNetplayClient,
  DEFAULT_SIGNALING_URL,
  getDefaultSignalingUrl,
  getNetplayUserId,
  setDefaultSignalingUrl,
  type NetplayClient,
  type NetplayInvite,
  type NetplayPresenceUser,
  type NetplayRoom
} from './netplay';
import type {
  AutoSaveSummary,
  ControlAction,
  ControlBindings,
  DualScreenPrimary,
  EmbeddedLaunchPayload,
  EmbeddedPreferences,
  EmbeddedPreferencesByPlatform,
  EmulatorProfiles,
  FriendEntry,
  FriendStatus,
  GameControlBindingsByGameId,
  LibraryGame,
  LaunchGameResult,
  PlatformId,
  ProfileState,
  RuntimeInfo,
  ScreenScaleMode,
  SaveSlotSummary,
  SecondScreenLayoutMode
} from './types';

type SortMode = 'RECENT' | 'TITLE' | 'PLATFORM' | 'MOST_PLAYED' | 'NEWEST';

interface PlayerFrameRequest {
  reject: (reason?: unknown) => void;
  resolve: (payload: Record<string, unknown>) => void;
  timeoutId: number;
}

type NetplayPlayerIndex = 1 | 2;

interface ActiveNetplaySession {
  roomId: string;
  gameId: string;
  gameTitle: string;
  platform: PlatformId;
  localPlayerIndex: NetplayPlayerIndex;
  remotePlayerIndex: NetplayPlayerIndex;
  launchMode: 'host-stream' | 'experimental-relay';
}

interface RemoteStreamSession {
  roomId: string;
  gameTitle: string;
  platform: PlatformId;
  audioAvailable: boolean;
}

interface NetplayInputSignalPayload {
  action: ControlAction;
  pressed: boolean;
  frame?: number;
}

interface NetplayStateHashSignalPayload {
  stateHash: string;
}

interface NetplayStateSyncSignalPayload {
  stateBase64: string;
  stateHash: string;
  reason: 'initial' | 'mismatch' | 'request';
}

interface NetplayRomHashSignalPayload {
  romHash: string;
}

interface NetplayRtcDescriptionSignalPayload {
  type: 'offer' | 'answer';
  sdp: string;
}

interface NetplayRtcIceSignalPayload {
  candidate: RTCIceCandidateInit;
}

interface GamepadSummary {
  index: number;
  id: string;
  mapping: string;
}

interface FriendDraft {
  friendId: string;
}

const EMUSOL_FRAME_SOURCE = 'emusol';
const EMUSOL_PLAYER_SOURCE = 'emusol-emulatorjs';
const EXPERIMENTAL_NETPLAY_PLATFORMS: PlatformId[] = ['NES', 'SNES', 'MEGADRIVE'];
const NETPLAY_RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    {
      urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']
    }
  ]
};
const NETPLAY_STATE_HASH_INTERVAL_MS = 5000;
const NETPLAY_INPUT_FRAME_DELAY = 2;
const GAMEPAD_DEADZONE = 0.35;
const DEFAULT_ACCOUNT_ART = `${import.meta.env.BASE_URL}emusol-bird.png`;
const PINK_THEME_ACCENT = '#ff4fa3';

const defaultProfile: ProfileState = {
  displayName: 'Игрок',
  theme: 'dark',
  accentColor: '#ff5548'
};

const defaultControlBindings = (): ControlBindings => ({
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  a: 'x',
  b: 'z',
  x: 's',
  y: 'a',
  l: 'q',
  r: 'w',
  start: 'enter',
  select: 'rshift'
});

const EMULATORJS_ACTION_BINDINGS: ControlBindings = Object.freeze(defaultControlBindings());

const defaultEmbeddedPreferences = (): EmbeddedPreferences => ({
  volumePercent: 100,
  muted: false,
  quickSlot: 1,
  controlBindings: defaultControlBindings(),
  videoFilter: 'sharp',
  integerScale: false,
  aspectRatio: 'auto',
  secondScreenLayout: 'right',
  primaryScreen: 'top',
  secondScreenSizePercent: 22,
  primaryScreenScaleMode: 'stretch',
  secondaryScreenScaleMode: 'fit'
});

const createDefaultEmbeddedPreferencesByPlatform = (): EmbeddedPreferencesByPlatform => ({
  NES: defaultEmbeddedPreferences(),
  SNES: defaultEmbeddedPreferences(),
  GB: defaultEmbeddedPreferences(),
  GBC: defaultEmbeddedPreferences(),
  GBA: defaultEmbeddedPreferences(),
  MEGADRIVE: defaultEmbeddedPreferences(),
  N64: defaultEmbeddedPreferences(),
  GCN: defaultEmbeddedPreferences(),
  DS: defaultEmbeddedPreferences(),
  '3DS': defaultEmbeddedPreferences()
});

const createDefaultEmulatorProfiles = (): EmulatorProfiles => ({
  NES: { executablePath: '', argsTemplate: '"{rom}"' },
  SNES: { executablePath: '', argsTemplate: '"{rom}"' },
  GB: { executablePath: '', argsTemplate: '"{rom}"' },
  GBC: { executablePath: '', argsTemplate: '"{rom}"' },
  GBA: { executablePath: '', argsTemplate: '"{rom}"' },
  MEGADRIVE: { executablePath: '', argsTemplate: '"{rom}"' },
  N64: { executablePath: '', argsTemplate: '"{rom}"' },
  GCN: { executablePath: '', argsTemplate: '"{rom}"' },
  DS: { executablePath: '', argsTemplate: '"{rom}"' },
  '3DS': { executablePath: '', argsTemplate: '"{rom}"' }
});

const supportsExperimentalNetplayPlatform = (platform: PlatformId): boolean => EXPERIMENTAL_NETPLAY_PLATFORMS.includes(platform);

const isNetplayInputSignalPayload = (value: unknown): value is NetplayInputSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayInputSignalPayload>;
  return typeof candidate.action === 'string' && typeof candidate.pressed === 'boolean';
};

const isNetplayStateHashSignalPayload = (value: unknown): value is NetplayStateHashSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayStateHashSignalPayload>;
  return typeof candidate.stateHash === 'string' && candidate.stateHash.length > 0;
};

const isNetplayStateSyncSignalPayload = (value: unknown): value is NetplayStateSyncSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayStateSyncSignalPayload>;
  return (
    typeof candidate.stateBase64 === 'string' &&
    candidate.stateBase64.length > 0 &&
    typeof candidate.stateHash === 'string' &&
    candidate.stateHash.length > 0 &&
    (candidate.reason === 'initial' || candidate.reason === 'mismatch' || candidate.reason === 'request')
  );
};

const isNetplayRomHashSignalPayload = (value: unknown): value is NetplayRomHashSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayRomHashSignalPayload>;
  return typeof candidate.romHash === 'string' && candidate.romHash.length > 0;
};

const isNetplayRtcDescriptionSignalPayload = (value: unknown): value is NetplayRtcDescriptionSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayRtcDescriptionSignalPayload>;
  return (candidate.type === 'offer' || candidate.type === 'answer') && typeof candidate.sdp === 'string' && candidate.sdp.length > 0;
};

const isNetplayRtcIceSignalPayload = (value: unknown): value is NetplayRtcIceSignalPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<NetplayRtcIceSignalPayload>;
  return Boolean(candidate.candidate && typeof candidate.candidate === 'object');
};

const isAudioContextLike = (value: unknown): value is AudioContext =>
  value !== null &&
  typeof value === 'object' &&
  'createMediaStreamDestination' in value &&
  'destination' in value &&
  'state' in value;

const isAudioNodeLike = (value: unknown): value is AudioNode =>
  value !== null &&
  typeof value === 'object' &&
  'connect' in value &&
  typeof (value as { connect?: unknown }).connect === 'function' &&
  'context' in value;

const resolveNetplayGame = (games: LibraryGame[], room: Pick<NetplayRoom, 'gameId' | 'gameTitle' | 'platform' | 'romFileName'>): LibraryGame | null => {
  const byId = room.gameId ? games.find((game) => game.id === room.gameId) : null;
  if (byId) {
    return byId;
  }

  const byRomFileName = room.romFileName
    ? games.find((game) => game.platform === room.platform && game.romFileName.toLowerCase() === room.romFileName?.toLowerCase())
    : null;

  if (byRomFileName) {
    return byRomFileName;
  }

  const normalizedTitle = room.gameTitle.trim().toLowerCase();
  return (
    games.find((game) => game.platform === room.platform && game.title.trim().toLowerCase() === normalizedTitle) ?? null
  );
};

const libraryConsoleOptions: Array<{ id: 'ALL' | PlatformId; label: string }> = [
  { id: 'ALL', label: 'Все' },
  { id: 'NES', label: 'NES' },
  { id: 'SNES', label: 'SNES' },
  { id: 'GB', label: 'GB' },
  { id: 'GBC', label: 'GBC' },
  { id: 'GBA', label: 'GBA' },
  { id: 'MEGADRIVE', label: 'Mega Drive' },
  { id: 'N64', label: 'N64' },
  { id: 'GCN', label: 'GameCube' },
  { id: 'DS', label: 'DS' },
  { id: '3DS', label: '3DS' }
];

const friendStatusLabels = {
  online: 'в сети',
  offline: 'не в сети',
  playing: 'играет'
} as const;

const formatFriendPresence = (status: FriendStatus, detail?: string): string => {
  if (status === 'playing') {
    return detail ? `Играет в ${detail}` : 'Играет';
  }

  return status === 'online' ? 'В сети' : 'Не в сети';
};

const defaultFriendDraft = (): FriendDraft => ({
  friendId: ''
});

const pauseTabs = [
  { id: 'controls', label: 'Управление' },
  { id: 'audio', label: 'Звук' },
  { id: 'video', label: 'Видео' },
  { id: 'screens', label: 'Экраны' },
  { id: 'saves', label: 'Сохранить / загрузить' }
] as const;

const videoFilterOptions: Array<{ id: EmbeddedPreferences['videoFilter']; label: string }> = [
  { id: 'sharp', label: 'Четкий' },
  { id: 'smooth', label: 'Сглаженный' }
];

const aspectRatioOptions: Array<{ id: EmbeddedPreferences['aspectRatio']; label: string }> = [
  { id: 'auto', label: 'Авто' },
  { id: '4:3', label: '4:3' },
  { id: '8:7', label: '8:7' },
  { id: '3:2', label: '3:2' }
];

const secondScreenLayoutOptions: Array<{ id: SecondScreenLayoutMode; label: string; description: string }> = [
  { id: 'right', label: 'Справа', description: 'Основной экран на весь фон, второй в окне справа.' },
  { id: 'left', label: 'Слева', description: 'Второй экран в окне слева.' },
  { id: 'top', label: 'Сверху', description: 'Второй экран в окне сверху.' },
  { id: 'bottom', label: 'Снизу', description: 'Второй экран в окне снизу.' },
  { id: 'detached', label: 'Открепить', description: 'Второй экран откроется в отдельном окне.' }
];

const primaryScreenOptions: Array<{ id: DualScreenPrimary; label: string; description: string }> = [
  { id: 'top', label: 'Верхний', description: 'Основным будет верхний экран.' },
  { id: 'bottom', label: 'Нижний', description: 'Основным будет нижний экран.' }
];

const screenScaleOptions: Array<{ id: ScreenScaleMode; label: string; description: string }> = [
  { id: 'stretch', label: 'Растянуть', description: 'Заполнить всю доступную зону.' },
  { id: 'fit', label: 'По пропорции', description: 'Сохранить пропорции без искажения.' }
];

const SECOND_SCREEN_SIZE_MIN = 18;
const SECOND_SCREEN_SIZE_MAX = 40;

const sortOptions: Array<{ id: SortMode; label: string; description: string }> = [
  { id: 'RECENT', label: 'Недавние', description: 'Сначала игры, которые вы открывали последними.' },
  { id: 'TITLE', label: 'По имени', description: 'Алфавитная сортировка библиотеки.' },
  { id: 'PLATFORM', label: 'По платформе', description: 'Сначала одна платформа, потом следующая.' },
  { id: 'MOST_PLAYED', label: 'По запускам', description: 'Наверху те игры, в которые вы заходили чаще.' },
  { id: 'NEWEST', label: 'Сначала новые', description: 'Вверху свежеимпортированные ROM-ы.' }
];

const controlActionLabels: Record<ControlAction, string> = {
  up: 'Вверх',
  down: 'Вниз',
  left: 'Влево',
  right: 'Вправо',
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  l: 'L',
  r: 'R',
  start: 'Start',
  select: 'Select'
};

type ControlClusterKind = 'dpad' | 'face' | 'row';

interface ControlClusterDefinition {
  id: string;
  label: string;
  kind: ControlClusterKind;
  actions: ControlAction[];
}

const CONTROL_LAYOUTS: Record<PlatformId, ControlClusterDefinition[]> = {
  NES: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['b', 'a'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  SNES: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['y', 'x', 'b', 'a'] },
    { id: 'shoulders', label: 'Шифты', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  GB: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['b', 'a'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  GBC: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['b', 'a'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  GBA: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['b', 'a'] },
    { id: 'shoulders', label: 'Шифты', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  MEGADRIVE: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['y', 'x', 'b', 'a'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['start'] }
  ],
  N64: [
    { id: 'dpad', label: 'Направление', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Главные кнопки', kind: 'face', actions: ['x', 'y', 'b', 'a'] },
    { id: 'shoulders', label: 'Триггеры', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['start'] }
  ],
  GCN: [
    { id: 'dpad', label: 'Направление', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Главные кнопки', kind: 'face', actions: ['x', 'y', 'b', 'a'] },
    { id: 'shoulders', label: 'Триггеры', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['start'] }
  ],
  DS: [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['x', 'y', 'b', 'a'] },
    { id: 'shoulders', label: 'Шифты', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ],
  '3DS': [
    { id: 'dpad', label: 'Крестовина', kind: 'dpad', actions: ['up', 'left', 'down', 'right'] },
    { id: 'face', label: 'Кнопки', kind: 'face', actions: ['x', 'y', 'b', 'a'] },
    { id: 'shoulders', label: 'Шифты', kind: 'row', actions: ['l', 'r'] },
    { id: 'system', label: 'Система', kind: 'row', actions: ['select', 'start'] }
  ]
};

const GAMEPAD_BUTTON_TO_ACTION: Partial<Record<number, ControlAction>> = {
  0: 'a',
  1: 'b',
  2: 'x',
  3: 'y',
  4: 'l',
  5: 'r',
  8: 'select',
  9: 'start',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
};

const collectGamepadActions = (gamepad: Gamepad): Set<ControlAction> => {
  const actions = new Set<ControlAction>();

  gamepad.buttons.forEach((button, index) => {
    const mappedAction = GAMEPAD_BUTTON_TO_ACTION[index];
    if (mappedAction && button.pressed) {
      actions.add(mappedAction);
    }
  });

  const horizontalAxis = gamepad.axes[0] ?? 0;
  const verticalAxis = gamepad.axes[1] ?? 0;

  if (horizontalAxis <= -GAMEPAD_DEADZONE) {
    actions.add('left');
  }
  if (horizontalAxis >= GAMEPAD_DEADZONE) {
    actions.add('right');
  }
  if (verticalAxis <= -GAMEPAD_DEADZONE) {
    actions.add('up');
  }
  if (verticalAxis >= GAMEPAD_DEADZONE) {
    actions.add('down');
  }

  return actions;
};

const getCanonicalEmulatorJsBinding = (action: ControlAction): string => EMULATORJS_ACTION_BINDINGS[action];

const listConnectedGamepads = (): GamepadSummary[] => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return [];
  }

  return Array.from(navigator.getGamepads())
    .filter((entry): entry is Gamepad => Boolean(entry))
    .map((gamepad) => ({
      index: gamepad.index,
      id: gamepad.id || `Gamepad ${gamepad.index + 1}`,
      mapping: gamepad.mapping || 'standard'
    }));
};

const createEmptySaveSlots = (): SaveSlotSummary[] =>
  Array.from({ length: 3 }, (_, index) => ({
    slot: index + 1,
    hasState: false
  }));

const formatPlatform = (platform: PlatformId): string => {
  if (platform === 'MEGADRIVE') return 'Mega Drive';
  if (platform === 'GCN') return 'GameCube';
  return platform;
};

const formatDate = (value?: string): string => {
  if (!value) return 'Еще не запускалась';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
};

const formatBindingLabel = (binding: string): string => {
  const labels: Record<string, string> = {
    up: 'Стрелка вверх',
    down: 'Стрелка вниз',
    left: 'Стрелка влево',
    right: 'Стрелка вправо',
    enter: 'Enter',
    rshift: 'Правый Shift',
    shift: 'Левый Shift',
    space: 'Пробел',
    tab: 'Tab',
    backspace: 'Backspace',
    ctrl: 'Ctrl',
    rctrl: 'Правый Ctrl',
    alt: 'Alt',
    ralt: 'Правый Alt'
  };

  if (labels[binding]) {
    return labels[binding];
  }

  return binding.length === 1 ? binding.toUpperCase() : binding;
};

const formatVideoFilterLabel = (value: EmbeddedPreferences['videoFilter']): string =>
  value === 'smooth' ? 'Сглаженный' : 'Четкий';

const formatAspectRatioLabel = (value: EmbeddedPreferences['aspectRatio']): string => {
  if (value === 'auto') {
    return 'Авто';
  }

  return value;
};

const formatSecondScreenLayoutLabel = (value: SecondScreenLayoutMode): string => {
  switch (value) {
    case 'left':
      return 'Слева';
    case 'top':
      return 'Сверху';
    case 'bottom':
      return 'Снизу';
    case 'detached':
      return 'Откреплен';
    default:
      return 'Справа';
  }
};

const formatPrimaryScreenLabel = (value: DualScreenPrimary): string => (value === 'bottom' ? 'Нижний' : 'Верхний');
const formatScreenScaleModeLabel = (value: ScreenScaleMode): string => (value === 'stretch' ? 'Растянуть' : 'По пропорции');

const isDualScreenPlatform = (platform: PlatformId): boolean => platform === 'DS' || platform === '3DS';
const supportsLiveDualScreenLayout = (platform: PlatformId): boolean => platform === 'DS';
const supportsLiveVideoSettings = (platform: PlatformId): boolean => platform === 'N64';

const keyboardEventToRetroArchKey = (event: KeyboardEvent): string | null => {
  const byCode: Record<string, string> = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'enter',
    ShiftRight: 'rshift',
    ShiftLeft: 'shift',
    Space: 'space',
    Tab: 'tab',
    Backspace: 'backspace',
    ControlLeft: 'ctrl',
    ControlRight: 'rctrl',
    AltLeft: 'alt',
    AltRight: 'ralt'
  };

  if (event.code === 'Escape') {
    return null;
  }

  if (byCode[event.code]) {
    return byCode[event.code];
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(-1).toLowerCase() || null;
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.slice(-1) || null;
  }

  if (/^Numpad[0-9]$/.test(event.code)) {
    return `num${event.code.slice(-1)}`;
  }

  return null;
};

const getControlActionForBinding = (bindings: ControlBindings, binding: string): ControlAction | null => {
  for (const action of Object.keys(bindings) as ControlAction[]) {
    if (bindings[action] === binding) {
      return action;
    }
  }

  return null;
};

const getPlatformPalette = (platform: PlatformId): [string, string] => {
  const palette: Record<PlatformId, [string, string]> = {
    NES: ['#f44c3d', '#ff9d56'],
    SNES: ['#5727ff', '#0bb8ff'],
    GB: ['#1c7c54', '#8be68f'],
    GBC: ['#0ea5a4', '#78f0d0'],
    GBA: ['#1b5cff', '#6ae0ff'],
    MEGADRIVE: ['#0047ff', '#1ce2ff'],
    N64: ['#f97316', '#facc15'],
    GCN: ['#5b6cff', '#b1ff78'],
    DS: ['#4f46e5', '#22d3ee'],
    '3DS': ['#0f766e', '#c084fc']
  };

  return palette[platform];
};

const getStatusChipClass = (tone: 'success' | 'neutral' | 'warning'): string => {
  switch (tone) {
    case 'neutral':
      return 'chip neutral';
    case 'warning':
      return 'chip warning';
    default:
      return 'chip success';
  }
};

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
};

const blobToBase64 = async (blob: Blob): Promise<string> => arrayBufferToBase64(await blob.arrayBuffer());

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const base64ToFile = (base64: string, fileName: string): File => {
  const bytes = base64ToBytes(base64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], fileName);
};

const digestToHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

const computeStableHashFromBase64 = async (base64: string): Promise<string> => {
  if (typeof crypto?.subtle?.digest === 'function') {
    const bytes = base64ToBytes(base64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return digestToHex(digest);
  }

  let hash = 2166136261;
  for (let index = 0; index < base64.length; index += 1) {
    hash ^= base64.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fallback_${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const formatGameCount = (count: number): string => {
  const remainder10 = count % 10;
  const remainder100 = count % 100;

  if (remainder10 === 1 && remainder100 !== 11) {
    return `${count} игра`;
  }

  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return `${count} игры`;
  }

  return `${count} игр`;
};

const formatLaunchCountLabel = (count: number): string => {
  const remainder10 = count % 10;
  const remainder100 = count % 100;

  if (remainder10 === 1 && remainder100 !== 11) {
    return `${count} запуск`;
  }

  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) {
    return `${count} запуска`;
  }

  return `${count} запусков`;
};

function App() {
  const bridge = window.emusol;
  const [profile, setProfile] = useState<ProfileState>(defaultProfile);
  const [library, setLibrary] = useState<LibraryGame[]>([]);
  const [emulatorProfiles, setEmulatorProfiles] = useState<EmulatorProfiles>(createDefaultEmulatorProfiles());
  const [embeddedPreferencesByPlatform, setEmbeddedPreferencesByPlatform] = useState<EmbeddedPreferencesByPlatform>(
    createDefaultEmbeddedPreferencesByPlatform()
  );
  const [gameControlBindingsByGameId, setGameControlBindingsByGameId] = useState<GameControlBindingsByGameId>({});
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [friendsCollapsed, setFriendsCollapsed] = useState(false);
  const [friendEditorOpen, setFriendEditorOpen] = useState(false);
  const [friendDraft, setFriendDraft] = useState<FriendDraft>(defaultFriendDraft());
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'network' | 'system'>('profile');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | PlatformId>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('RECENT');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [signalingUrl, setSignalingUrl] = useState(getDefaultSignalingUrl());
  const [selfNetplayUserId] = useState(getNetplayUserId());
  const [isNetplayConnected, setIsNetplayConnected] = useState(false);
  const [netplayUsers, setNetplayUsers] = useState<NetplayPresenceUser[]>([]);
  const [netplayRoom, setNetplayRoom] = useState<NetplayRoom | null>(null);
  const [netplayInvites, setNetplayInvites] = useState<NetplayInvite[]>([]);
  const [netplayError, setNetplayError] = useState<string | null>(null);
  const [netplayPanelOpen, setNetplayPanelOpen] = useState(false);
  const [activeNetplaySession, setActiveNetplaySession] = useState<ActiveNetplaySession | null>(null);
  const [pendingNetplayLaunchRoom, setPendingNetplayLaunchRoom] = useState<NetplayRoom | null>(null);
  const [netplaySyncStatus, setNetplaySyncStatus] = useState('Ожидание онлайн-сеанса.');
  const [remoteStreamSession, setRemoteStreamSession] = useState<RemoteStreamSession | null>(null);
  const [remoteStreamReady, setRemoteStreamReady] = useState(false);
  const [remoteStreamError, setRemoteStreamError] = useState<string | null>(null);
  const [remoteStreamHasAudio, setRemoteStreamHasAudio] = useState(false);
  const [, setStatusText] = useState('Импортируйте ROM-файлы. Для базовых платформ запуск уже встроен в приложение.');
  const [isLoading, setIsLoading] = useState(true);
  const [activePlayer, setActivePlayer] = useState<EmbeddedLaunchPayload | null>(null);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [playerFrameLoaded, setPlayerFrameLoaded] = useState(false);
  const [playerFrameSessionId, setPlayerFrameSessionId] = useState(0);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [pauseTab, setPauseTab] = useState<(typeof pauseTabs)[number]['id']>('controls');
  const [libraryControlsOpen, setLibraryControlsOpen] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SaveSlotSummary[]>(createEmptySaveSlots());
  const [autoSave, setAutoSave] = useState<AutoSaveSummary>({ hasState: false });
  const [rebindingAction, setRebindingAction] = useState<ControlAction | null>(null);
  const [isBusyWithSlot, setIsBusyWithSlot] = useState<number | null>(null);
  const [isAutoCoverLoading, setIsAutoCoverLoading] = useState(false);
  const [connectedGamepads, setConnectedGamepads] = useState<GamepadSummary[]>([]);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const playerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerFrameRef = useRef<HTMLIFrameElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const playerInstanceRef = useRef<NostalgistInstance | null>(null);
  const playerFramePendingRef = useRef<Map<string, PlayerFrameRequest>>(new Map());
  const playerFrameRequestIdRef = useRef(0);
  const pressedActionsRef = useRef<Set<ControlAction>>(new Set());
  const keyboardPressedActionsRef = useRef<Set<ControlAction>>(new Set());
  const gamepadPressedActionsRef = useRef<Set<ControlAction>>(new Set());
  const remotePressedActionsRef = useRef<Set<ControlAction>>(new Set());
  const pendingRemoteInputsRef = useRef<NetplayInputSignalPayload[]>([]);
  const localNetplayInputQueueRef = useRef<Map<number, NetplayInputSignalPayload[]>>(new Map());
  const remoteNetplayInputQueueRef = useRef<Map<number, NetplayInputSignalPayload[]>>(new Map());
  const pendingNetplayStateSyncRef = useRef<NetplayStateSyncSignalPayload | null>(null);
  const netplayClientRef = useRef<NetplayClient | null>(null);
  const libraryRef = useRef<LibraryGame[]>([]);
  const activePlayerRef = useRef<EmbeddedLaunchPayload | null>(null);
  const remoteStreamSessionRef = useRef<RemoteStreamSession | null>(null);
  const activeNetplaySessionRef = useRef<ActiveNetplaySession | null>(null);
  const netplayPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const netplayPeerRoleRef = useRef<'host' | 'guest' | null>(null);
  const netplayPeerRoomIdRef = useRef<string | null>(null);
  const netplayPendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteMediaStreamRef = useRef<MediaStream | null>(null);
  const hostMediaStreamRef = useRef<MediaStream | null>(null);
  const hostAudioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const localNetplayRomHashRef = useRef<string | null>(null);
  const remoteNetplayRomHashRef = useRef<string | null>(null);
  const localNetplayStateHashRef = useRef<string | null>(null);
  const remoteNetplayStateHashRef = useRef<string | null>(null);
  const netplayHashingRef = useRef(false);
  const netplaySnapshotSyncRef = useRef(false);
  const netplayApplyingSyncRef = useRef(false);
  const lastNetplaySyncRequestAtRef = useRef(0);
  const lastNetplaySyncAtRef = useRef<string | null>(null);
  const netplayFrameRef = useRef(0);
  const connectedGamepadsKeyRef = useRef('');
  const autoCoverQueuedRef = useRef<Set<string>>(new Set());
  const autoCoverAttemptedRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    document.documentElement.dataset.theme = profile.theme;
    document.documentElement.style.setProperty('--accent', profile.accentColor);
  }, [profile.accentColor, profile.theme]);

  useEffect(() => {
    if (!sortMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!sortMenuRef.current || !(event.target instanceof Node)) {
        return;
      }

      if (!sortMenuRef.current.contains(event.target)) {
        setSortMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen && !settingsModalOpen && !libraryControlsOpen && !netplayPanelOpen) {
      return undefined;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || activePlayer || remoteStreamSession) {
        return;
      }

      if (rebindingAction) {
        return;
      }

      if (libraryControlsOpen) {
        event.preventDefault();
        event.stopPropagation();
        setLibraryControlsOpen(false);
        return;
      }

      if (netplayPanelOpen) {
        event.preventDefault();
        event.stopPropagation();
        setNetplayPanelOpen(false);
        return;
      }

      if (settingsModalOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSettingsModalOpen(false);
        return;
      }

      if (accountMenuOpen) {
        event.preventDefault();
        event.stopPropagation();
        setAccountMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalEscape, true);

    return () => {
      window.removeEventListener('keydown', handleGlobalEscape, true);
    };
  }, [accountMenuOpen, activePlayer, libraryControlsOpen, netplayPanelOpen, rebindingAction, remoteStreamSession, settingsModalOpen]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!bridge) {
        setIsLoading(false);
        return;
      }

      try {
        const [info, state] = await Promise.all([bridge.getRuntimeInfo(), bridge.loadState()]);
        if (cancelled) return;
        setRuntimeInfo(info);
        setProfile(state.profile);
        setLibrary(state.library);
        setFriends(state.friends ?? []);
        setEmulatorProfiles(state.emulatorProfiles ?? createDefaultEmulatorProfiles());
        setEmbeddedPreferencesByPlatform(state.embeddedPreferencesByPlatform ?? createDefaultEmbeddedPreferencesByPlatform());
        setGameControlBindingsByGameId(state.gameControlBindingsByGameId ?? {});
        setSelectedGameId((current) => current ?? state.library[0]?.id ?? null);
        setStatusText(state.library.length ? 'Библиотека загружена.' : 'Библиотека пуста. Импортируйте первый ROM.');
      } catch (error) {
        if (cancelled) return;
        setStatusText(error instanceof Error ? error.message : 'Не удалось загрузить состояние приложения.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    setDefaultSignalingUrl(signalingUrl);
  }, [signalingUrl]);

  useEffect(() => () => {
    netplayClientRef.current?.disconnect();
    netplayClientRef.current = null;
    netplayPeerConnectionRef.current?.close();
    hostMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    if (!bridge || isLoading || isAutoCoverLoading) {
      return;
    }

    const now = Date.now();
    const queue = library.filter(
      (game) =>
        !game.coverDataUrl &&
        !autoCoverQueuedRef.current.has(game.id) &&
        now - (autoCoverAttemptedRef.current.get(game.id) ?? 0) > 15000
    );

    if (!queue.length) {
      return;
    }

    const prioritizedGame = selectedGameId ? queue.find((game) => game.id === selectedGameId) ?? null : null;
    const prioritizedQueue =
      prioritizedGame
        ? [prioritizedGame, ...queue.filter((game) => game.id !== prioritizedGame.id)]
        : queue;
    const batch = prioritizedQueue.slice(0, 6);
    batch.forEach((game) => {
      autoCoverQueuedRef.current.add(game.id);
      autoCoverAttemptedRef.current.set(game.id, now);
    });

    let cancelled = false;
    setIsAutoCoverLoading(true);

    void applyAutoCovers(batch).finally(() => {
      batch.forEach((game) => autoCoverQueuedRef.current.delete(game.id));
      if (!cancelled) {
        setIsAutoCoverLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bridge, isAutoCoverLoading, isLoading, library, selectedGameId]);

  useEffect(() => {
    activePlayerRef.current = activePlayer;
  }, [activePlayer]);

  useEffect(() => {
    remoteStreamSessionRef.current = remoteStreamSession;
  }, [remoteStreamSession]);

  useEffect(() => {
    if (!remoteVideoRef.current || !remoteMediaStreamRef.current) {
      return;
    }

    remoteVideoRef.current.srcObject = remoteMediaStreamRef.current;
    void remoteVideoRef.current.play().catch(() => undefined);
  }, [remoteStreamReady, remoteStreamSession]);

  useEffect(() => {
    activeNetplaySessionRef.current = activeNetplaySession;
  }, [activeNetplaySession]);

  useEffect(() => {
    const syncConnectedGamepads = () => {
      const nextGamepads = listConnectedGamepads();
      const nextKey = nextGamepads.map((gamepad) => `${gamepad.index}:${gamepad.id}:${gamepad.mapping}`).join('|');

      if (nextKey !== connectedGamepadsKeyRef.current) {
        connectedGamepadsKeyRef.current = nextKey;
        setConnectedGamepads(nextGamepads);
      }
    };

    syncConnectedGamepads();
    const intervalId = window.setInterval(syncConnectedGamepads, 1000);
    window.addEventListener('gamepadconnected', syncConnectedGamepads);
    window.addEventListener('gamepaddisconnected', syncConnectedGamepads);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('gamepadconnected', syncConnectedGamepads);
      window.removeEventListener('gamepaddisconnected', syncConnectedGamepads);
    };
  }, []);

  const filteredGames = useMemo(
    () =>
      library.filter((game) => {
        const normalizedSearch = search.trim().toLowerCase();
        const matchesSearch =
          !normalizedSearch ||
          `${game.title} ${game.platform} ${game.tags.join(' ')} ${game.romFileName}`.toLowerCase().includes(normalizedSearch);

        if (!matchesSearch) {
          return false;
        }

        if (filter === 'ALL') return true;
        return game.platform === filter;
      }),
    [emulatorProfiles, filter, library, search]
  );

  const visibleGames = useMemo(() => {
    const nextGames = [...filteredGames];

    nextGames.sort((left, right) => {
      switch (sortMode) {
        case 'TITLE':
          return left.title.localeCompare(right.title, 'ru');
        case 'PLATFORM':
          return formatPlatform(left.platform).localeCompare(formatPlatform(right.platform), 'ru') || left.title.localeCompare(right.title, 'ru');
        case 'MOST_PLAYED':
          return right.launchCount - left.launchCount || left.title.localeCompare(right.title, 'ru');
        case 'NEWEST':
          return new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime();
        case 'RECENT':
        default:
          return new Date(right.lastPlayedAt || right.addedAt).getTime() - new Date(left.lastPlayedAt || left.addedAt).getTime();
      }
    });

    return nextGames;
  }, [filteredGames, sortMode]);

  const consoleOptions = useMemo(
    () => libraryConsoleOptions,
    []
  );

  const consoleGameCounts = useMemo(() => {
    const nextCounts: Record<'ALL' | PlatformId, number> = {
      ALL: library.length,
      NES: 0,
      SNES: 0,
      GB: 0,
      GBC: 0,
      GBA: 0,
      MEGADRIVE: 0,
      N64: 0,
      GCN: 0,
      DS: 0,
      '3DS': 0
    };

    for (const game of library) {
      nextCounts[game.platform] += 1;
    }

    return nextCounts;
  }, [library]);

  const activeConsoleOption = consoleOptions.find((option) => option.id === filter) ?? consoleOptions[0];
  const selectedGame = library.find((game) => game.id === selectedGameId) ?? null;
  const accountAvatarSrc = profile.avatarDataUrl || DEFAULT_ACCOUNT_ART;
  const hasCustomAvatar = Boolean(profile.avatarDataUrl);
  const selectedGameDescriptor = selectedGame ? getBuiltInPlatformDescriptor(selectedGame.platform) : null;
  const activePlayerRuntime = activePlayer ? getBuiltInRuntime(activePlayer.game.platform) : null;
  const selectedGamePalette = selectedGame ? getPlatformPalette(selectedGame.platform) : null;
  const selectedGameEmulatorProfile = selectedGame ? emulatorProfiles[selectedGame.platform] ?? createDefaultEmulatorProfiles()[selectedGame.platform] : null;
  const isNative3dsConfigured = selectedGame?.platform === '3DS' && Boolean(selectedGameEmulatorProfile?.executablePath);
  const canLaunchSelectedGame = (selectedGameDescriptor?.canLaunch ?? false) || Boolean(isNative3dsConfigured);
  const canConfigureSelectedGame = selectedGame?.platform === '3DS';
  const selectedGameActionLabel = selectedGameDescriptor?.canLaunch
    ? selectedGameDescriptor.actionLabel
    : selectedGame?.platform === '3DS'
      ? isNative3dsConfigured
        ? 'Играть через 3DS эмулятор'
        : 'Подключить 3DS эмулятор'
      : selectedGameDescriptor?.actionLabel ?? 'Платформа позже';
  const streamedPlatform = remoteStreamSession?.platform ?? null;
  const preferencePlatform = activePlayer?.game.platform ?? streamedPlatform ?? selectedGame?.platform ?? null;
  const controlTargetGame =
    activePlayer?.game ??
    (remoteStreamSession && selectedGame?.platform === remoteStreamSession.platform ? selectedGame : null) ??
    selectedGame ??
    null;
  const currentEmbeddedPreferences = preferencePlatform
    ? embeddedPreferencesByPlatform[preferencePlatform] ?? defaultEmbeddedPreferences()
    : defaultEmbeddedPreferences();
  const currentControlBindings =
    controlTargetGame && preferencePlatform
      ? gameControlBindingsByGameId[controlTargetGame.id] ?? currentEmbeddedPreferences.controlBindings
      : currentEmbeddedPreferences.controlBindings;
  const currentControlLayout = activePlayer
    ? CONTROL_LAYOUTS[activePlayer.game.platform]
    : remoteStreamSession
      ? CONTROL_LAYOUTS[remoteStreamSession.platform]
      : controlTargetGame
        ? CONTROL_LAYOUTS[controlTargetGame.platform]
        : [];
  const visiblePauseTabs = activePlayer && supportsLiveDualScreenLayout(activePlayer.game.platform) ? pauseTabs : pauseTabs.filter((tab) => tab.id !== 'screens');
  const onlineUsers = useMemo(
    () =>
      netplayUsers
        .filter((user) => user.userId !== selfNetplayUserId)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru')),
    [netplayUsers, selfNetplayUserId]
  );
  const currentNetplayMember = netplayRoom?.members.find((member) => member.userId === selfNetplayUserId) ?? null;
  const isNetplayHost = netplayRoom?.hostUserId === selfNetplayUserId;
  const selectedGameNetplaySupported = selectedGame ? supportsExperimentalNetplayPlatform(selectedGame.platform) : false;
  const canCreateNetplayRoom = Boolean(isNetplayConnected && selectedGame && selectedGameNetplaySupported && canLaunchSelectedGame && !activePlayer && !remoteStreamSession && !netplayRoom);
  const activeInvite = netplayInvites[0] ?? null;
  const additionalInviteCount = Math.max(0, netplayInvites.length - 1);

  useEffect(() => {
    if (isNetplayConnected || netplayRoom || activeInvite) {
      setNetplayPanelOpen(true);
    }
  }, [activeInvite, isNetplayConnected, netplayRoom]);

  useEffect(() => {
    if (visiblePauseTabs.some((tab) => tab.id === pauseTab)) {
      return;
    }

    setPauseTab('controls');
  }, [pauseTab, visiblePauseTabs]);

  useEffect(() => {
    if (selectedGameId && library.some((game) => game.id === selectedGameId)) {
      return;
    }

    setSelectedGameId(library[0]?.id ?? null);
  }, [library, selectedGameId]);

  useEffect(() => {
    if (activePlayer || remoteStreamSession) {
      setLibraryControlsOpen(false);
    }
  }, [activePlayer, remoteStreamSession]);

  useEffect(() => {
    if (!selectedGame) {
      setLibraryControlsOpen(false);
      setRebindingAction(null);
    }
  }, [selectedGame]);

  useEffect(() => {
    if (!activeNetplaySession) {
      return;
    }

    if (netplayRoom && netplayRoom.id === activeNetplaySession.roomId && netplayRoom.members.length >= 2) {
      return;
    }

    releaseRemotePressedActions();
    resetNetplaySyncState();
    clearNetplayPeerConnection(activeNetplaySession.localPlayerIndex === 2);
    if (activeNetplaySession.localPlayerIndex === 2) {
      setRemoteStreamSession(null);
    }
    setActiveNetplaySession(null);

    if (activePlayer?.game.id === activeNetplaySession.gameId) {
      setStatusText('Онлайн-сеанс завершен. Можно продолжить локально.');
    } else if (activeNetplaySession.localPlayerIndex === 2) {
      setStatusText('Стрим комнаты завершен.');
    }
  }, [activeNetplaySession, activePlayer?.game.id, netplayRoom]);

  useEffect(() => {
    if (!pendingNetplayLaunchRoom || activePlayer || remoteStreamSession) {
      return;
    }

    const isHostLaunch = pendingNetplayLaunchRoom.hostUserId === selfNetplayUserId;
    const matchingGame = isHostLaunch ? resolveNetplayGame(library, pendingNetplayLaunchRoom) : resolveNetplayGame(library, pendingNetplayLaunchRoom);

    if (isHostLaunch && !matchingGame) {
      setPendingNetplayLaunchRoom(null);
      setStatusText(`Комната запущена для ${pendingNetplayLaunchRoom.gameTitle}. У вас пока не найдена такая же игра в библиотеке.`);
      return;
    }

    if (!supportsExperimentalNetplayPlatform(pendingNetplayLaunchRoom.platform)) {
      setPendingNetplayLaunchRoom(null);
      setStatusText(`Комната запущена для "${pendingNetplayLaunchRoom.gameTitle}", но стриминг от хоста сейчас доступен только для NES, SNES и Mega Drive.`);
      return;
    }

    let cancelled = false;

    if (isHostLaunch && matchingGame) {
      void startEmbeddedLaunchForGame(matchingGame, pendingNetplayLaunchRoom)
        .then((payload) => {
          if (cancelled) {
            return;
          }

          setStatusText(`Онлайн-сеанс подготовлен: ${payload.game.title}. Вы хост комнаты.`);
        })
        .catch((error) => {
          if (!cancelled) {
            setStatusText(error instanceof Error ? error.message : 'Не удалось подготовить онлайн-сеанс.');
          }
        })
        .finally(() => {
          if (!cancelled) {
            setPendingNetplayLaunchRoom(null);
          }
        });
    } else {
      startRemoteStreamViewer(pendingNetplayLaunchRoom);
      setPendingNetplayLaunchRoom(null);
    }

    return () => {
      cancelled = true;
    };
  }, [activePlayer, library, pendingNetplayLaunchRoom, remoteStreamSession, selfNetplayUserId]);

  const resetNetplaySyncState = () => {
    pendingNetplayStateSyncRef.current = null;
    localNetplayRomHashRef.current = null;
    remoteNetplayRomHashRef.current = null;
    localNetplayStateHashRef.current = null;
    remoteNetplayStateHashRef.current = null;
    localNetplayInputQueueRef.current.clear();
    remoteNetplayInputQueueRef.current.clear();
    netplayHashingRef.current = false;
    netplaySnapshotSyncRef.current = false;
    netplayApplyingSyncRef.current = false;
    lastNetplaySyncRequestAtRef.current = 0;
    lastNetplaySyncAtRef.current = null;
    netplayFrameRef.current = 0;
    setNetplaySyncStatus('Ожидание онлайн-сеанса.');
  };

  const resetRemoteStreamViewState = () => {
    setRemoteStreamReady(false);
    setRemoteStreamError(null);
    setRemoteStreamHasAudio(false);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (remoteMediaStreamRef.current) {
      remoteMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteMediaStreamRef.current = null;
    }
  };

  const clearNetplayPeerConnection = (resetViewerState = false) => {
    netplayPendingIceCandidatesRef.current = [];

    const connection = netplayPeerConnectionRef.current;
    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
      connection.close();
    }

    netplayPeerConnectionRef.current = null;
    netplayPeerRoleRef.current = null;
    netplayPeerRoomIdRef.current = null;

    if (hostMediaStreamRef.current) {
      hostMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      hostMediaStreamRef.current = null;
    }

    hostAudioDestinationRef.current = null;

    if (resetViewerState) {
      resetRemoteStreamViewState();
    }
  };

  const extractAudioContextFromValue = (root: unknown): AudioContext | null => {
    const visited = new WeakSet<object>();
    const queue: unknown[] = [root];
    let iterations = 0;

    while (queue.length && iterations < 300) {
      const current = queue.shift();
      iterations += 1;

      if (isAudioContextLike(current)) {
        return current;
      }

      if (!current || typeof current !== 'object') {
        continue;
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      for (const value of Object.values(current)) {
        queue.push(value);
      }
    }

    return null;
  };

  const extractBestAudioNodeCandidate = (root: unknown, audioContext: AudioContext): AudioNode | null => {
    const visited = new WeakSet<object>();
    const queue: Array<{ value: unknown; score: number }> = [{ value: root, score: 0 }];
    let bestCandidate: { node: AudioNode; score: number } | null = null;
    let iterations = 0;

    while (queue.length && iterations < 500) {
      const current = queue.shift();
      iterations += 1;

      if (!current) {
        continue;
      }

      const value = current.value;
      if (isAudioNodeLike(value) && value.context === audioContext && value !== audioContext.destination) {
        const constructorName = value.constructor?.name ?? '';
        const nextScore =
          current.score +
          (constructorName.includes('Gain') ? 100 : 0) +
          (constructorName.includes('Dynamics') ? 80 : 0) +
          (constructorName.includes('Destination') ? -200 : 0);

        if (!bestCandidate || nextScore > bestCandidate.score) {
          bestCandidate = { node: value, score: nextScore };
        }
      }

      if (!value || typeof value !== 'object') {
        continue;
      }

      if (visited.has(value)) {
        continue;
      }

      visited.add(value);

      if (Array.isArray(value)) {
        value.forEach((entry) => queue.push({ value: entry, score: current.score }));
        continue;
      }

      for (const [key, nestedValue] of Object.entries(value)) {
        let boost = current.score;

        if (/master|main|mix|output|gain|ctx|audio/i.test(key)) {
          boost += 20;
        }

        queue.push({ value: nestedValue, score: boost });
      }
    }

    return bestCandidate?.node ?? null;
  };

  const tryCreateHostAudioTrack = (): MediaStreamTrack | null => {
    const instance = playerInstanceRef.current;
    if (!instance) {
      return null;
    }

    try {
      const emscriptenAl = typeof instance.getEmscriptenAL === 'function' ? instance.getEmscriptenAL() : null;
      const audioContext = extractAudioContextFromValue(emscriptenAl);
      if (!audioContext) {
        return null;
      }

      const sourceNode = extractBestAudioNodeCandidate(emscriptenAl, audioContext);
      if (!sourceNode) {
        return null;
      }

      const destination = audioContext.createMediaStreamDestination();
      sourceNode.connect(destination);
      hostAudioDestinationRef.current = destination;
      return destination.stream.getAudioTracks()[0] ?? null;
    } catch {
      return null;
    }
  };

  const flushPendingNetplayIceCandidates = async (connection: RTCPeerConnection) => {
    if (!netplayPendingIceCandidatesRef.current.length) {
      return;
    }

    const pending = [...netplayPendingIceCandidatesRef.current];
    netplayPendingIceCandidatesRef.current = [];

    for (const candidate of pending) {
      try {
        await connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignored
      }
    }
  };

  const ensureNetplayPeerConnection = (role: 'host' | 'guest', roomId: string) => {
    const existing = netplayPeerConnectionRef.current;
    if (existing && netplayPeerRoleRef.current === role && netplayPeerRoomIdRef.current === roomId) {
      return existing;
    }

    clearNetplayPeerConnection(role === 'guest');

    const connection = new RTCPeerConnection(NETPLAY_RTC_CONFIGURATION);
    netplayPeerConnectionRef.current = connection;
    netplayPeerRoleRef.current = role;
    netplayPeerRoomIdRef.current = roomId;

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      netplayClientRef.current?.sendSignal('stream-ice', {
        candidate: event.candidate.toJSON()
      });
    };

      connection.onconnectionstatechange = () => {
        if (role === 'guest' && connection.connectionState === 'connected') {
          setRemoteStreamReady(true);
          setNetplaySyncStatus(remoteMediaStreamRef.current?.getAudioTracks().length ? 'Видео и звук от хоста подключены.' : 'Видео от хоста подключено.');
        }

      if (connection.connectionState === 'failed') {
        if (role === 'guest') {
          setRemoteStreamError('Не удалось подключиться к стриму хоста.');
        }
        setNetplaySyncStatus('Стрим разорван. Попробуйте создать комнату заново.');
      }
    };

    if (role === 'guest') {
      connection.ontrack = (event) => {
        const incomingStream = event.streams[0] ?? new MediaStream([event.track]);
        const previousStream = remoteMediaStreamRef.current;

        if (previousStream && previousStream !== incomingStream) {
          previousStream.getTracks().forEach((track) => track.stop());
        }

        remoteMediaStreamRef.current = incomingStream;

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = incomingStream;
          void remoteVideoRef.current.play().catch(() => undefined);
        }

        setRemoteStreamReady(true);
        setRemoteStreamError(null);
        const hasAudio = incomingStream.getAudioTracks().length > 0;
        setRemoteStreamHasAudio(hasAudio);
        setRemoteStreamSession((current) => (current ? { ...current, audioAvailable: hasAudio } : current));
        setNetplaySyncStatus(hasAudio ? 'Видео и звук от хоста подключены.' : 'Видео от хоста подключено.');
      };
    }

    return connection;
  };

  const pushNetplayIceCandidate = async (candidate: RTCIceCandidateInit) => {
    const connection = netplayPeerConnectionRef.current;
    if (!connection || !connection.remoteDescription) {
      netplayPendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await connection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ignored
    }
  };

  const startRemoteStreamViewer = (room: NetplayRoom) => {
    setAccountMenuOpen(false);
    setPlayerError(null);
    setPauseMenuOpen(false);
    setRebindingAction(null);
    setLibraryControlsOpen(false);
    releasePressedActions();
    releaseRemotePressedActions();
    resetNetplaySyncState();
    clearNetplayPeerConnection(true);

    const nextSession: ActiveNetplaySession = {
      roomId: room.id,
      gameId: room.gameId,
      gameTitle: room.gameTitle,
      platform: room.platform,
      localPlayerIndex: 2,
      remotePlayerIndex: 1,
      launchMode: 'host-stream'
    };

    ensureNetplayPeerConnection('guest', room.id);
    setRemoteStreamSession({
      roomId: room.id,
      gameTitle: room.gameTitle,
      platform: room.platform,
      audioAvailable: false
    });
    activeNetplaySessionRef.current = nextSession;
    setActiveNetplaySession(nextSession);
    setRemoteStreamReady(false);
    setRemoteStreamError(null);
    setNetplaySyncStatus('Подключаюсь к видео хоста...');
    setStatusText(`Подключаюсь к стриму комнаты: ${room.gameTitle}.`);
  };

  const startHostNetplayStream = async () => {
    const session = activeNetplaySessionRef.current;
    const currentPlayer = activePlayerRef.current;

    if (
      !session ||
      session.launchMode !== 'host-stream' ||
      session.localPlayerIndex !== 1 ||
      !currentPlayer ||
      currentPlayer.game.id !== session.gameId ||
      getBuiltInRuntime(currentPlayer.game.platform) !== 'nostalgist' ||
      !playerCanvasRef.current
    ) {
      return;
    }

    const connection = ensureNetplayPeerConnection('host', session.roomId);

    if (!hostMediaStreamRef.current) {
      if (typeof playerCanvasRef.current.captureStream !== 'function') {
        throw new Error('Canvas stream недоступен в текущем рантайме Electron.');
      }

      const videoStream = playerCanvasRef.current.captureStream(60);
      const stream = new MediaStream();
      const videoTracks = videoStream.getVideoTracks();
      const audioTrack = tryCreateHostAudioTrack();

      videoTracks.forEach((track) => stream.addTrack(track));

      if (audioTrack) {
        stream.addTrack(audioTrack);
      }

      hostMediaStreamRef.current = stream;
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));

      setNetplaySyncStatus(audioTrack ? 'Стрим запущен со звуком.' : 'Стрим запущен. Текущее ядро не отдало аудиодорожку.');
    }

    if (connection.localDescription?.type === 'offer') {
      return;
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    netplayClientRef.current?.sendSignal('stream-offer', {
      type: offer.type,
      sdp: offer.sdp ?? ''
    });
    setNetplaySyncStatus(hostMediaStreamRef.current?.getAudioTracks().length ? 'Стрим отправлен гостю со звуком.' : 'Стрим отправлен гостю без звука.');
  };

  const stopPlayer = () => {
    clearPlayerFramePending();
    setPlayerFrameLoaded(false);

    if (activePlayerRuntime !== 'nostalgist') {
      const frame = playerFrameRef.current;
      if (frame) {
        frame.src = 'about:blank';
      }
      playerInstanceRef.current = null;
      return;
    }

    const instance = playerInstanceRef.current;

    if (!instance) {
      return;
    }

    try {
      instance.exit({ removeCanvas: false });
    } catch {
      // ignored
    }

    playerInstanceRef.current = null;
  };

  const releaseRemotePressedActions = () => {
    const session = activeNetplaySessionRef.current;
    const instance = playerInstanceRef.current;

    if (session && instance) {
      for (const action of remotePressedActionsRef.current) {
        try {
          instance.pressUp({ button: action, player: session.remotePlayerIndex });
        } catch {
          // ignored
        }
      }
    }

    remotePressedActionsRef.current.clear();
    pendingRemoteInputsRef.current = [];
    remoteNetplayInputQueueRef.current.clear();
  };

  const applyRemoteNetplayInput = (payload: NetplayInputSignalPayload) => {
    const session = activeNetplaySessionRef.current;
    const instance = playerInstanceRef.current;

    if (!session) {
      return;
    }

    if (!instance) {
      pendingRemoteInputsRef.current.push(payload);
      return;
    }

    try {
      if (payload.pressed) {
        remotePressedActionsRef.current.add(payload.action);
        instance.pressDown({ button: payload.action, player: session.remotePlayerIndex });
      } else {
        remotePressedActionsRef.current.delete(payload.action);
        instance.pressUp({ button: payload.action, player: session.remotePlayerIndex });
      }
    } catch {
      // ignored
    }
  };

  const applyLocalNetplayInput = (payload: NetplayInputSignalPayload) => {
    const instance = playerInstanceRef.current;
    const localPlayerIndex = getActiveLocalPlayerIndex();

    if (!instance) {
      return;
    }

    try {
      if (payload.pressed) {
        pressedActionsRef.current.add(payload.action);
        instance.pressDown({ button: payload.action, player: localPlayerIndex });
      } else {
        pressedActionsRef.current.delete(payload.action);
        instance.pressUp({ button: payload.action, player: localPlayerIndex });
      }
    } catch {
      // ignored
    }
  };

  const flushQueuedNetplayInputs = (
    queue: MutableRefObject<Map<number, NetplayInputSignalPayload[]>>,
    applyInput: (payload: NetplayInputSignalPayload) => void
  ) => {
    if (!queue.current.size) {
      return;
    }

    const currentFrame = netplayFrameRef.current;
    const dueFrames = Array.from(queue.current.keys())
      .filter((frame) => frame <= currentFrame)
      .sort((left, right) => left - right);

    for (const frame of dueFrames) {
      const inputs = queue.current.get(frame) ?? [];
      queue.current.delete(frame);
      inputs.forEach((payload) => applyInput(payload));
    }
  };

  const flushRemoteNetplayInputs = () => {
    const queuedInputs = [...pendingRemoteInputsRef.current];
    pendingRemoteInputsRef.current = [];
    queuedInputs.forEach((payload) => {
      if (typeof payload.frame === 'number') {
        enqueueNetplayFrameInput(remoteNetplayInputQueueRef, payload.frame, payload);
        return;
      }

      applyRemoteNetplayInput(payload);
    });

    flushQueuedNetplayInputs(remoteNetplayInputQueueRef, applyRemoteNetplayInput);
    flushQueuedNetplayInputs(localNetplayInputQueueRef, applyLocalNetplayInput);
  };

  const pressLocalAction = (action: ControlAction, source: 'keyboard' | 'gamepad') => {
    const sourceSet = source === 'keyboard' ? keyboardPressedActionsRef.current : gamepadPressedActionsRef.current;
    const wasPressedByAnySource = keyboardPressedActionsRef.current.has(action) || gamepadPressedActionsRef.current.has(action);
    const session = activeNetplaySessionRef.current;

    if (sourceSet.has(action)) {
      return;
    }

    sourceSet.add(action);

    if (wasPressedByAnySource) {
      return;
    }

    if (!activePlayer && remoteStreamSessionRef.current && session?.launchMode === 'host-stream' && session.localPlayerIndex === 2) {
      pressedActionsRef.current.add(action);
      netplayClientRef.current?.sendSignal('host-input', { action, pressed: true });
      return;
    }

    if (activePlayerRuntime === 'emulatorjs') {
      pressedActionsRef.current.add(action);
      postPlayerFrameActionInput(action, true);
      return;
    }

    if (activePlayerRuntime !== 'nostalgist') {
      return;
    }

    if (session?.launchMode === 'experimental-relay') {
      const targetFrame = netplayFrameRef.current + NETPLAY_INPUT_FRAME_DELAY;
      const payload: NetplayInputSignalPayload = { action, pressed: true, frame: targetFrame };
      enqueueNetplayFrameInput(localNetplayInputQueueRef, targetFrame, payload);
      netplayClientRef.current?.sendSignal('input', payload);
      return;
    }

    pressedActionsRef.current.add(action);
    const localPlayerIndex = getActiveLocalPlayerIndex();

    try {
      playerInstanceRef.current?.pressDown({ button: action, player: localPlayerIndex });
    } catch {
      // ignored
    }
  };

  const releaseLocalAction = (action: ControlAction, source: 'keyboard' | 'gamepad') => {
    const sourceSet = source === 'keyboard' ? keyboardPressedActionsRef.current : gamepadPressedActionsRef.current;
    sourceSet.delete(action);
    const wasPressed = pressedActionsRef.current.has(action);
    const session = activeNetplaySessionRef.current;

    const stillPressed =
      keyboardPressedActionsRef.current.has(action) || gamepadPressedActionsRef.current.has(action);

    if (stillPressed) {
      return;
    }

    if (!activePlayer && remoteStreamSessionRef.current && session?.launchMode === 'host-stream' && session.localPlayerIndex === 2) {
      if (!wasPressed) {
        return;
      }

      pressedActionsRef.current.delete(action);
      netplayClientRef.current?.sendSignal('host-input', { action, pressed: false });
      return;
    }

    if (activePlayerRuntime === 'emulatorjs') {
      if (wasPressed) {
        pressedActionsRef.current.delete(action);
        postPlayerFrameActionInput(action, false);
      }
      return;
    }

    if (activePlayerRuntime !== 'nostalgist') {
      pressedActionsRef.current.delete(action);
      return;
    }

    if (session?.launchMode === 'experimental-relay') {
      pressedActionsRef.current.delete(action);
      const targetFrame = netplayFrameRef.current + NETPLAY_INPUT_FRAME_DELAY;
      const payload: NetplayInputSignalPayload = { action, pressed: false, frame: targetFrame };
      enqueueNetplayFrameInput(localNetplayInputQueueRef, targetFrame, payload);
      netplayClientRef.current?.sendSignal('input', payload);
      return;
    }

    if (!wasPressed) {
      return;
    }

    pressedActionsRef.current.delete(action);

    const localPlayerIndex = getActiveLocalPlayerIndex();

    try {
      playerInstanceRef.current?.pressUp({ button: action, player: localPlayerIndex });
    } catch {
      // ignored
    }
  };

  const saveEmbeddedPreferencePatch = async (patch: Partial<EmbeddedPreferences>) => {
    const platform = activePlayer?.game.platform ?? selectedGame?.platform;
    if (!platform) {
      return defaultEmbeddedPreferences();
    }

    const basePreferences = embeddedPreferencesByPlatform[platform] ?? defaultEmbeddedPreferences();
    const nextPreferences: EmbeddedPreferences = { ...basePreferences, ...patch };

    setEmbeddedPreferencesByPlatform((current) => ({
      ...current,
      [platform]: nextPreferences
    }));
    setActivePlayer((current) =>
      current && current.game.platform === platform
        ? {
            ...current,
            preferences: {
              ...nextPreferences,
              controlBindings: current.preferences.controlBindings
            }
          }
        : current
    );

    if (!bridge) {
      return nextPreferences;
    }

    const saved = await bridge.saveEmbeddedPreferences(platform, patch);
    setEmbeddedPreferencesByPlatform(saved);
    const resolvedPreferences = saved[platform] ?? nextPreferences;
    setActivePlayer((current) =>
      current && current.game.platform === platform
        ? {
            ...current,
            preferences: {
              ...resolvedPreferences,
              controlBindings: current.preferences.controlBindings
            }
          }
        : current
    );

    return resolvedPreferences;
  };

  const saveGameControlBindingPatch = async (patch: Partial<ControlBindings>) => {
    const game = activePlayer?.game ?? selectedGame;
    if (!game) {
      return defaultControlBindings();
    }

    const platformDefaults = embeddedPreferencesByPlatform[game.platform] ?? defaultEmbeddedPreferences();
    const baseBindings = gameControlBindingsByGameId[game.id] ?? platformDefaults.controlBindings;
    const nextBindings: ControlBindings = {
      ...baseBindings,
      ...patch
    };

    setGameControlBindingsByGameId((current) => ({
      ...current,
      [game.id]: nextBindings
    }));
    setActivePlayer((current) =>
      current && current.game.id === game.id
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              controlBindings: nextBindings
            }
          }
        : current
    );

    if (!bridge) {
      if (activePlayer && activePlayerRuntime === 'emulatorjs' && activePlayer.game.id === game.id) {
        void sendPlayerFrameCommand('set-control-bindings', { controlBindings: nextBindings }).catch(() => undefined);
      }

      return nextBindings;
    }

    const saved = await bridge.saveGameControlBindings(game.id, patch);
    const resolvedBindings = saved[game.id] ?? nextBindings;

    setGameControlBindingsByGameId(saved);
    setActivePlayer((current) =>
      current && current.game.id === game.id
        ? {
            ...current,
            preferences: {
              ...current.preferences,
              controlBindings: resolvedBindings
            }
          }
        : current
    );

    if (activePlayer && activePlayerRuntime === 'emulatorjs' && activePlayer.game.id === game.id) {
      void sendPlayerFrameCommand('set-control-bindings', { controlBindings: resolvedBindings }).catch(() => undefined);
    }

    return resolvedBindings;
  };

  const updateLibraryGame = (updatedGame: LibraryGame) => {
    setLibrary((current) => current.map((game) => (game.id === updatedGame.id ? updatedGame : game)));
  };

  const applyAutoCovers = async (games: LibraryGame[]): Promise<number> => {
    if (!bridge) {
      return 0;
    }

    let appliedCovers = 0;

    for (const game of games) {
      if (game.coverDataUrl) {
        continue;
      }

      try {
        const updated = await bridge.fetchAutoCover(game.id);
        if (!updated) {
          continue;
        }
        updateLibraryGame(updated);
        appliedCovers += 1;
      } catch {
        // ignored
      }
    }

    return appliedCovers;
  };

  const refreshSaveSlots = async (gameId: string) => {
    if (!bridge) {
      return createEmptySaveSlots();
    }

    const slots = await bridge.getGameSaveSlots(gameId);
    setSaveSlots(slots);
    return slots;
  };

  const refreshAutoSave = async (gameId: string) => {
    if (!bridge) {
      const empty = { hasState: false };
      setAutoSave(empty);
      return empty;
    }

    const summary = await bridge.getAutoSave(gameId);
    setAutoSave(summary);
    return summary;
  };

  const clearPlayerFramePending = (message = 'Сеанс встроенного плеера завершен.') => {
    for (const [requestId, pending] of playerFramePendingRef.current.entries()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
      playerFramePendingRef.current.delete(requestId);
    }
  };

  const sendPlayerFrameCommand = (command: string, payload: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const frameWindow = playerFrameRef.current?.contentWindow;

      if (!frameWindow) {
        reject(new Error('Встроенный player для N64/DS еще не готов.'));
        return;
      }

      const requestId = `frame-${Date.now()}-${playerFrameRequestIdRef.current}`;
      playerFrameRequestIdRef.current += 1;
      const timeoutId = window.setTimeout(() => {
        playerFramePendingRef.current.delete(requestId);
        reject(new Error('Встроенный player не ответил вовремя.'));
      }, 10000);

      playerFramePendingRef.current.set(requestId, { resolve, reject, timeoutId });
      frameWindow.postMessage({ source: EMUSOL_FRAME_SOURCE, type: 'command', command, payload, requestId }, '*');
    });

  const postPlayerFrameActionInput = (action: ControlAction, pressed: boolean) => {
    const frameWindow = playerFrameRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage(
      {
        source: EMUSOL_FRAME_SOURCE,
        type: 'input-action',
        payload: {
          action,
          binding: getCanonicalEmulatorJsBinding(action),
          pressed
        }
      },
      '*'
    );
  };

  const enqueueNetplayFrameInput = (
    queue: MutableRefObject<Map<number, NetplayInputSignalPayload[]>>,
    frame: number,
    payload: NetplayInputSignalPayload
  ) => {
    const normalizedFrame = Math.max(0, Math.round(frame));
    const bucket = queue.current.get(normalizedFrame) ?? [];
    bucket.push({ ...payload, frame: normalizedFrame });
    queue.current.set(normalizedFrame, bucket);
  };

  const getActiveLocalPlayerIndex = (): NetplayPlayerIndex =>
    activeNetplaySessionRef.current?.localPlayerIndex ?? 1;

  const releasePressedActions = () => {
    localNetplayInputQueueRef.current.clear();
    remoteNetplayInputQueueRef.current.clear();
    const session = activeNetplaySessionRef.current;

    if (!activePlayer && remoteStreamSessionRef.current && session?.launchMode === 'host-stream' && session.localPlayerIndex === 2) {
      for (const action of pressedActionsRef.current) {
        netplayClientRef.current?.sendSignal('host-input', { action, pressed: false });
      }

      pressedActionsRef.current.clear();
      keyboardPressedActionsRef.current.clear();
      gamepadPressedActionsRef.current.clear();
      return;
    }

    if (activePlayerRuntime === 'emulatorjs') {
      for (const action of pressedActionsRef.current) {
        postPlayerFrameActionInput(action, false);
      }

      pressedActionsRef.current.clear();
      keyboardPressedActionsRef.current.clear();
      gamepadPressedActionsRef.current.clear();
      return;
    }

    if (activePlayerRuntime !== 'nostalgist') {
      pressedActionsRef.current.clear();
      keyboardPressedActionsRef.current.clear();
      gamepadPressedActionsRef.current.clear();
      return;
    }

    const instance = playerInstanceRef.current;
    const localPlayerIndex = getActiveLocalPlayerIndex();

    for (const action of pressedActionsRef.current) {
      try {
        instance?.pressUp({ button: action, player: localPlayerIndex });
        if (session?.launchMode === 'experimental-relay') {
          netplayClientRef.current?.sendSignal('input', { action, pressed: false });
        }
      } catch {
        // ignored
      }
    }

    pressedActionsRef.current.clear();
    keyboardPressedActionsRef.current.clear();
    gamepadPressedActionsRef.current.clear();
  };

  const saveCurrentPlayerState = async () => {
    if (activePlayerRuntime === 'emulatorjs') {
      const result = await sendPlayerFrameCommand('save-state');
      const stateBase64 = result.stateBase64;

      if (typeof stateBase64 !== 'string' || !stateBase64) {
        throw new Error('Встроенный player не вернул сохранение состояния.');
      }

      return {
        stateBase64,
        thumbnailDataUrl: typeof result.thumbnailDataUrl === 'string' ? result.thumbnailDataUrl : undefined
      };
    }

    if (!playerInstanceRef.current) {
      throw new Error('Эмулятор еще не готов.');
    }

    const { state, thumbnail } = await playerInstanceRef.current.saveState();
    return {
      stateBase64: await blobToBase64(state),
      thumbnailDataUrl: thumbnail ? await blobToDataUrl(thumbnail) : undefined
    };
  };

  const loadCurrentPlayerState = async (stateBase64: string, fileName: string) => {
    if (activePlayerRuntime === 'emulatorjs') {
      await sendPlayerFrameCommand('load-state', { stateBase64, fileName });
      return;
    }

    if (!playerInstanceRef.current) {
      throw new Error('Эмулятор еще не готов.');
    }

    await playerInstanceRef.current.loadState(base64ToFile(stateBase64, fileName));
  };

  const pauseCurrentPlayer = async () => {
    if (activePlayerRuntime === 'emulatorjs') {
      await sendPlayerFrameCommand('pause');
      return;
    }

    playerInstanceRef.current?.pause();
  };

  const resumeCurrentPlayer = async () => {
    if (activePlayerRuntime === 'emulatorjs') {
      await sendPlayerFrameCommand('resume');
      return;
    }

    playerInstanceRef.current?.resume();
  };

  const restartCurrentPlayer = async () => {
    if (activePlayerRuntime === 'emulatorjs') {
      await sendPlayerFrameCommand('restart');
      return;
    }

    playerInstanceRef.current?.restart();
  };

  const applyCurrentPlayerAudio = async (volumePercent: number, muted: boolean) => {
    if (activePlayerRuntime === 'emulatorjs') {
      await sendPlayerFrameCommand('set-audio', { volumePercent, muted });
      return;
    }

    const instance = playerInstanceRef.current;
    if (!instance) {
      return;
    }

    if (muted) {
      instance.sendCommand('MUTE');
      return;
    }
  };

  const applyCurrentPlayerVideo = async (preferences: EmbeddedPreferences) => {
    if (!activePlayer || activePlayerRuntime !== 'emulatorjs' || !supportsLiveVideoSettings(activePlayer.game.platform)) {
      return;
    }

    await sendPlayerFrameCommand('set-video-options', {
      videoFilter: preferences.videoFilter,
      aspectRatio: preferences.aspectRatio,
      integerScale: preferences.integerScale
    });
  };

  const applyCurrentDualScreenLayout = async (preferences: EmbeddedPreferences) => {
    if (!activePlayer || activePlayerRuntime !== 'emulatorjs' || !supportsLiveDualScreenLayout(activePlayer.game.platform)) {
      return;
    }

    await sendPlayerFrameCommand('set-dual-screen-layout', {
      secondScreenLayout: preferences.secondScreenLayout,
      primaryScreen: preferences.primaryScreen,
      secondScreenSizePercent: preferences.secondScreenSizePercent,
      primaryScreenScaleMode: preferences.primaryScreenScaleMode,
      secondaryScreenScaleMode: preferences.secondaryScreenScaleMode
    });
  };

  const syncLiveDualScreenPreferences = async (preferences: EmbeddedPreferences) => {
    if (activePlayer && activePlayerRuntime === 'emulatorjs' && supportsLiveDualScreenLayout(activePlayer.game.platform)) {
      await applyCurrentDualScreenLayout(preferences);
    }
  };

  const abortNetplaySession = (message: string) => {
    releasePressedActions();
    releaseRemotePressedActions();
    setPendingNetplayLaunchRoom(null);
    activeNetplaySessionRef.current = null;
    setActiveNetplaySession(null);
    resetNetplaySyncState();
    netplayClientRef.current?.leaveRoom();
    setStatusText(message);
  };

  const requestNetplayStateSync = (reason: 'initial' | 'mismatch') => {
    const now = Date.now();

    if (now - lastNetplaySyncRequestAtRef.current < 1500) {
      return;
    }

    lastNetplaySyncRequestAtRef.current = now;
    netplayClientRef.current?.sendSignal('state-sync-request', { reason });
  };

  const sendAuthoritativeNetplayStateSync = async (reason: 'initial' | 'mismatch' | 'request') => {
    const session = activeNetplaySessionRef.current;
    const currentPlayer = activePlayerRef.current;

    if (
      !session ||
      session.localPlayerIndex !== 1 ||
      !currentPlayer ||
      currentPlayer.game.id !== session.gameId ||
      getBuiltInRuntime(currentPlayer.game.platform) !== 'nostalgist' ||
      netplaySnapshotSyncRef.current ||
      netplayApplyingSyncRef.current
    ) {
      return;
    }

    netplaySnapshotSyncRef.current = true;

    try {
      const { stateBase64 } = await saveCurrentPlayerState();
      const stateHash = await computeStableHashFromBase64(stateBase64);
      localNetplayStateHashRef.current = stateHash;
      lastNetplaySyncAtRef.current = new Date().toISOString();
      setNetplaySyncStatus(`Host-снимок отправлен (${reason}).`);
      netplayClientRef.current?.sendSignal('state-sync', { stateBase64, stateHash, reason });
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось отправить host-снимок для онлайн-синхронизации.');
    } finally {
      netplaySnapshotSyncRef.current = false;
    }
  };

  const applyIncomingNetplayStateSync = async (payload: NetplayStateSyncSignalPayload) => {
    const session = activeNetplaySessionRef.current;
    const currentPlayer = activePlayerRef.current;

    if (!session || session.localPlayerIndex !== 2) {
      return;
    }

    if (!currentPlayer || currentPlayer.game.id !== session.gameId || getBuiltInRuntime(currentPlayer.game.platform) !== 'nostalgist') {
      pendingNetplayStateSyncRef.current = payload;
      return;
    }

    if (netplayApplyingSyncRef.current || netplayHashingRef.current || netplaySnapshotSyncRef.current) {
      pendingNetplayStateSyncRef.current = payload;
      return;
    }

    netplayApplyingSyncRef.current = true;

    try {
      await loadCurrentPlayerState(payload.stateBase64, `${currentPlayer.game.romFileName}.netplay.state`);
      localNetplayStateHashRef.current = payload.stateHash;
      remoteNetplayStateHashRef.current = payload.stateHash;
      lastNetplaySyncAtRef.current = new Date().toISOString();
      setNetplaySyncStatus(`Синхронизировано по host-снимку (${payload.reason}).`);
      if (payload.reason !== 'initial') {
        setStatusText('Online-сеанс пересинхронизирован по состоянию хоста.');
      }
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось применить host-состояние для онлайн-синхронизации.');
    } finally {
      netplayApplyingSyncRef.current = false;

      if (pendingNetplayStateSyncRef.current && pendingNetplayStateSyncRef.current !== payload) {
        const nextPayload = pendingNetplayStateSyncRef.current;
        pendingNetplayStateSyncRef.current = null;
        void applyIncomingNetplayStateSync(nextPayload);
      }
    }
  };

  const flushPendingNetplayStateSync = async () => {
    if (!pendingNetplayStateSyncRef.current) {
      return;
    }

    const pendingPayload = pendingNetplayStateSyncRef.current;
    pendingNetplayStateSyncRef.current = null;
    await applyIncomingNetplayStateSync(pendingPayload);
  };

  const verifyCurrentNetplayRomHash = async () => {
    const session = activeNetplaySessionRef.current;
    const currentPlayer = activePlayerRef.current;

    if (!session || !currentPlayer || currentPlayer.game.id !== session.gameId) {
      return;
    }

    const romHash = await computeStableHashFromBase64(currentPlayer.romBase64);
    localNetplayRomHashRef.current = romHash;
    setNetplaySyncStatus('ROM проверен. Жду подтверждение второй стороны.');
    netplayClientRef.current?.sendSignal('rom-hash', { romHash });

    if (remoteNetplayRomHashRef.current && remoteNetplayRomHashRef.current !== romHash) {
      abortNetplaySession('ROM не совпадает с другом. Online-сеанс остановлен, чтобы не допустить рассинхрон.');
      return;
    }

    if (remoteNetplayRomHashRef.current === romHash) {
      setNetplaySyncStatus('ROM совпадает. Слежу за синхроном состояний.');
    }
  };

  const publishCurrentNetplayStateHash = async () => {
    const session = activeNetplaySessionRef.current;
    const currentPlayer = activePlayerRef.current;

    if (
      !session ||
      !currentPlayer ||
      currentPlayer.game.id !== session.gameId ||
      getBuiltInRuntime(currentPlayer.game.platform) !== 'nostalgist' ||
      netplayHashingRef.current ||
      netplaySnapshotSyncRef.current ||
      netplayApplyingSyncRef.current
    ) {
      return;
    }

    netplayHashingRef.current = true;

    try {
      const { stateBase64 } = await saveCurrentPlayerState();
      const stateHash = await computeStableHashFromBase64(stateBase64);
      localNetplayStateHashRef.current = stateHash;
      setNetplaySyncStatus('Состояние проверено. Расхождение не обнаружено.');
      netplayClientRef.current?.sendSignal('state-hash', { stateHash });

      if (session.localPlayerIndex === 2 && remoteNetplayStateHashRef.current && remoteNetplayStateHashRef.current !== stateHash) {
        setNetplaySyncStatus('Найдено расхождение. Запрашиваю host-снимок.');
        requestNetplayStateSync('mismatch');
      }
    } catch {
      // ignored
    } finally {
      netplayHashingRef.current = false;
    }
  };

  const persistAutoSave = async () => {
    if (!activePlayer || !bridge || playerError) {
      return;
    }

    if (activePlayerRuntime === 'nostalgist' && !playerInstanceRef.current) {
      return;
    }

    try {
      const { stateBase64, thumbnailDataUrl } = await saveCurrentPlayerState();
      const summary = await bridge.saveAutoState(activePlayer.game.id, stateBase64, thumbnailDataUrl);
      setAutoSave(summary);
      setStatusText(`Автосейв обновлен для ${activePlayer.game.title}.`);
    } catch {
      // ignored
    }
  };

  const openPauseMenu = async () => {
    if (activeNetplaySessionRef.current) {
      setStatusText('Во время онлайн-сеанса пауза, слоты и перезапуск отключены.');
      return;
    }

    if (!activePlayer || playerError) {
      return;
    }

    try {
      releasePressedActions();
      await pauseCurrentPlayer();
      setPauseMenuOpen(true);
      setPauseTab('controls');
      setRebindingAction(null);
      await refreshSaveSlots(activePlayer.game.id);
      await refreshAutoSave(activePlayer.game.id);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось открыть меню паузы.');
    }
  };

  const closePauseMenu = () => {
    releasePressedActions();
    setPauseMenuOpen(false);
    setRebindingAction(null);
    void resumeCurrentPlayer().catch(() => undefined);
  };

  const closePlayer = () => {
    releasePressedActions();
    releaseRemotePressedActions();
    if (activeNetplaySessionRef.current) {
      netplayClientRef.current?.leaveRoom();
    }
    void persistAutoSave();
    stopPlayer();
    clearNetplayPeerConnection(true);
    setRemoteStreamSession(null);
    activePlayerRef.current = null;
    setActivePlayer(null);
    activeNetplaySessionRef.current = null;
    setActiveNetplaySession(null);
    setPendingNetplayLaunchRoom(null);
    resetNetplaySyncState();
    setPauseMenuOpen(false);
    setRebindingAction(null);
    setIsPlayerLoading(false);
    setPlayerError(null);
    setSaveSlots(createEmptySaveSlots());
    setAutoSave({ hasState: false });
    setStatusText('Сеанс встроенного запуска закрыт.');
  };

  useEffect(() => {
    if (!activePlayer) {
      setPlayerFrameLoaded(false);
      return undefined;
    }

    let disposed = false;
    setPlayerError(null);
    setIsPlayerLoading(true);
    setPauseMenuOpen(false);
    setRebindingAction(null);
    setSaveSlots(createEmptySaveSlots());
    setAutoSave({ hasState: false });
    setPlayerFrameLoaded(false);

    if (activePlayerRuntime !== 'nostalgist') {
      return () => {
        disposed = true;
        stopPlayer();
      };
    }

    if (!playerCanvasRef.current) {
      return undefined;
    }

    const bootPlayer = async () => {
      try {
        const instance = await launchBuiltInGame(activePlayer, playerCanvasRef.current!);

        if (disposed) {
          try {
            instance.exit({ removeCanvas: false });
          } catch {
            // ignored
          }
          return;
        }

        playerInstanceRef.current = instance;
        playerCanvasRef.current?.focus();
        flushRemoteNetplayInputs();
        setIsPlayerLoading(false);
        const onlineSession = activeNetplaySessionRef.current;
        if (onlineSession && onlineSession.gameId === activePlayer.game.id) {
          if (onlineSession.launchMode === 'experimental-relay' && onlineSession.localPlayerIndex === 2) {
            requestNetplayStateSync('initial');
          }
          if (onlineSession.launchMode === 'experimental-relay') {
            void flushPendingNetplayStateSync();
            void verifyCurrentNetplayRomHash();
            setStatusText(`Онлайн-сеанс активен: ${activePlayer.game.title}. Вы играете как Игрок ${onlineSession.localPlayerIndex}.`);
          } else {
            setStatusText(`Комната запущена: ${activePlayer.game.title}. Вы хост и стримите игру другу.`);
          }
        } else {
          setStatusText(`Запущено внутри Emusol: ${activePlayer.game.title}`);
        }
      } catch (error) {
        if (disposed) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Не удалось запустить встроенный эмулятор.';
        releaseRemotePressedActions();
        activeNetplaySessionRef.current = null;
        setActiveNetplaySession(null);
        setPlayerError(message);
        setIsPlayerLoading(false);
        setStatusText(message);
      }
    };

    void bootPlayer();

    return () => {
      disposed = true;
      stopPlayer();
    };
  }, [activePlayer, activePlayerRuntime]);

  useEffect(() => {
    if (!activePlayer || activePlayerRuntime !== 'emulatorjs' || !playerFrameLoaded) {
      return;
    }

    const frameWindow = playerFrameRef.current?.contentWindow;
    const core = getEmulatorJsCore(activePlayer.game.platform);

    if (!frameWindow || !core) {
      const message = 'Не удалось подготовить встроенный player для N64/DS.';
      setPlayerError(message);
      setIsPlayerLoading(false);
      setStatusText(message);
      return;
    }

    frameWindow.postMessage(
      {
        source: EMUSOL_FRAME_SOURCE,
        type: 'init',
        payload: {
          core,
          dataPath: getEmulatorJsDataPath(),
          gameId: activePlayer.game.id,
          platform: activePlayer.game.platform,
          preferences: activePlayer.preferences,
          muted: activePlayer.preferences.muted,
          romBase64: activePlayer.romBase64,
          title: activePlayer.game.title,
          volumePercent: activePlayer.preferences.volumePercent
        }
      },
      '*'
    );
  }, [activePlayer, activePlayerRuntime, playerFrameLoaded]);

  useEffect(() => {
    if (
      !activeNetplaySession ||
      activeNetplaySession.launchMode !== 'host-stream' ||
      activeNetplaySession.localPlayerIndex !== 1 ||
      !activePlayer ||
      activePlayerRuntime !== 'nostalgist' ||
      isPlayerLoading ||
      playerError
    ) {
      return undefined;
    }

    let cancelled = false;

    void startHostNetplayStream().catch((error) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Не удалось поднять стрим комнаты.';
      setStatusText(message);
      setNetplaySyncStatus('Стрим не поднялся.');
    });

    return () => {
      cancelled = true;
    };
  }, [activeNetplaySession, activePlayer, activePlayerRuntime, isPlayerLoading, playerError]);

  useEffect(() => {
    if (
      !activeNetplaySession ||
      activeNetplaySession.launchMode !== 'experimental-relay' ||
      !activePlayer ||
      activePlayerRuntime !== 'nostalgist' ||
      isPlayerLoading ||
      playerError
    ) {
      return undefined;
    }

    void verifyCurrentNetplayRomHash();
    void publishCurrentNetplayStateHash();

    const intervalId = window.setInterval(() => {
      void publishCurrentNetplayStateHash();
    }, NETPLAY_STATE_HASH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeNetplaySession, activePlayer, activePlayerRuntime, isPlayerLoading, playerError]);

  useEffect(() => {
    if (
      !activeNetplaySession ||
      activeNetplaySession.launchMode !== 'experimental-relay' ||
      !activePlayer ||
      activePlayerRuntime !== 'nostalgist' ||
      isPlayerLoading ||
      playerError
    ) {
      return undefined;
    }

    let frameId = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }

      netplayFrameRef.current += 1;
      flushQueuedNetplayInputs(localNetplayInputQueueRef, applyLocalNetplayInput);
      flushQueuedNetplayInputs(remoteNetplayInputQueueRef, applyRemoteNetplayInput);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [activeNetplaySession, activePlayer, activePlayerRuntime, isPlayerLoading, playerError]);

  useEffect(() => {
    if (!bridge) {
      return undefined;
    }

    void bridge.setFullscreen(Boolean(activePlayer));

    return () => {
      void bridge.setFullscreen(false);
    };
  }, [activePlayer, bridge]);

  useEffect(() => {
    const handlePlayerFrameMessage = (event: MessageEvent) => {
      const message = event.data;

      if (!message || message.source !== EMUSOL_PLAYER_SOURCE) {
        return;
      }

      if (message.type === 'response' && typeof message.requestId === 'string') {
        const pending = playerFramePendingRef.current.get(message.requestId);

        if (!pending) {
          return;
        }

        window.clearTimeout(pending.timeoutId);
        playerFramePendingRef.current.delete(message.requestId);

        if (message.ok === false) {
          pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Команда player завершилась с ошибкой.'));
          return;
        }

        pending.resolve(message);
        return;
      }

      if (message.type === 'ready') {
        setPlayerError(null);
        setIsPlayerLoading(false);
        if (activePlayer) {
          setStatusText(`Запущено внутри Emusol: ${activePlayer.game.title}`);
        }
        return;
      }

      if (message.type === 'error') {
        const nextMessage = typeof message.message === 'string' ? message.message : 'Ошибка во встроенном player.';
        if (isPlayerLoading) {
          setPlayerError(nextMessage);
          setIsPlayerLoading(false);
        }
        setStatusText(nextMessage);
        return;
      }

      if (message.type === 'escape') {
        if (!activePlayer) {
          return;
        }

        if (pauseMenuOpen) {
          closePauseMenu();
        } else {
          void openPauseMenu();
        }
        return;
      }

      if (message.type === 'quick-save') {
        if (!pauseMenuOpen) {
          void handleSaveSlot(currentEmbeddedPreferences.quickSlot);
        }
        return;
      }

      if (message.type === 'quick-load' && !pauseMenuOpen) {
        void handleLoadSlot(currentEmbeddedPreferences.quickSlot);
      }
    };

    window.addEventListener('message', handlePlayerFrameMessage);

    return () => {
      window.removeEventListener('message', handlePlayerFrameMessage);
    };
  }, [activePlayer, currentEmbeddedPreferences.quickSlot, isPlayerLoading, pauseMenuOpen]);

  useEffect(() => {
    if (!activePlayer && !remoteStreamSession) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const canHandleDirectInput = activePlayerRuntime === 'nostalgist' || Boolean(remoteStreamSession);

      if (rebindingAction) {
        event.preventDefault();
        event.stopPropagation();

        if (event.code === 'Escape') {
          setRebindingAction(null);
          setStatusText('Переназначение отменено.');
          return;
        }

        const nextBinding = keyboardEventToRetroArchKey(event);
        if (!nextBinding) {
          setStatusText('Эту клавишу пока нельзя назначить.');
          return;
        }

        void saveGameControlBindingPatch({
          [rebindingAction]: nextBinding
        }).then(() => {
          setStatusText(`Кнопка ${controlActionLabels[rebindingAction]} назначена на ${formatBindingLabel(nextBinding)}.`);
          setRebindingAction(null);
        });
        return;
      }

      if (event.code === 'F5') {
        event.preventDefault();
        event.stopPropagation();
        if (activeNetplaySessionRef.current || remoteStreamSession) {
          setStatusText('Во время онлайн-сеанса быстрые сохранения отключены.');
          return;
        }
        void handleSaveSlot(currentEmbeddedPreferences.quickSlot);
        return;
      }

      if (event.code === 'F8') {
        event.preventDefault();
        event.stopPropagation();
        if (activeNetplaySessionRef.current || remoteStreamSession) {
          setStatusText('Во время онлайн-сеанса быстрая загрузка отключена.');
          return;
        }
        void handleLoadSlot(currentEmbeddedPreferences.quickSlot);
        return;
      }

      if (pauseMenuOpen) {
        if (event.code !== 'Escape') {
          event.preventDefault();
          event.stopPropagation();
        }
      } else if (canHandleDirectInput) {
        const mappedBinding = keyboardEventToRetroArchKey(event);
        const mappedAction = mappedBinding ? getControlActionForBinding(currentControlBindings, mappedBinding) : null;

        if (mappedAction) {
          event.preventDefault();
          event.stopPropagation();

          if (!event.repeat) {
            pressLocalAction(mappedAction, 'keyboard');
          }
          return;
        }
      }

      if (event.code !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (remoteStreamSession) {
        handleNetplayLeaveRoom();
        return;
      }

      if (pauseMenuOpen) {
        closePauseMenu();
      } else {
        void openPauseMenu();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if ((activePlayerRuntime !== 'nostalgist' && !remoteStreamSession) || pauseMenuOpen || rebindingAction) {
        return;
      }

      const mappedBinding = keyboardEventToRetroArchKey(event);
      const mappedAction = mappedBinding ? getControlActionForBinding(currentControlBindings, mappedBinding) : null;

      if (!mappedAction) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      releaseLocalAction(mappedAction, 'keyboard');
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [activePlayer, activePlayerRuntime, pauseMenuOpen, rebindingAction, currentControlBindings, currentEmbeddedPreferences.quickSlot, activePlayer?.game.id, remoteStreamSession]);

  useEffect(() => {
    if (activePlayer || !libraryControlsOpen || !selectedGame) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (rebindingAction) {
        event.preventDefault();
        event.stopPropagation();

        if (event.code === 'Escape') {
          setRebindingAction(null);
          setStatusText('Переназначение отменено.');
          return;
        }

        const nextBinding = keyboardEventToRetroArchKey(event);
        if (!nextBinding) {
          setStatusText('Эту клавишу пока нельзя назначить.');
          return;
        }

        void saveGameControlBindingPatch({
          [rebindingAction]: nextBinding
        }).then(() => {
          setStatusText(`Кнопка ${controlActionLabels[rebindingAction]} назначена на ${formatBindingLabel(nextBinding)}.`);
          setRebindingAction(null);
        });
        return;
      }

      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setLibraryControlsOpen(false);
        setRebindingAction(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activePlayer, libraryControlsOpen, rebindingAction, selectedGame?.id]);

  useEffect(() => {
    if (!activePlayer && !remoteStreamSession) {
      Array.from(gamepadPressedActionsRef.current).forEach((action) => releaseLocalAction(action, 'gamepad'));
      return undefined;
    }

    let frameId = 0;

    const pollGamepadInput = () => {
      const availableGamepads =
        typeof navigator.getGamepads === 'function'
          ? Array.from(navigator.getGamepads()).filter((entry): entry is Gamepad => Boolean(entry))
          : [];

      const primaryGamepad = availableGamepads[0] ?? null;
      const canReadGamepad = Boolean(primaryGamepad && !pauseMenuOpen && !rebindingAction && !playerError);
      const nextActions = canReadGamepad ? collectGamepadActions(primaryGamepad!) : new Set<ControlAction>();

      for (const action of Array.from(gamepadPressedActionsRef.current)) {
        if (!nextActions.has(action)) {
          releaseLocalAction(action, 'gamepad');
        }
      }

      for (const action of nextActions) {
        pressLocalAction(action, 'gamepad');
      }

      frameId = window.requestAnimationFrame(pollGamepadInput);
    };

    pollGamepadInput();

    return () => {
      window.cancelAnimationFrame(frameId);
      Array.from(gamepadPressedActionsRef.current).forEach((action) => releaseLocalAction(action, 'gamepad'));
    };
  }, [activePlayer, activePlayerRuntime, pauseMenuOpen, rebindingAction, playerError, remoteStreamSession]);

  const saveProfile = async (nextProfile: ProfileState) => {
    setProfile(nextProfile);
    if (!bridge) return;

    const saved = await bridge.saveProfile(nextProfile);
    setProfile(saved);
  };

  const updateProfile = (patch: Partial<ProfileState>) => {
    void saveProfile({ ...profile, ...patch });
  };

  const applyThemePreset = (theme: ProfileState['theme']) => {
    if (theme === 'pink' && profile.accentColor === '#ff5548') {
      updateProfile({ theme, accentColor: PINK_THEME_ACCENT });
      return;
    }

    updateProfile({ theme });
  };

  const handleFriendDraftChange = <K extends keyof FriendDraft>(key: K, value: FriendDraft[K]) => {
    setFriendDraft((current) => ({
      ...current,
      [key]: value
    }));
  };

  const handleSaveFriend = async () => {
    if (!bridge) {
      return;
    }

    const trimmedFriendId = friendDraft.friendId.trim();
    if (!trimmedFriendId) {
      setStatusText('Введите ID друга.');
      return;
    }

    if (trimmedFriendId === selfNetplayUserId) {
      setStatusText('Нельзя добавить свой ID в друзья.');
      return;
    }

    if (friends.some((friend) => friend.id.toLowerCase() === trimmedFriendId.toLowerCase())) {
      setStatusText('Этот ID уже есть в списке друзей.');
      return;
    }

    const nextFriends = await bridge.saveFriend({
      id: trimmedFriendId,
      name: trimmedFriendId,
      status: 'offline',
      note: ''
    });

    setFriends(nextFriends);
    setFriendDraft(defaultFriendDraft());
    setFriendEditorOpen(false);
    setStatusText(`Друг с ID ${trimmedFriendId} добавлен.`);
  };

  const handleRemoveFriend = async (friendId: string, friendLabel: string) => {
    if (!bridge) {
      return;
    }

    const nextFriends = await bridge.removeFriend(friendId);
    setFriends(nextFriends);
    setStatusText(`Друг с ID ${friendLabel} удален.`);
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const avatarDataUrl = await readAsDataUrl(file);
    await saveProfile({ ...profile, avatarDataUrl });
    setStatusText('Аватар обновлен.');
    event.target.value = '';
  };

  const handleImportRoms = async () => {
    if (!bridge) return;

    const result = await bridge.importRoms();
    setLibrary(result.library);

    if (result.addedGameIds[0]) {
      setSelectedGameId(result.addedGameIds[0]);
    }

    if (result.addedGameIds.length) {
      const addedIds = new Set(result.addedGameIds);
      const addedGames = result.library.filter((game) => addedIds.has(game.id) && !game.coverDataUrl).slice(0, 6);
      if (addedGames.length) {
        void applyAutoCovers(addedGames);
      }
    }

    const messages: string[] = [];
    if (result.addedGameIds.length) messages.push(`Добавлено: ${result.addedGameIds.length}`);
    if (result.duplicateFiles.length) messages.push(`Дубликаты: ${result.duplicateFiles.join(', ')}`);
    if (result.unsupportedFiles.length) messages.push(`Не распознано: ${result.unsupportedFiles.join(', ')}`);
    setStatusText(messages.length ? messages.join(' | ') : 'Импорт отменен.');
  };

  const handleRemoveGame = async () => {
    if (!selectedGame || !bridge) return;

    if (activePlayer?.game.id === selectedGame.id) {
      closePlayer();
    }

    const nextLibrary = await bridge.removeGame(selectedGame.id);
    setLibrary(nextLibrary);
    setGameControlBindingsByGameId((current) => {
      const next = { ...current };
      delete next[selectedGame.id];
      return next;
    });
    setStatusText(`"${selectedGame.title}" удалена из библиотеки.`);
    setSelectedGameId(nextLibrary[0]?.id ?? null);
  };

  const isMissingRomError = (message: string): boolean => message.includes('Файл ROM не найден');

  const requestMissingRomRelink = async (game: LibraryGame): Promise<boolean> => {
    if (!bridge) {
      return false;
    }

    const result = await bridge.relinkMissingRom(game.id);
    if (!result) {
      setStatusText(`ROM для "${game.title}" не выбран.`);
      return false;
    }

    setLibrary(result.library);
    setSelectedGameId(result.game.id);
    setStatusText(`Путь к ROM обновлен: ${result.game.title}.`);
    return true;
  };

  const prepareEmbeddedLaunchWithRecovery = async (game: LibraryGame): Promise<EmbeddedLaunchPayload> => {
    if (!bridge) {
      throw new Error('Bridge Emusol недоступен.');
    }

    try {
      return await bridge.prepareEmbeddedLaunch(game.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось подготовить встроенный запуск.';
      if (!isMissingRomError(message)) {
        throw error;
      }

      const relinked = await requestMissingRomRelink(game);
      if (!relinked) {
        throw new Error(`ROM для "${game.title}" не выбран.`);
      }

      return bridge.prepareEmbeddedLaunch(game.id);
    }
  };

  const launchExternalGameWithRecovery = async (game: LibraryGame): Promise<LaunchGameResult> => {
    if (!bridge) {
      throw new Error('Bridge Emusol недоступен.');
    }

    try {
      return await bridge.launchGame(game.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось запустить игру через внешний эмулятор.';
      if (!isMissingRomError(message)) {
        throw error;
      }

      const relinked = await requestMissingRomRelink(game);
      if (!relinked) {
        throw new Error(`ROM для "${game.title}" не выбран.`);
      }

      return bridge.launchGame(game.id);
    }
  };

  const startEmbeddedLaunchForGame = async (game: LibraryGame, room?: NetplayRoom) => {
    if (!bridge) {
      throw new Error('Bridge Emusol недоступен.');
    }

    setAccountMenuOpen(false);
    setPlayerError(null);
    setIsPlayerLoading(true);
    setPauseMenuOpen(false);
    setRebindingAction(null);
    releasePressedActions();
    releaseRemotePressedActions();
    resetNetplaySyncState();

    const payload = await prepareEmbeddedLaunchWithRecovery(game);
    const resolvedControlBindings =
      gameControlBindingsByGameId[payload.game.id] ??
      embeddedPreferencesByPlatform[payload.game.platform]?.controlBindings ??
      payload.preferences.controlBindings;
    const resolvedPayload: EmbeddedLaunchPayload = {
      ...payload,
      preferences: {
        ...payload.preferences,
        controlBindings: resolvedControlBindings
      }
    };

    if (getBuiltInRuntime(resolvedPayload.game.platform) === 'emulatorjs') {
      setPlayerFrameSessionId((current) => current + 1);
      setPlayerFrameLoaded(false);
    }
    setLibrary(resolvedPayload.library);
    setSelectedGameId(resolvedPayload.game.id);
    setEmbeddedPreferencesByPlatform((current) => ({
      ...current,
      [payload.game.platform]: payload.preferences
    }));

    if (room && supportsExperimentalNetplayPlatform(resolvedPayload.game.platform)) {
      const localPlayerIndex: NetplayPlayerIndex = room.hostUserId === selfNetplayUserId ? 1 : 2;
      const nextSession: ActiveNetplaySession = {
        roomId: room.id,
        gameId: resolvedPayload.game.id,
        gameTitle: resolvedPayload.game.title,
        platform: resolvedPayload.game.platform,
        localPlayerIndex,
        remotePlayerIndex: localPlayerIndex === 1 ? 2 : 1,
        launchMode: 'host-stream'
      };
      activeNetplaySessionRef.current = nextSession;
      setActiveNetplaySession(nextSession);
      setNetplaySyncStatus('Online-сеанс поднят. Проверяю ROM и состояние.');
    } else {
      activeNetplaySessionRef.current = null;
      setActiveNetplaySession(null);
    }

    activePlayerRef.current = resolvedPayload;
    setActivePlayer(resolvedPayload);
    return resolvedPayload;
  };

  const handleConnectNetplay = () => {
    netplayClientRef.current?.disconnect();
    setNetplayError(null);
    setNetplayInvites([]);
    setNetplayRoom(null);
    setNetplayPanelOpen(true);
    resetNetplaySyncState();

    const client = createNetplayClient({
      serverUrl: signalingUrl,
      userId: selfNetplayUserId,
      displayName: profile.displayName,
      onOpen: () => {
        setIsNetplayConnected(true);
        setStatusText(`Онлайн подключен: ${signalingUrl}`);
      },
      onClose: (reason) => {
        setIsNetplayConnected(false);
        setNetplayRoom(null);
        setNetplayUsers([]);
        setPendingNetplayLaunchRoom(null);
        releasePressedActions();
        releaseRemotePressedActions();
        clearNetplayPeerConnection(true);
        setRemoteStreamSession(null);
        activeNetplaySessionRef.current = null;
        setActiveNetplaySession(null);
        resetNetplaySyncState();
        setStatusText(reason || 'Онлайн отключен.');
      },
      onPresence: (users) => {
        setNetplayUsers(users);
      },
      onRoom: (room) => {
        setNetplayRoom(room);
        if (!room) {
          setPendingNetplayLaunchRoom(null);
          releasePressedActions();
          releaseRemotePressedActions();
          clearNetplayPeerConnection(true);
          setRemoteStreamSession(null);
          activeNetplaySessionRef.current = null;
          setActiveNetplaySession(null);
          resetNetplaySyncState();
        }
      },
      onInvite: (invite) => {
        setNetplayInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
        setStatusText(`Новое приглашение от ${invite.fromDisplayName} в комнату "${invite.gameTitle}".`);
      },
      onLaunch: (room) => {
        setNetplayRoom(room);
        if (!supportsExperimentalNetplayPlatform(room.platform)) {
          setStatusText(`Комната запущена для "${room.gameTitle}", но онлайн через стриминг сейчас доступен только для NES, SNES и Mega Drive.`);
          return;
        }

        const matchingGame = resolveNetplayGame(libraryRef.current, room);
        if (matchingGame) {
          setSelectedGameId(matchingGame.id);
        }

        if (activePlayerRef.current || remoteStreamSessionRef.current) {
          setPendingNetplayLaunchRoom(room);
          setStatusText(`Комната для "${room.gameTitle}" готова. Закройте текущий сеанс, и Emusol сам переключит вас в онлайн.`);
          return;
        }

        if (room.hostUserId === selfNetplayUserId) {
          if (!matchingGame) {
            setStatusText(`Комната запущена для ${room.gameTitle}. У хоста не найдена игра в библиотеке.`);
            return;
          }

          setPendingNetplayLaunchRoom(null);
          void startEmbeddedLaunchForGame(matchingGame, room)
            .then((payload) => {
              setStatusText(`Онлайн-сеанс подготовлен: ${payload.game.title}. Вы хост комнаты.`);
            })
            .catch((error) => {
              setStatusText(error instanceof Error ? error.message : 'Не удалось подготовить онлайн-сеанс.');
            });
          return;
        }

        setPendingNetplayLaunchRoom(null);
        startRemoteStreamViewer(room);
      },
      onSignal: (signal) => {
        const session = activeNetplaySessionRef.current;
        const currentPlayer = activePlayerRef.current;

        if (signal.channel === 'host-input') {
          if (
            session &&
            currentPlayer &&
            signal.roomId === session.roomId &&
            currentPlayer.game.platform === session.platform &&
            currentPlayer.game.id === session.gameId &&
            session.localPlayerIndex === 1 &&
            getBuiltInRuntime(currentPlayer.game.platform) === 'nostalgist' &&
            isNetplayInputSignalPayload(signal.payload)
          ) {
            pendingRemoteInputsRef.current.push(signal.payload);
            if (playerInstanceRef.current) {
              flushRemoteNetplayInputs();
            }
          }

          return;
        }

        if (!session || signal.roomId !== session.roomId) {
          return;
        }

        if (signal.channel === 'stream-offer' && isNetplayRtcDescriptionSignalPayload(signal.payload) && session.localPlayerIndex === 2) {
          const description = signal.payload as NetplayRtcDescriptionSignalPayload;
          void (async () => {
            try {
              const connection = ensureNetplayPeerConnection('guest', session.roomId);
              await connection.setRemoteDescription(new RTCSessionDescription(description));
              await flushPendingNetplayIceCandidates(connection);
              const answer = await connection.createAnswer();
              await connection.setLocalDescription(answer);
              netplayClientRef.current?.sendSignal('stream-answer', {
                type: answer.type,
                sdp: answer.sdp ?? ''
              });
              setNetplaySyncStatus('Отвечаю на стрим хоста...');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Не удалось принять стрим хоста.';
              setRemoteStreamError(message);
              setStatusText(message);
            }
          })();
          return;
        }

        if (signal.channel === 'stream-answer' && isNetplayRtcDescriptionSignalPayload(signal.payload) && session.localPlayerIndex === 1) {
          const description = signal.payload as NetplayRtcDescriptionSignalPayload;
          void (async () => {
            try {
              const connection = ensureNetplayPeerConnection('host', session.roomId);
              await connection.setRemoteDescription(new RTCSessionDescription(description));
              await flushPendingNetplayIceCandidates(connection);
              setNetplaySyncStatus('Гость подключился к стриму.');
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Не удалось подключить гостя к стриму.';
              setStatusText(message);
            }
          })();
          return;
        }

        if (signal.channel === 'stream-ice' && isNetplayRtcIceSignalPayload(signal.payload)) {
          void pushNetplayIceCandidate(signal.payload.candidate);
          return;
        }

      setStatusText(`Получен онлайн-сигнал "${signal.channel}" от друга.`);
      },
      onError: (message) => {
        setNetplayError(message);
        setStatusText(message);
      }
    });

    netplayClientRef.current = client;
  };

  const handleDisconnectNetplay = () => {
    netplayClientRef.current?.disconnect();
    netplayClientRef.current = null;
    setIsNetplayConnected(false);
    setNetplayPanelOpen(false);
    setNetplayUsers([]);
    setNetplayRoom(null);
    setNetplayInvites([]);
    setNetplayError(null);
    setPendingNetplayLaunchRoom(null);
    releasePressedActions();
    releaseRemotePressedActions();
    clearNetplayPeerConnection(true);
    setRemoteStreamSession(null);
    activeNetplaySessionRef.current = null;
    setActiveNetplaySession(null);
    resetNetplaySyncState();
    setStatusText('Онлайн отключен.');
  };

  const handleCreateNetplayRoom = () => {
    if (!selectedGame || !canCreateNetplayRoom || !netplayClientRef.current) {
      return;
    }

    netplayClientRef.current.createRoom(selectedGame.id, selectedGame.title, selectedGame.platform, selectedGame.romFileName);
    setStatusText(`Создаю комнату для "${selectedGame.title}".`);
  };

  const handleInviteFriend = (userId: string) => {
    if (!netplayClientRef.current || !netplayRoom) {
      setStatusText('Сначала создайте комнату.');
      return;
    }

    netplayClientRef.current.sendInvite(userId, netplayRoom.id);
    const target = onlineUsers.find((user) => user.userId === userId);
    setStatusText(`Приглашение отправлено${target ? `: ${target.displayName}` : ''}.`);
  };

  const handleJoinInvite = (invite: NetplayInvite) => {
    if (!netplayClientRef.current) {
      return;
    }

    if (activePlayerRef.current || remoteStreamSessionRef.current) {
      setStatusText('Сначала закройте текущую игру, потом заходите в онлайн-комнату.');
      return;
    }

    netplayClientRef.current.joinRoom(invite.roomId);
    setNetplayInvites((current) => current.filter((item) => item.id !== invite.id));
    setStatusText(`Подключаюсь к комнате "${invite.gameTitle}".`);
  };

  const handleDismissInvite = (inviteId: string) => {
    setNetplayInvites((current) => current.filter((invite) => invite.id !== inviteId));
    setStatusText('Приглашение отклонено.');
  };

  const handleNetplayReadyToggle = () => {
    if (!netplayClientRef.current || !currentNetplayMember) {
      return;
    }

    netplayClientRef.current.setReady(!currentNetplayMember.ready);
    setStatusText(currentNetplayMember.ready ? 'Вы помечены как не готовы.' : 'Вы готовы к запуску.');
  };

  const handleNetplayLeaveRoom = () => {
    if (!netplayClientRef.current) {
      return;
    }

    netplayClientRef.current.leaveRoom();
    setPendingNetplayLaunchRoom(null);
    releasePressedActions();
    releaseRemotePressedActions();
    clearNetplayPeerConnection(true);
    setRemoteStreamSession(null);
    activeNetplaySessionRef.current = null;
    setActiveNetplaySession(null);
    resetNetplaySyncState();
    setStatusText('Вы вышли из онлайн-комнаты.');
  };

  const handleNetplayLaunchRoom = () => {
    if (!netplayClientRef.current || !netplayRoom) {
      return;
    }

    netplayClientRef.current.launchRoom();
    setStatusText('Запускаю игру для участников комнаты.');
  };

  const handleChooseNativeEmulator = async (platform: PlatformId) => {
    if (!bridge) {
      return null;
    }

    const executablePath = await bridge.chooseEmulatorExecutable(platform);
    if (!executablePath) {
      setStatusText(`Выбор эмулятора для ${formatPlatform(platform)} отменен.`);
      return null;
    }

    const nextProfiles = await bridge.saveEmulatorProfile(platform, {
      executablePath,
      argsTemplate: '"{rom}"'
    });
    setEmulatorProfiles(nextProfiles);
    setStatusText(`Путь к эмулятору для ${formatPlatform(platform)} сохранен.`);
    return nextProfiles[platform] ?? null;
  };

  const handleClearNativeEmulator = async (platform: PlatformId) => {
    if (!bridge) {
      return;
    }

    const nextProfiles = await bridge.saveEmulatorProfile(platform, {
      executablePath: '',
      argsTemplate: '"{rom}"'
    });
    setEmulatorProfiles(nextProfiles);
    setStatusText(`Путь к эмулятору для ${formatPlatform(platform)} очищен.`);
  };

  const handleLaunchGame = async () => {
    if (!selectedGame || !bridge) return;

    try {
      setAccountMenuOpen(false);
      setPlayerError(null);
      setIsPlayerLoading(true);
      setPauseMenuOpen(false);
      setRebindingAction(null);

      if (!selectedGameDescriptor?.canLaunch) {
        if (selectedGame.platform === '3DS') {
          const profile = selectedGameEmulatorProfile?.executablePath
            ? selectedGameEmulatorProfile
            : await handleChooseNativeEmulator('3DS');

          if (!profile?.executablePath) {
            setIsPlayerLoading(false);
            return;
          }

          const launchResult = await launchExternalGameWithRecovery(selectedGame);
          const state = await bridge.loadState();
          setLibrary(state.library);
          setEmulatorProfiles(state.emulatorProfiles ?? createDefaultEmulatorProfiles());
          setGameControlBindingsByGameId(state.gameControlBindingsByGameId ?? {});
          setSelectedGameId((current) => current ?? state.library[0]?.id ?? null);
          setStatusText(launchResult.message);
          setIsPlayerLoading(false);
          return;
        }

        throw new Error('Для этой платформы встроенный запуск еще не подключен.');
      }

      const payload = await startEmbeddedLaunchForGame(selectedGame);
      setStatusText(`Подготовлен встроенный запуск: ${payload.game.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось подготовить встроенный запуск.';
      setStatusText(message);
      setPlayerError(message);
      setIsPlayerLoading(false);
    }
  };

  const handleVolumeChange = async (value: number) => {
    try {
      const previousValue = currentEmbeddedPreferences.volumePercent;
      await saveEmbeddedPreferencePatch({ volumePercent: value });

      if (previousValue === value) {
        return;
      }

      if (activePlayerRuntime === 'emulatorjs') {
        await applyCurrentPlayerAudio(value, currentEmbeddedPreferences.muted);
        setStatusText(`Громкость: ${value}%`);
        return;
      }

      const instance = playerInstanceRef.current;
      if (!instance) {
        return;
      }

      const steps = Math.max(1, Math.round(Math.abs(value - previousValue) / 5));
      const command = value > previousValue ? 'VOLUME_UP' : 'VOLUME_DOWN';

      for (let step = 0; step < steps; step += 1) {
        instance.sendCommand(command);
      }

      setStatusText(`Громкость: ${value}%`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось изменить громкость.');
    }
  };

  const handleMutedChange = async () => {
    try {
      const nextMuted = !currentEmbeddedPreferences.muted;
      await saveEmbeddedPreferencePatch({ muted: nextMuted });

      if (activePlayerRuntime === 'emulatorjs') {
        await applyCurrentPlayerAudio(currentEmbeddedPreferences.volumePercent, nextMuted);
      } else {
        playerInstanceRef.current?.sendCommand('MUTE');
      }

      setStatusText(nextMuted ? 'Звук выключен.' : 'Звук включен.');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить звук.');
    }
  };

  const handleVideoFilterChange = async (value: EmbeddedPreferences['videoFilter']) => {
    if (value === currentEmbeddedPreferences.videoFilter) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ videoFilter: value });
      await applyCurrentPlayerVideo(nextPreferences);
      setStatusText(`Видеофильтр "${formatVideoFilterLabel(value)}" сохранен для ${formatPlatform(preferencePlatform ?? 'NES')}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить видеофильтр.');
    }
  };

  const handleAspectRatioChange = async (value: EmbeddedPreferences['aspectRatio']) => {
    if (value === currentEmbeddedPreferences.aspectRatio) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ aspectRatio: value });
      await applyCurrentPlayerVideo(nextPreferences);
      setStatusText(`Соотношение сторон "${formatAspectRatioLabel(value)}" сохранено для ${formatPlatform(preferencePlatform ?? 'NES')}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить соотношение сторон.');
    }
  };

  const handleIntegerScaleToggle = async () => {
    const nextValue = !currentEmbeddedPreferences.integerScale;
    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ integerScale: nextValue });
      await applyCurrentPlayerVideo(nextPreferences);
      setStatusText(nextValue ? 'Целочисленный масштаб включен.' : 'Целочисленный масштаб выключен.');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить масштабирование.');
    }
  };

  const handleSecondScreenLayoutChange = async (value: SecondScreenLayoutMode) => {
    if (!preferencePlatform || !isDualScreenPlatform(preferencePlatform) || value === currentEmbeddedPreferences.secondScreenLayout) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ secondScreenLayout: value });
      await syncLiveDualScreenPreferences(nextPreferences);

      setStatusText(`Расположение второго экрана: ${formatSecondScreenLayoutLabel(value)}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить расположение второго экрана.');
    }
  };

  const handlePrimaryScreenChange = async (value: DualScreenPrimary) => {
    if (!preferencePlatform || !isDualScreenPlatform(preferencePlatform) || value === currentEmbeddedPreferences.primaryScreen) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ primaryScreen: value });
      await syncLiveDualScreenPreferences(nextPreferences);

      setStatusText(`Основной экран: ${formatPrimaryScreenLabel(value)}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить основной экран.');
    }
  };

  const handleSecondScreenSizeChange = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!preferencePlatform || !isDualScreenPlatform(preferencePlatform)) {
      return;
    }

    const nextValue = Math.max(
      SECOND_SCREEN_SIZE_MIN,
      Math.min(SECOND_SCREEN_SIZE_MAX, Math.round(event.target.valueAsNumber || currentEmbeddedPreferences.secondScreenSizePercent))
    );

    if (nextValue === currentEmbeddedPreferences.secondScreenSizePercent) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ secondScreenSizePercent: nextValue });
      await syncLiveDualScreenPreferences(nextPreferences);
      setStatusText(`Размер зоны второго экрана: ${nextValue}%.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить размер зоны второго экрана.');
    }
  };

  const handlePrimaryScreenScaleModeChange = async (value: ScreenScaleMode) => {
    if (!preferencePlatform || !isDualScreenPlatform(preferencePlatform) || value === currentEmbeddedPreferences.primaryScreenScaleMode) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ primaryScreenScaleMode: value });
      await syncLiveDualScreenPreferences(nextPreferences);
      setStatusText(`Основной экран: режим "${formatScreenScaleModeLabel(value)}".`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить режим масштабирования основного экрана.');
    }
  };

  const handleSecondaryScreenScaleModeChange = async (value: ScreenScaleMode) => {
    if (!preferencePlatform || !isDualScreenPlatform(preferencePlatform) || value === currentEmbeddedPreferences.secondaryScreenScaleMode) {
      return;
    }

    try {
      const nextPreferences = await saveEmbeddedPreferencePatch({ secondaryScreenScaleMode: value });
      await syncLiveDualScreenPreferences(nextPreferences);
      setStatusText(`Дополнительный экран: режим "${formatScreenScaleModeLabel(value)}".`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось обновить режим масштабирования второго экрана.');
    }
  };

  const handleSaveSlot = async (slot: number) => {
    if (activeNetplaySessionRef.current) {
      setStatusText('Во время онлайн-сеанса сохранения по слотам отключены.');
      return;
    }

    if (!activePlayer || !bridge) return;

    if (activePlayerRuntime === 'nostalgist' && !playerInstanceRef.current) return;

    try {
      if (saveSlots.some((entry) => entry.slot === slot && entry.hasState)) {
        const confirmed = window.confirm(`Слот ${slot} уже содержит сохранение. Перезаписать его?`);
        if (!confirmed) {
          setStatusText(`Перезапись слота ${slot} отменена.`);
          return;
        }
      }

      setIsBusyWithSlot(slot);
      const { stateBase64, thumbnailDataUrl } = await saveCurrentPlayerState();
      const nextSlots = await bridge.saveGameStateSlot(activePlayer.game.id, slot, stateBase64, thumbnailDataUrl);
      setSaveSlots(nextSlots);
      setStatusText(`Игра сохранена в слот ${slot}.`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось сохранить игру.');
    } finally {
      setIsBusyWithSlot(null);
    }
  };

  const handleLoadSlot = async (slot: number) => {
    if (activeNetplaySessionRef.current) {
      setStatusText('Во время онлайн-сеанса загрузка из слотов отключена.');
      return;
    }

    if (!activePlayer || !bridge) return;

    if (activePlayerRuntime === 'nostalgist' && !playerInstanceRef.current) return;

    try {
      setIsBusyWithSlot(slot);
      const result = await bridge.loadGameStateSlot(activePlayer.game.id, slot);
      await loadCurrentPlayerState(result.stateBase64, `${activePlayer.game.romFileName}.state`);
      setSaveSlots(result.slots);
      setStatusText(`Загружен слот ${slot}.`);
      closePauseMenu();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось загрузить сохранение.');
    } finally {
      setIsBusyWithSlot(null);
    }
  };

  const handleLoadAutoSave = async () => {
    if (activeNetplaySessionRef.current) {
      setStatusText('Во время онлайн-сеанса автосейв недоступен.');
      return;
    }

    if (!activePlayer || !bridge) return;

    if (activePlayerRuntime === 'nostalgist' && !playerInstanceRef.current) return;

    try {
      setIsBusyWithSlot(0);
      const result = await bridge.loadAutoState(activePlayer.game.id);
      await loadCurrentPlayerState(result.stateBase64, `${activePlayer.game.romFileName}.auto.state`);
      setAutoSave(result.summary);
      setStatusText('Загружен автосейв.');
      closePauseMenu();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось загрузить автосейв.');
    } finally {
      setIsBusyWithSlot(null);
    }
  };

  const handleRestartGame = async () => {
    if (activeNetplaySessionRef.current) {
      setStatusText('Во время онлайн-сеанса перезапуск отключен.');
      return;
    }

    try {
      releasePressedActions();
      await restartCurrentPlayer();
      setStatusText('Игра перезапущена.');
      closePauseMenu();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Не удалось перезапустить игру.');
    }
  };

  const handleResetControls = async () => {
    await saveGameControlBindingPatch(defaultControlBindings());
    setRebindingAction(null);
    setStatusText('Управление для этой игры сброшено на стандартную раскладку.');
  };

  const activeConnectedGamepad = connectedGamepads[0] ?? null;
  const supportsEmbeddedVideoControls = activePlayerRuntime === 'emulatorjs' && activePlayer ? supportsLiveVideoSettings(activePlayer.game.platform) : false;
  const renderControlBindingButton = (action: ControlAction, kind: ControlClusterKind) => {
    const classes = ['gamepad-binding', `gamepad-binding-${kind}`];

    if (kind === 'dpad') {
      classes.push(`is-${action}`);
    }

    if (kind === 'face') {
      classes.push(`is-face-${action}`);
    }

    return (
      <button
        key={action}
        className={rebindingAction === action ? `${classes.join(' ')} active-binding` : classes.join(' ')}
        onClick={() => {
          setRebindingAction(action);
          setStatusText(`Нажмите новую клавишу для ${controlActionLabels[action]}.`);
        }}
      >
        <span className="gamepad-binding-label">{controlActionLabels[action]}</span>
        <strong className="gamepad-binding-value">
          {rebindingAction === action ? 'Нажмите клавишу...' : formatBindingLabel(currentControlBindings[action])}
        </strong>
      </button>
    );
  };

  const renderControlsEditor = (game: LibraryGame) => (
    <div className="pause-section">
      <p className="hint-text">
        Нажмите на кнопку ниже, затем новую клавишу. Раскладка применяется сразу и сохраняется только для игры «{game.title}».
      </p>
      <div className="inline-actions">
        <button className="secondary-action compact-action" onClick={() => void handleResetControls()}>
          Сбросить по умолчанию
        </button>
      </div>
      <div className="runtime-note">
        <strong>{activeConnectedGamepad ? `Геймпад: ${activeConnectedGamepad.id}` : 'Геймпад не подключен'}</strong>
        <p className="hint-text">
          {activeConnectedGamepad
            ? 'Первый подключенный геймпад уже работает. Здесь вы меняете именно клавиатурную раскладку для этой игры.'
            : 'Подключите геймпад для игры с контроллера. Здесь можно отдельно настроить клавиатуру для этой игры.'}
        </p>
      </div>
      <div className="gamepad-layout">
        {currentControlLayout.map((cluster) => (
          <section key={cluster.id} className="gamepad-cluster-card">
            <div className="gamepad-cluster-header">
              <span className="eyebrow">{cluster.label}</span>
              <span className="chip neutral">{cluster.actions.length}</span>
            </div>
            <div className={`gamepad-cluster gamepad-cluster-${cluster.kind}`}>
              {cluster.actions.map((action) => renderControlBindingButton(action, cluster.kind))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  if (isLoading) {
    return <div className="app-shell"><section className="panel loading-card">Загрузка Emusol...</section></div>;
  }

  if (remoteStreamSession) {
    return (
      <div className="player-shell remote-stream-shell">
        <video ref={remoteVideoRef} className="player-stream-video" autoPlay playsInline />

        {!remoteStreamReady && !remoteStreamError ? (
          <div className="player-boot">
            <strong>Подключение к стриму...</strong>
            <span>{remoteStreamSession.gameTitle} | {formatPlatform(remoteStreamSession.platform)}</span>
          </div>
        ) : null}

        {remoteStreamError ? (
          <div className="player-error">
            <strong>Не удалось подключить стрим</strong>
            <span>{remoteStreamError}</span>
            <button className="secondary-action" onClick={handleNetplayLeaveRoom}>
              Выйти из комнаты
            </button>
          </div>
        ) : null}

        <div className="remote-stream-hud">
          <div className="remote-stream-hud-copy">
            <span>{remoteStreamSession.gameTitle} | {formatPlatform(remoteStreamSession.platform)}</span>
            <div className="remote-stream-hud-status">
              <span className="chip success">Стрим от хоста</span>
              <span className={remoteStreamHasAudio ? 'chip success' : 'chip neutral'}>
                {remoteStreamHasAudio ? 'Со звуком' : 'Без звука'}
              </span>
            </div>
          </div>
          <button className="secondary-action compact-action" onClick={handleNetplayLeaveRoom}>
            Выйти
          </button>
        </div>
      </div>
    );
  }

  if (activePlayer) {
    return (
      <div className={pauseMenuOpen ? 'player-shell paused' : 'player-shell'}>
        {activePlayerRuntime === 'emulatorjs' ? (
          <iframe
            key={`${activePlayer.game.id}-${playerFrameSessionId}`}
            ref={playerFrameRef}
            className="player-iframe"
            src={new URL('./emulatorjs/player.html', window.location.href).toString()}
            title={`${activePlayer.game.title} player`}
            onLoad={() => setPlayerFrameLoaded(true)}
          />
        ) : (
          <canvas ref={playerCanvasRef} className="player-canvas" tabIndex={0} />
        )}

        {isPlayerLoading ? (
          <div className="player-boot">
            <strong>Запуск игры...</strong>
            <span>{activePlayer.game.title} | {formatPlatform(activePlayer.game.platform)}</span>
          </div>
        ) : null}

        {playerError ? (
          <div className="player-error">
            <strong>Не удалось запустить игру</strong>
            <span>{playerError}</span>
            <button className="secondary-action" onClick={closePlayer}>
              Вернуться
            </button>
          </div>
        ) : null}

        {pauseMenuOpen ? (
          <div className="pause-overlay">
            <section className="pause-menu">
              <div className="pause-header">
                <div>
                  <span className="eyebrow">Пауза</span>
                  <h2>{activePlayer.game.title}</h2>
                  <div className="pause-meta">
                    <span className="chip neutral">Платформа: {formatPlatform(activePlayer.game.platform)}</span>
                    <span className="chip neutral">Быстрый слот: {currentEmbeddedPreferences.quickSlot}</span>
                    <span className="chip neutral">F5 сохранить</span>
                    <span className="chip neutral">F8 загрузить</span>
                  </div>
                </div>
                <div className="pause-header-actions">
                  <button className="secondary-action compact-action" disabled={isBusyWithSlot !== null} onClick={() => void handleSaveSlot(currentEmbeddedPreferences.quickSlot)}>
                    Быстро сохранить
                  </button>
                  <button
                    className="secondary-action compact-action"
                    disabled={isBusyWithSlot !== null || !saveSlots.some((slot) => slot.slot === currentEmbeddedPreferences.quickSlot && slot.hasState)}
                    onClick={() => void handleLoadSlot(currentEmbeddedPreferences.quickSlot)}
                  >
                    Быстро загрузить
                  </button>
                  <button className="secondary-action compact-action" onClick={() => void handleRestartGame()}>
                    Перезапуск
                  </button>
                  <button className="primary-action compact-action" onClick={closePauseMenu}>
                    Продолжить
                  </button>
                  <button className="secondary-action" onClick={closePlayer}>
                    Выйти в библиотеку
                  </button>
                </div>
              </div>

              <div className="pause-tabs">
                {visiblePauseTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={pauseTab === tab.id ? 'platform-pill active' : 'platform-pill'}
                    onClick={() => setPauseTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {pauseTab === 'controls' ? (
                renderControlsEditor(activePlayer.game)
              ) : null}

              {pauseTab === 'audio' ? (
                <div className="pause-section">
                  <div className="audio-row">
                    <span>Громкость</span>
                    <strong>{currentEmbeddedPreferences.volumePercent}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={currentEmbeddedPreferences.volumePercent}
                    onChange={(event) => void handleVolumeChange(Number(event.target.value))}
                  />
                  <div className="inline-actions">
                    <button className={currentEmbeddedPreferences.muted ? 'switch-toggle active' : 'switch-toggle'} onClick={() => void handleMutedChange()}>
                      {currentEmbeddedPreferences.muted ? 'Звук выключен' : 'Выключить звук'}
                    </button>
                  </div>
                  <p className="hint-text">
                    Звук меняется во время игры. Если шкала покажет себя грубовато на отдельном ядре, точное значение все равно будет применено на следующем запуске.
                  </p>
                </div>
              ) : null}

              {pauseTab === 'video' ? (
                <div className="pause-section">
                  {activePlayerRuntime === 'nostalgist' || supportsEmbeddedVideoControls ? (
                    <>
                      <p className="hint-text">
                        {activePlayerRuntime === 'nostalgist'
                          ? 'Видеопрофиль сохраняется отдельно для каждой платформы. Новые параметры применятся при следующем запуске этой игры.'
                          : 'Для N64 видеонастройки применяются сразу в открытой игре и сохраняются как профиль платформы.'}
                      </p>
                      <div className="settings-grid">
                        <div className="setting-card">
                          <span className="eyebrow">Фильтр</span>
                          <div className="inline-actions">
                            {videoFilterOptions.map((option) => (
                              <button
                                key={option.id}
                                className={currentEmbeddedPreferences.videoFilter === option.id ? 'switch-toggle active' : 'switch-toggle'}
                                onClick={() => void handleVideoFilterChange(option.id)}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="setting-card">
                          <span className="eyebrow">Соотношение сторон</span>
                          <div className="inline-actions">
                            {aspectRatioOptions.map((option) => (
                              <button
                                key={option.id}
                                className={currentEmbeddedPreferences.aspectRatio === option.id ? 'switch-toggle active' : 'switch-toggle'}
                                onClick={() => void handleAspectRatioChange(option.id)}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="setting-card">
                          <span className="eyebrow">Масштаб</span>
                          <div className="inline-actions">
                            <button
                              className={currentEmbeddedPreferences.integerScale ? 'switch-toggle active' : 'switch-toggle'}
                              onClick={() => void handleIntegerScaleToggle()}
                            >
                              {currentEmbeddedPreferences.integerScale ? 'Целочисленный масштаб включен' : 'Целочисленный масштаб выключен'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="runtime-note">
                      <strong>Видео-настройки для {formatPlatform(activePlayer.game.platform)} пока базовые</strong>
                      <p className="hint-text">
                        Для {formatPlatform(activePlayer.game.platform)} сейчас используется встроенный рантайм EmulatorJS. Слоты сохранений и звук уже подключены, а детальные видео-настройки остаются следующим этапом для этой платформы.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {pauseTab === 'screens' ? (
                <div className="pause-section">
                  <p className="hint-text">
                    Для DS можно выбрать основной экран, положение второго, размер второй зоны и режим масштабирования для каждой части отдельно.
                  </p>
                  <div className="settings-grid dual-screen-grid">
                    <div className="setting-card">
                      <span className="eyebrow">Расположение второго экрана</span>
                      <div className="layout-option-grid">
                        {secondScreenLayoutOptions.map((option) => (
                          <button
                            key={option.id}
                            className={currentEmbeddedPreferences.secondScreenLayout === option.id ? 'layout-option active' : 'layout-option'}
                            onClick={() => void handleSecondScreenLayoutChange(option.id)}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="setting-card">
                      <span className="eyebrow">Основной экран</span>
                      <div className="layout-option-grid compact">
                        {primaryScreenOptions.map((option) => (
                          <button
                            key={option.id}
                            className={currentEmbeddedPreferences.primaryScreen === option.id ? 'layout-option active' : 'layout-option'}
                            onClick={() => void handlePrimaryScreenChange(option.id)}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="setting-card">
                      <div className="range-header">
                        <span className="eyebrow">Размер второй зоны</span>
                        <strong>{currentEmbeddedPreferences.secondScreenSizePercent}%</strong>
                      </div>
                      <input
                        className="range-input"
                        type="range"
                        min={SECOND_SCREEN_SIZE_MIN}
                        max={SECOND_SCREEN_SIZE_MAX}
                        step={1}
                        value={currentEmbeddedPreferences.secondScreenSizePercent}
                        onChange={(event) => void handleSecondScreenSizeChange(event)}
                      />
                      <p className="hint-text">
                        Меняет ширину боковой полосы или высоту верхней/нижней полосы. Для открепленного режима настройка сохраняется на будущее.
                      </p>
                    </div>
                    <div className="setting-card">
                      <span className="eyebrow">Масштаб основного экрана</span>
                      <div className="layout-option-grid compact">
                        {screenScaleOptions.map((option) => (
                          <button
                            key={option.id}
                            className={currentEmbeddedPreferences.primaryScreenScaleMode === option.id ? 'layout-option active' : 'layout-option'}
                            onClick={() => void handlePrimaryScreenScaleModeChange(option.id)}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="setting-card">
                      <span className="eyebrow">Масштаб дополнительного экрана</span>
                      <div className="layout-option-grid compact">
                        {screenScaleOptions.map((option) => (
                          <button
                            key={option.id}
                            className={currentEmbeddedPreferences.secondaryScreenScaleMode === option.id ? 'layout-option active' : 'layout-option'}
                            onClick={() => void handleSecondaryScreenScaleModeChange(option.id)}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="runtime-note">
                    <strong>Открепленный режим</strong>
                    <p className="hint-text">
                      В режиме <code>Открепить</code> второй экран откроется в отдельном окне. Его можно перетащить на другой монитор и оставить там во время игры.
                    </p>
                  </div>
                </div>
              ) : null}

              {pauseTab === 'saves' ? (
                <div className="pause-section">
                  <p className="hint-text">Выберите слот. Можно записать текущее состояние игры или загрузить уже сохраненный слот.</p>
                  <article className="slot-card autosave-card">
                    <div className="slot-preview">
                      {autoSave.thumbnailDataUrl ? <img src={autoSave.thumbnailDataUrl} alt="Автосейв" /> : <span>Автосейв</span>}
                    </div>
                    <strong>Автосейв</strong>
                    <span>{autoSave.hasState ? `Обновлен: ${formatDate(autoSave.updatedAt)}` : 'Пока не создан'}</span>
                    <div className="inline-actions">
                      <button
                        className="secondary-action compact-action"
                        disabled={!autoSave.hasState || isBusyWithSlot === 0}
                        onClick={() => void handleLoadAutoSave()}
                      >
                        Загрузить автосейв
                      </button>
                    </div>
                  </article>
                  <div className="slot-grid">
                    {saveSlots.map((slot) => (
                      <article key={slot.slot} className="slot-card">
                        <div className="slot-preview">
                          {slot.thumbnailDataUrl ? <img src={slot.thumbnailDataUrl} alt={`Слот ${slot.slot}`} /> : <span>Слот {slot.slot}</span>}
                        </div>
                        <strong>Слот {slot.slot}</strong>
                        <span>{slot.hasState ? `Сохранено: ${formatDate(slot.updatedAt)}` : 'Пусто'}</span>
                        <div className="inline-actions">
                          <button
                            className={currentEmbeddedPreferences.quickSlot === slot.slot ? 'switch-toggle active' : 'switch-toggle'}
                            onClick={() => void saveEmbeddedPreferencePatch({ quickSlot: slot.slot })}
                          >
                            {currentEmbeddedPreferences.quickSlot === slot.slot ? 'Быстрый слот' : 'Сделать быстрым'}
                          </button>
                          <button className="primary-action compact-action" disabled={isBusyWithSlot === slot.slot} onClick={() => void handleSaveSlot(slot.slot)}>
                            Записать
                          </button>
                          <button
                            className="secondary-action compact-action"
                            disabled={!slot.hasState || isBusyWithSlot === slot.slot}
                            onClick={() => void handleLoadSlot(slot.slot)}
                          >
                            Загрузить
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-orb" />
          <div>
            <div className="eyebrow">Emusol</div>
            <h1>Единый центр эмуляторов</h1>
          </div>
        </div>

        <div className="topbar-right">
          <div className="window-actions">
            <button className="window-control" onClick={() => void bridge?.minimizeWindow()} aria-label="Свернуть окно">
              -
            </button>
            <button className="window-control" onClick={() => void bridge?.toggleMaximizeWindow()} aria-label="Развернуть окно">
              □
            </button>
            <button className="window-control danger" onClick={() => void bridge?.closeWindow()} aria-label="Закрыть окно">
              ×
            </button>
          </div>
          <button
            className="avatar-launcher"
            onClick={() => setAccountMenuOpen((current) => !current)}
            aria-label="Открыть настройки аккаунта"
          >
            <img src={accountAvatarSrc} alt={profile.displayName} className={hasCustomAvatar ? undefined : 'brand-avatar-art'} />
          </button>
        </div>
      </header>

      {accountMenuOpen ? (
        <>
          <button className="screen-dim" aria-label="Закрыть настройки аккаунта" onClick={() => setAccountMenuOpen(false)} />
          <section className="panel account-popover">
            <div className="panel-header">
              <span className="eyebrow">Аккаунт</span>
              <span className="chip neutral">Локальный профиль</span>
            </div>

            <div className="account-row">
              <button className="avatar-button" onClick={() => avatarInputRef.current?.click()}>
                <img src={accountAvatarSrc} alt={profile.displayName} className={hasCustomAvatar ? undefined : 'brand-avatar-art'} />
              </button>
              <div className="account-copy">
                <strong>{profile.displayName}</strong>
                <span>ID: {selfNetplayUserId}</span>
              </div>
            </div>

            <input value={profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} placeholder="Ник" maxLength={28} />

            <div className="settings-grid">
              <div>
                <label>Тема</label>
                <div className="toggle-row">
                  <button className={profile.theme === 'dark' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('dark')}>
                    Темная
                  </button>
                  <button className={profile.theme === 'light' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('light')}>
                    Светлая
                  </button>
                  <button className={profile.theme === 'pink' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('pink')}>
                    Розовая
                  </button>
                </div>
              </div>
              <div>
                <label>Акцент</label>
                <div className="accent-row">
                  <input className="accent-picker" type="color" value={profile.accentColor} onChange={(event) => updateProfile({ accentColor: event.target.value })} />
                  <span>{profile.accentColor.toUpperCase()}</span>
                </div>
              </div>
            </div>

            <div className="inline-actions">
              <button
                className="secondary-action compact-action"
                onClick={() => {
                  setSettingsTab('profile');
                  setSettingsModalOpen(true);
                  setAccountMenuOpen(false);
                }}
              >
                Полные настройки
              </button>
            </div>
          </section>
        </>
      ) : null}

      {settingsModalOpen ? (
        <>
          <button className="screen-dim" aria-label="Закрыть полные настройки" onClick={() => setSettingsModalOpen(false)} />
          <section className="panel settings-modal">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Настройки</span>
                <h3 className="settings-title">Профиль и система</h3>
              </div>
              <button className="primary-action compact-action" onClick={() => setSettingsModalOpen(false)}>
                Закрыть
              </button>
            </div>

            <div className="settings-tabs">
              <button className={settingsTab === 'profile' ? 'platform-pill active' : 'platform-pill'} onClick={() => setSettingsTab('profile')}>
                Профиль
              </button>
              <button className={settingsTab === 'network' ? 'platform-pill active' : 'platform-pill'} onClick={() => setSettingsTab('network')}>
                Сеть
              </button>
              <button className={settingsTab === 'system' ? 'platform-pill active' : 'platform-pill'} onClick={() => setSettingsTab('system')}>
                Система
              </button>
            </div>

            {settingsTab === 'profile' ? (
              <div className="settings-grid settings-modal-grid">
                <div className="setting-card">
                  <div className="account-row">
                    <button className="avatar-button" onClick={() => avatarInputRef.current?.click()}>
                      <img src={accountAvatarSrc} alt={profile.displayName} className={hasCustomAvatar ? undefined : 'brand-avatar-art'} />
                    </button>
                    <div className="account-copy">
                      <strong>{profile.displayName}</strong>
                      <span>ID: {selfNetplayUserId}</span>
                    </div>
                  </div>
                </div>
                <div className="setting-card">
                  <label>Ник</label>
                  <input value={profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} placeholder="Ник" maxLength={28} />
                </div>
                <div className="setting-card">
                  <label>Тема</label>
                  <div className="toggle-row">
                    <button className={profile.theme === 'dark' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('dark')}>
                      Темная
                    </button>
                    <button className={profile.theme === 'light' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('light')}>
                      Светлая
                    </button>
                    <button className={profile.theme === 'pink' ? 'switch-toggle active' : 'switch-toggle'} onClick={() => applyThemePreset('pink')}>
                      Розовая
                    </button>
                  </div>
                  <p className="hint-text">Тема и акцент сохраняются локально сразу после выбора.</p>
                </div>
                <div className="setting-card">
                  <label>Акцент</label>
                  <div className="accent-row">
                    <input className="accent-picker" type="color" value={profile.accentColor} onChange={(event) => updateProfile({ accentColor: event.target.value })} />
                    <span>{profile.accentColor.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            ) : null}

            {settingsTab === 'network' ? (
              <div className="settings-grid settings-modal-grid">
                <div className="setting-card">
                  <label>Основной online-сервер</label>
                  <input value={signalingUrl} onChange={(event) => setSignalingUrl(event.target.value)} placeholder={DEFAULT_SIGNALING_URL} />
                  <p className="hint-text">По умолчанию Emusol использует Cloudflare-сервер. Менять адрес можно только здесь, а адрес сохраняется локально на этом устройстве.</p>
                </div>
                <div className="setting-card">
                  <span className="eyebrow">Состояние сети</span>
                  <div className="info-stack">
                    <div className="info-line"><span>Подключение</span><strong className="small-strong">{isNetplayConnected ? 'Активно' : 'Отключено'}</strong></div>
                    <div className="info-line"><span>Ваш ID</span><strong className="small-strong">{selfNetplayUserId}</strong></div>
                    <div className="info-line"><span>Людей в сети</span><strong className="small-strong">{onlineUsers.length}</strong></div>
                  </div>
                </div>
              </div>
            ) : null}

            {settingsTab === 'system' ? (
              <div className="settings-grid settings-modal-grid">
                <div className="setting-card">
                  <span className="eyebrow">Приложение</span>
                  <div className="info-stack">
                    <div className="info-line"><span>Платформа</span><strong className="small-strong">{runtimeInfo?.platform ?? 'electron'}</strong></div>
                    <div className="info-line"><span>Версия</span><strong className="small-strong">{runtimeInfo?.appVersion ?? 'dev'}</strong></div>
                    <div className="info-line"><span>Режим</span><strong className="small-strong">{runtimeInfo?.isPackaged ? 'Сборка' : 'Разработка'}</strong></div>
                  </div>
                </div>
                <div className="setting-card">
                  <span className="eyebrow">Контроллеры</span>
                  <div className="info-stack">
                    <div className="info-line"><span>Подключено</span><strong className="small-strong">{connectedGamepads.length}</strong></div>
                    <div className="info-line">
                      <span>Основной</span>
                      <strong className="small-strong">{activeConnectedGamepad ? activeConnectedGamepad.id : 'Не найден'}</strong>
                    </div>
                  </div>
                  <p className="hint-text">Первый найденный геймпад Emusol использует как основной для локальной игры и текущих встроенных рантаймов.</p>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {activeInvite && !activePlayer && !remoteStreamSession ? (
        <>
          <button className="screen-dim invite-dim" aria-label="Закрыть приглашение" onClick={() => handleDismissInvite(activeInvite.id)} />
          <section className="panel invite-modal">
            <div className="panel-header">
              <span className="eyebrow">Приглашение</span>
              <span className="chip success">Онлайн</span>
            </div>
            <div className="invite-modal-copy">
              <h3>{activeInvite.fromDisplayName} приглашает вас</h3>
              <p>Игра: {activeInvite.gameTitle}</p>
              <p>Платформа: {formatPlatform(activeInvite.platform)}</p>
              {additionalInviteCount > 0 ? <span className="chip neutral">Еще приглашений: {additionalInviteCount}</span> : null}
            </div>
            <div className="inline-actions">
              <button className="primary-action compact-action" onClick={() => handleJoinInvite(activeInvite)}>
                Принять
              </button>
              <button className="secondary-action compact-action" onClick={() => handleDismissInvite(activeInvite.id)}>
                Отклонить
              </button>
            </div>
          </section>
        </>
      ) : null}

      <input ref={avatarInputRef} hidden type="file" accept="image/*" onChange={handleAvatarChange} />

      <div className="switch-layout">
        <aside className="sidebar">
          <section className="panel library-panel">
            <div className="panel-header">
              <span className="eyebrow">Игры</span>
              <div className="panel-actions">
                <div className="sort-menu" ref={sortMenuRef}>
                  <button
                    className={sortMenuOpen ? 'secondary-action compact-action sort-trigger active' : 'secondary-action compact-action sort-trigger'}
                    onClick={() => setSortMenuOpen((current) => !current)}
                    aria-haspopup="menu"
                    aria-expanded={sortMenuOpen}
                    aria-label="Открыть выбор консоли"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M7 6h10M9 12h8m-6 6h4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="sort-trigger-label">Консоль</span>
                    <strong>{activeConsoleOption.label}</strong>
                  </button>

                  {sortMenuOpen ? (
                    <div className="sort-popover" role="menu" aria-label="Выбор консоли">
                      <div className="sort-popover-header">
                        <span className="eyebrow">Консоль</span>
                        <strong>{activeConsoleOption.label}</strong>
                      </div>

                      {consoleOptions.map((option) => (
                        <button
                          key={option.id}
                          className={filter === option.id ? 'sort-popover-option active' : 'sort-popover-option'}
                          onClick={() => {
                            setFilter(option.id);
                            setSortMenuOpen(false);
                          }}
                          role="menuitemradio"
                          aria-checked={filter === option.id}
                        >
                          <span className="sort-popover-copy">
                            <strong>{option.label}</strong>
                            <span>{option.id === 'ALL' ? `Всего: ${formatGameCount(consoleGameCounts.ALL)}` : formatGameCount(consoleGameCounts[option.id])}</span>
                          </span>
                          {filter === option.id ? (
                            <span className="sort-check" aria-hidden="true">
                              <svg viewBox="0 0 16 16">
                                <path
                                  d="M3.5 8.2 6.5 11l6-6"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="secondary-action compact-action" onClick={() => void handleImportRoms()}>
                  Импорт ROM
                </button>
              </div>
            </div>

            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по библиотеке" />


            {visibleGames.length ? (
              <div className="game-list">
                {visibleGames.map((game) => {
                  const palette = getPlatformPalette(game.platform);
                  return (
                    <button key={game.id} className={selectedGame?.id === game.id ? 'game-card active' : 'game-card'} onClick={() => setSelectedGameId(game.id)}>
                      <div className="game-card-art" style={{ background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})` }}>
                        {game.coverDataUrl ? (
                          <img src={game.coverDataUrl} alt={game.title} className="game-card-art-image" />
                        ) : (
                          <span>{formatPlatform(game.platform)}</span>
                        )}
                      </div>
                      <div className="game-card-copy">
                        <div className="game-card-head">
                          <strong>{game.title}</strong>
                          <span className="chip neutral">{formatLaunchCountLabel(game.launchCount)}</span>
                        </div>
                        <span className="game-card-subtitle">{formatPlatform(game.platform)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-library">
                <strong>Библиотека пока пустая</strong>
                <p>Импортируйте ROM-файлы, чтобы запускать базовые платформы прямо внутри Emusol.</p>
                <button className="primary-action" onClick={() => void handleImportRoms()}>
                  Выбрать ROM
                </button>
                <div className="support-columns">
                  <div className="support-card">
                    <span className="eyebrow">Сейчас</span>
                    <div className="support-list">
                      {V1_PLATFORMS.map((platform) => (
                        <span key={platform.id} className="chip success">
                          {platform.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="support-card">
                    <span className="eyebrow">Позже</span>
                    <div className="support-list">
                      {FUTURE_PLATFORMS.map((platform) => (
                        <span key={platform.id} className="chip warning">
                          {platform.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={friendsCollapsed ? 'panel friends-panel collapsed' : 'panel friends-panel'}>
            <button className="friends-toggle" onClick={() => setFriendsCollapsed((current) => !current)}>
              <span className="eyebrow">Друзья</span>
              <span>{friendsCollapsed ? 'Открыть' : 'Скрыть'}</span>
            </button>
            {!friendsCollapsed ? (
              <div className="friends-list">
                <div className="friend-editor-card">
                  <div className="friends-toolbar">
                    <div className="friends-summary">
                      <span className="chip neutral">Мои: {friends.length}</span>
                      <span className="chip neutral">В сети: {onlineUsers.length}</span>
                    </div>
                    <button
                      className={friendEditorOpen ? 'secondary-action compact-action active-binding' : 'secondary-action compact-action'}
                      onClick={() => {
                        setFriendEditorOpen((current) => !current);
                        setFriendDraft(defaultFriendDraft());
                      }}
                    >
                      {friendEditorOpen ? 'Скрыть форму' : 'Добавить друга'}
                    </button>
                  </div>
                  {friendEditorOpen ? (
                    <>
                      <input
                        value={friendDraft.friendId}
                        onChange={(event) => handleFriendDraftChange('friendId', event.target.value)}
                        placeholder="ID друга"
                        maxLength={120}
                      />
                      <div className="inline-actions">
                        <button className="primary-action compact-action" onClick={() => void handleSaveFriend()}>
                          Добавить
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
                {isNetplayConnected ? (
                  onlineUsers.length ? (
                    onlineUsers.map((user) => (
                      <div key={user.userId} className="friend-row">
                        <div className="friend-avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
                        <div className={`friend-status-dot ${user.roomId ? 'playing' : 'online'}`} />
                        <div className="friend-meta">
                          <strong>{user.displayName}</strong>
                          <span>{user.roomId ? 'Уже в комнате' : 'В сети и доступен для приглашения'}</span>
                        </div>
                        <div className="friend-actions">
                          {netplayRoom ? (
                            <button className="secondary-action compact-action" onClick={() => handleInviteFriend(user.userId)}>
                              Пригласить
                            </button>
                          ) : null}
                          <span className="friend-state">{user.roomId ? 'Играет' : 'В сети'}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="hint-text">Сейчас на signaling-сервере больше никого нет.</p>
                  )
                ) : (
                  friends.map((friend) => (
                    <div key={friend.id} className="friend-row">
                      <div className="friend-avatar">{friend.id.slice(0, 1).toUpperCase()}</div>
                      <div className={`friend-status-dot ${friend.status}`} />
                      <div className="friend-meta">
                        <strong>{friend.id}</strong>
                        <span>{friend.note && friend.status !== 'playing' ? friend.note : formatFriendPresence(friend.status, friend.note)}</span>
                      </div>
                      <div className="friend-actions">
                        <span className="friend-state">{formatFriendPresence(friend.status, friend.note)}</span>
                        <button className="secondary-action compact-action danger-action" onClick={() => void handleRemoveFriend(friend.id, friend.id)}>
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))
                )}
                {isNetplayConnected ? (
                  <div className="friends-local-block">
                    <div className="friends-group-header">
                      <span className="eyebrow">Мои друзья</span>
                      <span className="chip neutral">{friends.length}</span>
                    </div>
                    {friends.length ? (
                      friends.map((friend) => (
                        <div key={`local-${friend.id}`} className="friend-row">
                          <div className="friend-avatar">{friend.id.slice(0, 1).toUpperCase()}</div>
                          <div className={`friend-status-dot ${friend.status}`} />
                          <div className="friend-meta">
                            <strong>{friend.id}</strong>
                            <span>{friend.note && friend.status !== 'playing' ? friend.note : formatFriendPresence(friend.status, friend.note)}</span>
                          </div>
                          <div className="friend-actions">
                            <span className="friend-state">{formatFriendPresence(friend.status, friend.note)}</span>
                            <button className="secondary-action compact-action danger-action" onClick={() => void handleRemoveFriend(friend.id, friend.id)}>
                              Удалить
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="hint-text">Список друзей пока пуст. Добавьте первого друга в блоке выше.</p>
                    )}
                  </div>
                ) : null}
                {!isNetplayConnected && !friends.length ? (
                  <p className="hint-text">Список друзей пока пуст. Добавьте первого друга в блоке выше.</p>
                ) : null}
              </div>
            ) : null}
          </section>
        </aside>

        <main className="main-panel">
          {selectedGame ? (
            <>
              <section className="hero-panel">
                <div className="hero-cover-frame">
                  {selectedGame.coverDataUrl ? (
                    <img src={selectedGame.coverDataUrl} alt={selectedGame.title} className="hero-cover-image" />
                  ) : (
                    <div className="hero-cover-fallback" style={{ background: `linear-gradient(145deg, ${selectedGamePalette?.[0]}, ${selectedGamePalette?.[1]})` }}>
                      <span>{formatPlatform(selectedGame.platform)}</span>
                      <strong>{selectedGame.title}</strong>
                    </div>
                  )}
                </div>
                <div className="hero-copy">
                  <span className="eyebrow">{formatPlatform(selectedGame.platform)}</span>
                  <div className="hero-title-row">
                    <h2>{selectedGame.title}</h2>
                    <span className="chip neutral">{formatLaunchCountLabel(selectedGame.launchCount)}</span>
                  </div>
                  <div className="hero-actions">
                    <button className="primary-action" disabled={(!canLaunchSelectedGame && !canConfigureSelectedGame) || isPlayerLoading} onClick={() => void handleLaunchGame()}>
                      {selectedGameActionLabel}
                    </button>
                    <button
                      className={netplayPanelOpen ? 'secondary-action active-binding' : 'secondary-action'}
                      onClick={() => setNetplayPanelOpen((current) => !current)}
                    >
                      Онлайн
                    </button>
                    <button className="secondary-action danger-action" onClick={() => void handleRemoveGame()}>
                      Удалить из библиотеки
                    </button>
                  </div>
                  {netplayPanelOpen ? (
                    <section className="panel hero-online-panel">
                      <div className="panel-header">
                        <div>
                          <span className="eyebrow">Онлайн</span>
                          <h3 className="online-panel-title">Комната</h3>
                        </div>
                        <div className="online-panel-chips">
                          <span className="chip neutral">Стрим от хоста</span>
                          <span className={isNetplayConnected ? 'chip success' : 'chip neutral'}>
                            {isNetplayConnected ? 'В сети' : 'Оффлайн'}
                          </span>
                        </div>
                      </div>

                      {!selectedGameNetplaySupported && !netplayRoom ? (
                        <p className="hint-text">Для этой игры онлайн пока не подключен. Сейчас стриминг от хоста работает для NES, SNES и Mega Drive.</p>
                      ) : null}

                      {!isNetplayConnected ? (
                        <div className="inline-actions">
                          <button className="primary-action compact-action" onClick={() => handleConnectNetplay()}>
                            Войти в онлайн
                          </button>
                        </div>
                      ) : null}

                      {isNetplayConnected && !netplayRoom && selectedGameNetplaySupported ? (
                        <>
                          <div className="inline-actions">
                            <button className="primary-action compact-action" disabled={!canCreateNetplayRoom} onClick={() => handleCreateNetplayRoom()}>
                              Создать комнату
                            </button>
                            <button className="secondary-action compact-action" onClick={() => handleDisconnectNetplay()}>
                              Выйти из онлайна
                            </button>
                          </div>
                          <p className="hint-text">Комната запускает стрим от хоста. Второй игрок получает видео и управляет игрой удаленно.</p>
                        </>
                      ) : null}

                      {netplayRoom ? (
                        <>
                          <div className="online-room-summary">
                            <div className="online-room-item">
                              <span>Игроков</span>
                              <strong>{netplayRoom.members.length} / 2</strong>
                            </div>
                            <div className="online-room-item">
                              <span>Платформа</span>
                              <strong>{formatPlatform(netplayRoom.platform)}</strong>
                            </div>
                          </div>
                          <p className="hint-text">{netplaySyncStatus}</p>
                          <div className="inline-actions">
                            <button className={currentNetplayMember?.ready ? 'switch-toggle active' : 'switch-toggle'} onClick={() => handleNetplayReadyToggle()}>
                              {currentNetplayMember?.ready ? 'Готов' : 'Не готов'}
                            </button>
                            {isNetplayHost ? (
                              <button className="primary-action compact-action" onClick={() => handleNetplayLaunchRoom()}>
                                Запустить
                              </button>
                            ) : null}
                            <button className="secondary-action compact-action" onClick={() => handleNetplayLeaveRoom()}>
                              Выйти
                            </button>
                          </div>
                        </>
                      ) : null}

                      {netplayError ? <p className="hint-text">{netplayError}</p> : null}
                    </section>
                  ) : null}
                </div>
              </section>

              {libraryControlsOpen ? (
                <div className="library-controls-overlay" onClick={() => {
                  setLibraryControlsOpen(false);
                  setRebindingAction(null);
                }}>
                  <section className="pause-menu library-controls-menu" onClick={(event) => event.stopPropagation()}>
                    <div className="pause-header">
                      <div>
                        <span className="eyebrow">Управление</span>
                        <h2>{selectedGame.title}</h2>
                        <div className="pause-meta">
                          <span className="chip neutral">Платформа: {formatPlatform(selectedGame.platform)}</span>
                          {activeConnectedGamepad ? <span className="chip neutral">Геймпад: подключен</span> : <span className="chip neutral">Геймпад: нет</span>}
                        </div>
                      </div>
                      <div className="pause-header-actions">
                        <button className="primary-action compact-action" onClick={() => {
                          setLibraryControlsOpen(false);
                          setRebindingAction(null);
                        }}>
                          Закрыть
                        </button>
                      </div>
                    </div>

                    {renderControlsEditor(selectedGame)}
                  </section>
                </div>
              ) : null}
            </>
          ) : (
            <section className="panel empty-state">
              <strong>Выберите игру или импортируйте ROM.</strong>
              <p>После импорта библиотека сохранится на диске, а запуск базовых платформ пойдет прямо внутри окна приложения.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
