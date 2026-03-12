import type { Nostalgist as NostalgistInstance } from 'nostalgist';
import type { EmbeddedLaunchPayload, PlatformId } from './types';

export type BuiltInRuntimeId = 'nostalgist' | 'emulatorjs';
export type BuiltInLaunchState = 'ready' | 'prepared' | 'future';

type NostalgistCoreId = 'fceumm' | 'snes9x' | 'mgba' | 'genesis_plus_gx';
type NostalgistPlatformId = 'NES' | 'SNES' | 'GB' | 'GBC' | 'GBA' | 'MEGADRIVE';
type EmulatorJsCoreId = 'parallel_n64' | 'desmume';
type EmulatorJsPlatformId = 'N64' | 'DS';
type BuiltInStatusTone = 'success' | 'neutral' | 'warning';

export interface BuiltInPlatformDescriptor {
  runtime: BuiltInRuntimeId | null;
  canLaunch: boolean;
  launchState: BuiltInLaunchState;
  statusLabel: string;
  statusTone: BuiltInStatusTone;
  actionLabel: string;
  coreLabel: string | null;
  modeLabel: string;
  savesLabel: string;
}

const NOSTALGIST_CORE_BY_PLATFORM: Record<NostalgistPlatformId, NostalgistCoreId> = {
  NES: 'fceumm',
  SNES: 'snes9x',
  GB: 'mgba',
  GBC: 'mgba',
  GBA: 'mgba',
  MEGADRIVE: 'genesis_plus_gx'
};

const EMULATORJS_CORE_BY_PLATFORM: Record<EmulatorJsPlatformId, EmulatorJsCoreId> = {
  N64: 'parallel_n64',
  DS: 'desmume'
};

const CORE_LABEL_BY_ID: Record<NostalgistCoreId | EmulatorJsCoreId, string> = {
  fceumm: 'FCEUmm',
  snes9x: 'Snes9x',
  mgba: 'mGBA',
  genesis_plus_gx: 'Genesis Plus GX',
  parallel_n64: 'ParaLLEl N64',
  desmume: 'DeSmuME'
};

const PREPARED_PLATFORM_HINTS: Partial<
  Record<
    PlatformId,
    {
      actionLabel: string;
      coreLabel: string;
      modeLabel: string;
      savesLabel: string;
    }
  >
> = {
  '3DS': {
    actionLabel: '3DS ядро позже',
    coreLabel: 'Слот 3DS подготовлен',
    modeLabel: 'Архитектура 3DS уже подготовлена, но встроенного ядра в проекте пока нет.',
    savesLabel: 'Будут доступны после ядра'
  }
};

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const buildCoreAssetUrl = (core: NostalgistCoreId, extension: 'js' | 'wasm'): string =>
  new URL(`./cores/${core}_libretro.${extension}`, window.location.href).toString();

const getNostalgistCoreId = (platform: PlatformId): NostalgistCoreId | null => {
  if (platform in NOSTALGIST_CORE_BY_PLATFORM) {
    return NOSTALGIST_CORE_BY_PLATFORM[platform as NostalgistPlatformId];
  }

  return null;
};

export const getBuiltInRuntime = (platform: PlatformId): BuiltInRuntimeId | null => {
  if (platform in NOSTALGIST_CORE_BY_PLATFORM) {
    return 'nostalgist';
  }

  if (platform in EMULATORJS_CORE_BY_PLATFORM) {
    return 'emulatorjs';
  }

  return null;
};

export const getBuiltInCoreLabel = (platform: PlatformId): string | null => {
  const runtime = getBuiltInRuntime(platform);

  if (runtime === 'nostalgist') {
    const core = getNostalgistCoreId(platform);
    return core ? CORE_LABEL_BY_ID[core] : null;
  }

  if (runtime === 'emulatorjs') {
    return CORE_LABEL_BY_ID[EMULATORJS_CORE_BY_PLATFORM[platform as EmulatorJsPlatformId]];
  }

  return null;
};

export const getBuiltInPlatformDescriptor = (platform: PlatformId): BuiltInPlatformDescriptor => {
  const runtime = getBuiltInRuntime(platform);

  if (runtime === 'nostalgist') {
    const core = getNostalgistCoreId(platform);

    return {
      runtime,
      canLaunch: true,
      launchState: 'ready',
      statusLabel: 'Уже в приложении',
      statusTone: 'success',
      actionLabel: 'Играть в Emusol',
      coreLabel: core ? CORE_LABEL_BY_ID[core] : 'Встроенное ядро',
      modeLabel: 'Nostalgist | Esc открывает игровое меню',
      savesLabel: '3 слота на игру'
    };
  }

  if (runtime === 'emulatorjs') {
    return {
      runtime,
      canLaunch: true,
      launchState: 'ready',
      statusLabel: 'Уже в приложении',
      statusTone: 'success',
      actionLabel: 'Играть в Emusol',
      coreLabel: CORE_LABEL_BY_ID[EMULATORJS_CORE_BY_PLATFORM[platform as EmulatorJsPlatformId]],
      modeLabel: 'EmulatorJS | Esc открывает игровое меню',
      savesLabel: '3 слота на игру'
    };
  }

  const preparedHint = PREPARED_PLATFORM_HINTS[platform];
  if (preparedHint) {
    return {
      runtime: null,
      canLaunch: false,
      launchState: 'prepared',
      statusLabel: 'Подготовлено',
      statusTone: 'neutral',
      actionLabel: preparedHint.actionLabel,
      coreLabel: preparedHint.coreLabel,
      modeLabel: preparedHint.modeLabel,
      savesLabel: preparedHint.savesLabel
    };
  }

  return {
    runtime: null,
    canLaunch: false,
    launchState: 'future',
    statusLabel: 'Следующий этап',
    statusTone: 'warning',
    actionLabel: 'Платформа позже',
    coreLabel: 'Пока не подключено',
    modeLabel: 'Архитектура готова, ядро позже',
    savesLabel: 'Недоступно'
  };
};

export const getEmulatorJsCore = (platform: PlatformId): EmulatorJsCoreId | null => {
  if (platform in EMULATORJS_CORE_BY_PLATFORM) {
    return EMULATORJS_CORE_BY_PLATFORM[platform as EmulatorJsPlatformId];
  }

  return null;
};

export const getEmulatorJsDataPath = (): string => new URL('./emulatorjs/data/', window.location.href).toString();

export const isBuiltInPlatform = (platform: PlatformId): boolean => getBuiltInRuntime(platform) !== null;

const volumePercentToDb = (value: number): number => {
  const clamped = Math.max(0, Math.min(100, value));
  return Math.round(((clamped / 100) * 30 - 30) * 10) / 10;
};

const aspectRatioToRetroArchValue = (value: EmbeddedLaunchPayload['preferences']['aspectRatio']): string | null => {
  switch (value) {
    case '4:3':
      return '1.333333';
    case '8:7':
      return '1.142857';
    case '3:2':
      return '1.5';
    default:
      return null;
  }
};

const INTERNAL_PLAYER_BINDINGS = {
  1: {
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
  },
  2: {
    up: 'i',
    down: 'k',
    left: 'j',
    right: 'l',
    a: 'u',
    b: 'y',
    x: 'o',
    y: 't',
    l: 'r',
    r: 'p',
    start: '1',
    select: '2'
  }
} as const;

const buildControlConfig = () => ({
  input_player1_up: INTERNAL_PLAYER_BINDINGS[1].up,
  input_player1_down: INTERNAL_PLAYER_BINDINGS[1].down,
  input_player1_left: INTERNAL_PLAYER_BINDINGS[1].left,
  input_player1_right: INTERNAL_PLAYER_BINDINGS[1].right,
  input_player1_a: INTERNAL_PLAYER_BINDINGS[1].a,
  input_player1_b: INTERNAL_PLAYER_BINDINGS[1].b,
  input_player1_x: INTERNAL_PLAYER_BINDINGS[1].x,
  input_player1_y: INTERNAL_PLAYER_BINDINGS[1].y,
  input_player1_l: INTERNAL_PLAYER_BINDINGS[1].l,
  input_player1_r: INTERNAL_PLAYER_BINDINGS[1].r,
  input_player1_start: INTERNAL_PLAYER_BINDINGS[1].start,
  input_player1_select: INTERNAL_PLAYER_BINDINGS[1].select,
  input_player2_up: INTERNAL_PLAYER_BINDINGS[2].up,
  input_player2_down: INTERNAL_PLAYER_BINDINGS[2].down,
  input_player2_left: INTERNAL_PLAYER_BINDINGS[2].left,
  input_player2_right: INTERNAL_PLAYER_BINDINGS[2].right,
  input_player2_a: INTERNAL_PLAYER_BINDINGS[2].a,
  input_player2_b: INTERNAL_PLAYER_BINDINGS[2].b,
  input_player2_x: INTERNAL_PLAYER_BINDINGS[2].x,
  input_player2_y: INTERNAL_PLAYER_BINDINGS[2].y,
  input_player2_l: INTERNAL_PLAYER_BINDINGS[2].l,
  input_player2_r: INTERNAL_PLAYER_BINDINGS[2].r,
  input_player2_start: INTERNAL_PLAYER_BINDINGS[2].start,
  input_player2_select: INTERNAL_PLAYER_BINDINGS[2].select
});

const createLaunchOptions = (payload: EmbeddedLaunchPayload, canvas: HTMLCanvasElement) => {
  const core = getNostalgistCoreId(payload.game.platform);
  const aspectRatio = aspectRatioToRetroArchValue(payload.preferences.aspectRatio);

  if (!core) {
    throw new Error(`Для платформы ${payload.game.platform} текущий встроенный рантайм использует не Nostalgist.`);
  }

  return {
    element: canvas,
    rom: new File([toArrayBuffer(decodeBase64(payload.romBase64))], payload.game.romFileName),
    size: 'auto' as const,
    style: {
      width: '100%',
      height: '100%',
      backgroundColor: '#02040a'
    },
    retroarchConfig: {
      menu_enable_widgets: false,
      video_smooth: payload.preferences.videoFilter === 'smooth',
      video_scale_integer: payload.preferences.integerScale,
      video_force_aspect: aspectRatio !== null,
      video_aspect_ratio_auto: aspectRatio === null,
      video_aspect_ratio: aspectRatio ?? '1.333333',
      audio_volume: volumePercentToDb(payload.preferences.volumePercent),
      audio_mute_enable: payload.preferences.muted,
      ...buildControlConfig()
    },
    resolveCoreJs: () => buildCoreAssetUrl(core, 'js'),
    resolveCoreWasm: () => buildCoreAssetUrl(core, 'wasm')
  };
};

export const launchBuiltInGame = async (
  payload: EmbeddedLaunchPayload,
  canvas: HTMLCanvasElement
): Promise<NostalgistInstance> => {
  const { Nostalgist } = await import('nostalgist');
  const launchOptions = createLaunchOptions(payload, canvas);

  switch (payload.game.platform) {
    case 'NES':
      return Nostalgist.nes(launchOptions);
    case 'SNES':
      return Nostalgist.snes(launchOptions);
    case 'GB':
      return Nostalgist.gb(launchOptions);
    case 'GBC':
      return Nostalgist.gbc(launchOptions);
    case 'GBA':
      return Nostalgist.gba(launchOptions);
    case 'MEGADRIVE':
      return Nostalgist.megadrive(launchOptions);
    default:
      throw new Error(`Для платформы ${payload.game.platform} встроенное ядро Nostalgist пока не подключено.`);
  }
};
