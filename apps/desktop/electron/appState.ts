import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applyMetadataPatch,
  buildGameSubtitle,
  buildGameTags,
  createImportedMetadata,
  mergeGameMetadata,
  type CoverSource,
  type GameMetadata
} from './gameMetadata';

export type ThemeMode = 'dark' | 'light' | 'pink';
export type PlatformId = 'NES' | 'SNES' | 'GB' | 'GBC' | 'GBA' | 'MEGADRIVE' | 'N64' | 'GCN' | 'DS' | '3DS';
export type SupportTier = 'v1' | 'future';
export type FriendStatus = 'online' | 'offline' | 'playing';
export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select';
export type VideoFilterMode = 'sharp' | 'smooth';
export type VideoAspectRatio = 'auto' | '4:3' | '8:7' | '3:2';
export type SecondScreenLayoutMode = 'right' | 'left' | 'top' | 'bottom' | 'detached';
export type DualScreenPrimary = 'top' | 'bottom';
export type ScreenScaleMode = 'fit' | 'stretch';

export interface ProfileState {
  displayName: string;
  avatarDataUrl?: string;
  theme: ThemeMode;
  accentColor: string;
}

export interface FriendEntry {
  id: string;
  name: string;
  status: FriendStatus;
  note: string;
}

export interface LibraryGame {
  id: string;
  title: string;
  subtitle: string;
  platform: PlatformId;
  supportTier: SupportTier;
  romPath: string;
  romFileName: string;
  summary: string;
  statusLabel: string;
  tags: string[];
  addedAt: string;
  lastPlayedAt?: string;
  launchCount: number;
  coverDataUrl?: string;
  metadata: GameMetadata;
}

export interface EmulatorProfile {
  executablePath: string;
  argsTemplate: string;
}

export type EmulatorProfiles = Record<PlatformId, EmulatorProfile>;
export type ControlBindings = Record<ControlAction, string>;
export type GameControlBindingsByGameId = Record<string, ControlBindings>;

export interface EmbeddedPreferences {
  volumePercent: number;
  muted: boolean;
  quickSlot: number;
  controlBindings: ControlBindings;
  videoFilter: VideoFilterMode;
  integerScale: boolean;
  aspectRatio: VideoAspectRatio;
  secondScreenLayout: SecondScreenLayoutMode;
  primaryScreen: DualScreenPrimary;
  secondScreenSizePercent: number;
  primaryScreenScaleMode: ScreenScaleMode;
  secondaryScreenScaleMode: ScreenScaleMode;
}

export type EmbeddedPreferencesByPlatform = Record<PlatformId, EmbeddedPreferences>;

export interface SaveSlotSummary {
  slot: number;
  hasState: boolean;
  updatedAt?: string;
  thumbnailDataUrl?: string;
}

export interface AutoSaveSummary {
  hasState: boolean;
  updatedAt?: string;
  thumbnailDataUrl?: string;
}

export interface PersistedAppState {
  profile: ProfileState;
  library: LibraryGame[];
  friends: FriendEntry[];
  emulatorProfiles: EmulatorProfiles;
  embeddedPreferencesByPlatform: EmbeddedPreferencesByPlatform;
  gameControlBindingsByGameId: GameControlBindingsByGameId;
}

export interface ImportRomsResult {
  library: LibraryGame[];
  addedGameIds: string[];
  duplicateFiles: string[];
  unsupportedFiles: string[];
}

export interface LaunchGameResult {
  ok: boolean;
  message: string;
}

export interface EmbeddedLaunchPayload {
  game: LibraryGame;
  library: LibraryGame[];
  romBase64: string;
  preferences: EmbeddedPreferences;
}

export interface LoadGameStateResult {
  stateBase64: string;
  slots: SaveSlotSummary[];
}

export interface LoadAutoSaveResult {
  stateBase64: string;
  summary: AutoSaveSummary;
}

export interface RelinkGameRomResult {
  game: LibraryGame;
  library: LibraryGame[];
}

const PLATFORM_EXTENSIONS: Record<PlatformId, string[]> = {
  NES: ['nes'],
  SNES: ['sfc', 'smc'],
  GB: ['gb'],
  GBC: ['gbc'],
  GBA: ['gba'],
  MEGADRIVE: ['md', 'gen', 'bin', 'smd'],
  N64: ['z64', 'n64', 'v64'],
  GCN: ['iso', 'gcm'],
  DS: ['nds'],
  '3DS': ['3ds', 'cci', 'cxi']
};

const PLATFORM_THUMBNAIL_PATH: Partial<Record<PlatformId, string>> = {
  NES: 'Nintendo - Nintendo Entertainment System',
  SNES: 'Nintendo - Super Nintendo Entertainment System',
  GB: 'Nintendo - Game Boy',
  GBC: 'Nintendo - Game Boy Color',
  GBA: 'Nintendo - Game Boy Advance',
  MEGADRIVE: 'Sega - Mega Drive - Genesis',
  N64: 'Nintendo - Nintendo 64',
  DS: 'Nintendo - Nintendo DS',
  GCN: 'Nintendo - GameCube',
  '3DS': 'Nintendo - Nintendo 3DS'
};

const COVER_IMAGE_DIRECTORIES = ['Named_Boxarts', 'Named_Titles', 'Named_Snaps'] as const;
const SHORT_REGION_LABELS: Record<string, string> = {
  U: 'USA',
  E: 'Europe',
  J: 'Japan',
  W: 'World',
  K: 'Korea',
  A: 'Australia',
  B: 'Brazil',
  F: 'France',
  G: 'Germany',
  S: 'Spain',
  I: 'Italy',
  R: 'Russia',
  C: 'China'
};

const V1_PLATFORMS = new Set<PlatformId>(['NES', 'SNES', 'GB', 'GBC', 'GBA', 'MEGADRIVE', 'N64', 'DS']);

const stateFilePath = (): string => path.join(app.getPath('userData'), 'emusol-state.json');
const saveStatesRootPath = (): string => path.join(app.getPath('userData'), 'save-states');

const defaultProfile = (): ProfileState => ({
  displayName: 'Игрок',
  theme: 'dark',
  accentColor: '#ff5548'
});

const defaultFriends = (): FriendEntry[] => [
  { id: 'mira', name: 'Мира', status: 'online', note: '' },
  { id: 'teo', name: 'Тео', status: 'online', note: '' },
  { id: 'lena', name: 'Лена', status: 'offline', note: '' }
];

const legacySystemFriendNotes = new Set([
  'Ждет кооператив, когда дойдем до онлайна.',
  'Тестирует текущий интерфейс библиотеки.',
  'Подключится позже.'
]);

const mojibakePattern = /[\u00D0\u00D1\u00C3\u00E2]/;
const brokenTextPattern = /[\u0000-\u001f{}]/;

const normalizeLegacyText = (value: unknown, fallback = ''): string => {
  const initial = String(value ?? fallback).trim();
  if (!initial) {
    return fallback;
  }

  let next = initial;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!mojibakePattern.test(next)) {
      break;
    }

    const decoded = Buffer.from(next, 'latin1').toString('utf8').replace(/\uFFFD/g, '').trim();
    if (!decoded || decoded === next) {
      break;
    }

    next = decoded;
  }

  return next || fallback;
};

const isClearlyBrokenText = (rawValue: unknown, normalizedValue: string): boolean => {
  const raw = String(rawValue ?? '').trim();
  return (
    raw.startsWith(':') ||
    normalizedValue.startsWith(':') ||
    mojibakePattern.test(raw) ||
    mojibakePattern.test(normalizedValue) ||
    brokenTextPattern.test(raw) ||
    brokenTextPattern.test(normalizedValue)
  );
};

const normalizeCoverCandidate = (value: string): string =>
  value
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*]/g, ' ')
    .replace(/^\d+\s*-\s*/g, ' ')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

const moveTrailingArticle = (value: string): string =>
  value.replace(/^(.*),\s*(The|A|An)$/i, (_, title: string, article: string) => `${article} ${title}`.trim());

const stripDiacritics = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const expandShortRegionGroup = (value: string): string[] => {
  const variants = new Set<string>();
  const match = value.match(/([\(\[])([A-Z,]{1,8})([\)\]])/);
  const group = match?.[2]?.replace(/\s+/g, '') ?? '';
  if (!group) {
    return [];
  }

  const regionCodes = group.includes(',') ? group.split(',') : group.split('');
  const labels = regionCodes.map((code) => SHORT_REGION_LABELS[code]).filter(Boolean);
  if (!labels.length) {
    return [];
  }

  variants.add(value.replace(match![0], `${match![1]}${labels.join(', ')}${match![3]}`));
  if (labels.length > 1) {
    variants.add(value.replace(match![0], `${match![1]}${labels.join('/')}${match![3]}`));
  }

  return Array.from(variants);
};

const pushCoverCandidate = (target: Set<string>, value: string) => {
  const normalized = value.trim();
  if (normalized) {
    target.add(normalized);
  }
};

const pushCoverCandidateFamily = (target: Set<string>, value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  const variants = new Set<string>([
    normalized,
    moveTrailingArticle(normalized),
    stripDiacritics(normalized),
    stripDiacritics(moveTrailingArticle(normalized)),
    normalized.replace(/:\s*/g, ' - '),
    normalized.replace(/\s+-\s+/g, ': '),
    normalized.replace(/\s+-\s+/g, ' '),
    normalized.replace(/[!']/g, ''),
    normalized.replace(/[!?'",.]/g, ''),
    normalized.replace(/[\/\\]/g, ' '),
    normalized.replace(/\s*&\s*/g, ' and '),
    normalized.replace(/\band\b/gi, '&')
  ]);

  for (const variant of variants) {
    pushCoverCandidate(target, variant.replace(/\s+/g, ' ').trim());
  }
};

const createCoverTitleCandidates = (game: LibraryGame): string[] => {
  const romBaseName = game.romFileName.replace(/\.[^.]+$/, '');
  const seeds = [game.title, romBaseName];
  const candidates = new Set<string>();

  for (const seed of seeds) {
    const normalized = normalizeCoverCandidate(seed);
    const movedArticle = moveTrailingArticle(normalized);
    const noSubtitle = normalized.split(' - ')[0]?.trim() ?? '';
    const noColonSubtitle = normalized.split(': ')[0]?.trim() ?? '';
    const regionExpandedVariants = expandShortRegionGroup(seed);

    pushCoverCandidateFamily(candidates, seed);
    pushCoverCandidateFamily(candidates, normalized);
    pushCoverCandidateFamily(candidates, movedArticle);
    pushCoverCandidateFamily(candidates, noSubtitle);
    pushCoverCandidateFamily(candidates, noColonSubtitle);
    regionExpandedVariants.forEach((variant) => pushCoverCandidateFamily(candidates, variant));
  }

  return Array.from(candidates);
};

const buildCoverCandidateUrls = (game: LibraryGame): string[] => {
  const systemPath = PLATFORM_THUMBNAIL_PATH[game.platform];
  if (!systemPath) {
    return [];
  }

  const encodedSystem = encodeURIComponent(systemPath);
  const sources = [
    `https://thumbnails.libretro.com/${encodedSystem}`,
    `https://raw.githubusercontent.com/libretro-thumbnails/${encodedSystem}/master`
  ];

  return createCoverTitleCandidates(game).flatMap((candidate) => {
    const encodedTitle = encodeURIComponent(candidate);
    return sources.flatMap((source) =>
      COVER_IMAGE_DIRECTORIES.flatMap((directory) => [
        `${source}/${directory}/${encodedTitle}.png`,
        `${source}/${directory}/${encodedTitle}.jpg`
      ])
    );
  });
};

const fetchAutoCoverDataUrl = async (game: LibraryGame): Promise<string | null> => {
  const urls = buildCoverCandidateUrls(game);

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/*,*/*;q=0.8',
          'User-Agent': 'Emusol/0.1'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch {
      // ignored
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return null;
};

const defaultFriendById = (): Record<string, FriendEntry> =>
  Object.fromEntries(defaultFriends().map((friend) => [friend.id, friend]));

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

const mergeControlBindingCandidate = (
  baseBindings: ControlBindings,
  candidate: Partial<ControlBindings> | null | undefined
): ControlBindings => {
  const nextBindings: ControlBindings = { ...baseBindings };

  for (const action of Object.keys(nextBindings) as ControlAction[]) {
    const binding = candidate?.[action];
    if (typeof binding === 'string' && binding.trim()) {
      nextBindings[action] = binding.trim().toLowerCase();
    }
  }

  return nextBindings;
};

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

const defaultState = (): PersistedAppState => ({
  profile: defaultProfile(),
  library: [],
  friends: defaultFriends(),
  emulatorProfiles: createDefaultEmulatorProfiles(),
  embeddedPreferencesByPlatform: createDefaultEmbeddedPreferencesByPlatform(),
  gameControlBindingsByGameId: {}
});

const TRAILING_GROUP_PATTERN = /\s*(\([^()]*\)|\[[^[\]]*])\s*$/;

const looksLikeRomMetadata = (value: string): boolean => {
  const normalized = value
    .toLowerCase()
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /\b(19|20)\d{2}\b/.test(normalized) ||
    /(?:^|[\s,])(?:usa|europe|japan|world|france|germany|spain|italy|korea|asia|brazil|australia|russia|russian federation|eng(?:lish)?|fr(?:ench)?|de(?:utsch|german)?|es(?:panol|spanish)?|it(?:aliano|italian)?|pt(?:-br|brazil|portuguese)?|ru(?:ssian)?|ja(?:panese)?|ko(?:rean)?|zh(?:-hans|-hant| chinese)?|en|fr|de|es|it|pt|ru|ja|ko|zh|rev(?:ision)?\.?\s*\d+|v\d+(?:\.\d+)?|beta|proto(?:type)?|sample|demo|alpha|promo|pre-release|unl|pirate|aftermarket|virtual console|switch online|hack|translation|translated|homebrew|m\d+|b\d+|h\d+|t[+-][a-z0-9]+|!|\+)(?:$|[\s,])/i.test(
      normalized
    ) ||
    /^(?:[uejwkabfgsirc]|[uejwkabfgsirc]{2,4}|[uejwkabfgsirc](?:,[uejwkabfgsirc]){1,4})$/i.test(normalized) ||
    /^[a-z]{2}(?:\s*,\s*[a-z]{2})+$/i.test(normalized) ||
    /^[a-z]{2,}(?:\s*,\s*[a-z]{2,})+$/i.test(normalized)
  );
};

const normalizeTitle = (value: string): string => {
  let next = value.replace(/^\d+\s*-\s*/, '').trim();

  while (TRAILING_GROUP_PATTERN.test(next)) {
    const match = next.match(TRAILING_GROUP_PATTERN);
    const group = match?.[1];

    if (!group) {
      break;
    }

    const content = group.slice(1, -1).trim();
    if (!looksLikeRomMetadata(content)) {
      break;
    }

    next = next.replace(TRAILING_GROUP_PATTERN, '').trim();
  }

  next = next
    .replace(/\s-\s(?:beta|proto(?:type)?|demo|sample|alpha|rev(?:ision)?\.?\s*\d+|v\d+(?:\.\d+)?)$/i, '')
    .replace(/\s+(19|20)\d{2}$/i, '')
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const trailingArticle = next.match(/^(.*),\s(The|A|An)$/i);
  if (trailingArticle) {
    next = `${trailingArticle[2]} ${trailingArticle[1]}`.trim();
  }

  return next;
};

const formatPlatform = (platform: PlatformId): string => {
  if (platform === 'MEGADRIVE') return 'Mega Drive';
  if (platform === 'GCN') return 'GameCube';
  return platform;
};

export const detectPlatformFromPath = (filePath: string): PlatformId | null => {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();

  for (const [platform, extensions] of Object.entries(PLATFORM_EXTENSIONS) as Array<[PlatformId, string[]]>) {
    if (extensions.includes(ext)) {
      return platform;
    }
  }

  return null;
};

export const createRomDialogFilters = () => [
  {
    name: 'Все ROM',
    extensions: Array.from(new Set(Object.values(PLATFORM_EXTENSIONS).flat()))
  },
  { name: 'NES', extensions: PLATFORM_EXTENSIONS.NES },
  { name: 'SNES', extensions: PLATFORM_EXTENSIONS.SNES },
  { name: 'Game Boy', extensions: [...PLATFORM_EXTENSIONS.GB, ...PLATFORM_EXTENSIONS.GBC, ...PLATFORM_EXTENSIONS.GBA] },
  { name: 'Mega Drive', extensions: PLATFORM_EXTENSIONS.MEGADRIVE }
];

const getStatusLabel = (supportTier: SupportTier): string => (supportTier === 'v1' ? 'Первая версия' : 'Позже');

export const createRomDialogFiltersForPlatform = (platform: PlatformId) => [
  {
    name: formatPlatform(platform),
    extensions: PLATFORM_EXTENSIONS[platform]
  },
  {
    name: 'All ROM',
    extensions: Array.from(new Set(Object.values(PLATFORM_EXTENSIONS).flat()))
  }
];

const syncGamePresentation = (game: LibraryGame): LibraryGame => {
  const platformLabel = formatPlatform(game.platform);

  return {
    ...game,
    summary: '',
    subtitle: buildGameSubtitle(platformLabel, game.supportTier, game.metadata),
    statusLabel: getStatusLabel(game.supportTier),
    tags: buildGameTags(platformLabel, game.supportTier, game.metadata)
  };
};

const ensureStateDirectory = async (): Promise<void> => {
  await fs.mkdir(path.dirname(stateFilePath()), { recursive: true });
};

const ensureSaveStatesDirectory = async (): Promise<void> => {
  await fs.mkdir(saveStatesRootPath(), { recursive: true });
};

const saveSlotFilePath = (gameId: string, slot: number): string => path.join(saveStatesRootPath(), gameId, `slot-${slot}.state`);
const saveSlotThumbnailPath = (gameId: string, slot: number): string => path.join(saveStatesRootPath(), gameId, `slot-${slot}.png`);
const autoSaveFilePath = (gameId: string): string => path.join(saveStatesRootPath(), gameId, 'auto.state');
const autoSaveThumbnailPath = (gameId: string): string => path.join(saveStatesRootPath(), gameId, 'auto.png');

const dataUrlToBuffer = (value: string): Buffer => {
  const [, base64 = ''] = value.split(',');
  return Buffer.from(base64, 'base64');
};

const fileToDataUrl = async (targetPath: string, mimeType: string): Promise<string> => {
  const buffer = await fs.readFile(targetPath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

const createEmptySaveSlots = (): SaveSlotSummary[] =>
  Array.from({ length: 3 }, (_, index) => ({
    slot: index + 1,
    hasState: false
  }));

const mergeEmbeddedPreferenceCandidate = (
  basePreferences: EmbeddedPreferences,
  candidate: Partial<EmbeddedPreferences> | null | undefined
): EmbeddedPreferences => {
  const nextControlBindings = mergeControlBindingCandidate(basePreferences.controlBindings, candidate?.controlBindings);

  return {
    volumePercent:
      typeof candidate?.volumePercent === 'number'
        ? Math.max(0, Math.min(100, Math.round(candidate.volumePercent)))
        : basePreferences.volumePercent,
    muted: typeof candidate?.muted === 'boolean' ? candidate.muted : basePreferences.muted,
    quickSlot:
      typeof candidate?.quickSlot === 'number'
        ? Math.max(1, Math.min(3, Math.round(candidate.quickSlot)))
        : basePreferences.quickSlot,
    controlBindings: nextControlBindings,
    videoFilter: candidate?.videoFilter === 'smooth' ? 'smooth' : basePreferences.videoFilter,
    integerScale: typeof candidate?.integerScale === 'boolean' ? candidate.integerScale : basePreferences.integerScale,
    aspectRatio:
      candidate?.aspectRatio === '4:3' || candidate?.aspectRatio === '8:7' || candidate?.aspectRatio === '3:2'
        ? candidate.aspectRatio
        : basePreferences.aspectRatio,
    secondScreenLayout:
      candidate?.secondScreenLayout === 'right' ||
      candidate?.secondScreenLayout === 'left' ||
      candidate?.secondScreenLayout === 'top' ||
      candidate?.secondScreenLayout === 'bottom' ||
      candidate?.secondScreenLayout === 'detached'
        ? candidate.secondScreenLayout
        : basePreferences.secondScreenLayout,
    primaryScreen: candidate?.primaryScreen === 'bottom' || candidate?.primaryScreen === 'top' ? candidate.primaryScreen : basePreferences.primaryScreen,
    secondScreenSizePercent:
      typeof candidate?.secondScreenSizePercent === 'number'
        ? Math.max(18, Math.min(40, Math.round(candidate.secondScreenSizePercent)))
        : basePreferences.secondScreenSizePercent,
    primaryScreenScaleMode:
      candidate?.primaryScreenScaleMode === 'fit' || candidate?.primaryScreenScaleMode === 'stretch'
        ? candidate.primaryScreenScaleMode
        : basePreferences.primaryScreenScaleMode,
    secondaryScreenScaleMode:
      candidate?.secondaryScreenScaleMode === 'fit' || candidate?.secondaryScreenScaleMode === 'stretch'
        ? candidate.secondaryScreenScaleMode
        : basePreferences.secondaryScreenScaleMode
  };
};

const listSaveSlots = async (gameId: string): Promise<SaveSlotSummary[]> => {
  await ensureSaveStatesDirectory();

  return Promise.all(
    createEmptySaveSlots().map(async (slotSummary) => {
      const statePath = saveSlotFilePath(gameId, slotSummary.slot);
      const thumbnailPath = saveSlotThumbnailPath(gameId, slotSummary.slot);

      try {
        const stateStat = await fs.stat(statePath);
        let thumbnailDataUrl: string | undefined;

        try {
          thumbnailDataUrl = await fileToDataUrl(thumbnailPath, 'image/png');
        } catch {
          thumbnailDataUrl = undefined;
        }

        return {
          slot: slotSummary.slot,
          hasState: true,
          updatedAt: stateStat.mtime.toISOString(),
          thumbnailDataUrl
        };
      } catch {
        return slotSummary;
      }
    })
  );
};

const getAutoSaveSummaryInternal = async (gameId: string): Promise<AutoSaveSummary> => {
  await ensureSaveStatesDirectory();

  try {
    const saveStat = await fs.stat(autoSaveFilePath(gameId));
    let thumbnailDataUrl: string | undefined;

    try {
      thumbnailDataUrl = await fileToDataUrl(autoSaveThumbnailPath(gameId), 'image/png');
    } catch {
      thumbnailDataUrl = undefined;
    }

    return {
      hasState: true,
      updatedAt: saveStat.mtime.toISOString(),
      thumbnailDataUrl
    };
  } catch {
    return { hasState: false };
  }
};

const mergeState = (candidate: Partial<PersistedAppState> | null | undefined): PersistedAppState => {
  const base = defaultState();
  const defaultFriendLookup = defaultFriendById();
  const legacyAwareCandidate = (candidate ?? null) as (Partial<PersistedAppState> & {
    embeddedPreferences?: Partial<EmbeddedPreferences>;
  }) | null;
  const nextProfile: ProfileState = candidate?.profile
    ? {
        displayName: normalizeLegacyText(candidate.profile.displayName || base.profile.displayName, base.profile.displayName),
        avatarDataUrl: typeof candidate.profile.avatarDataUrl === 'string' ? candidate.profile.avatarDataUrl : undefined,
        theme:
          candidate.profile.theme === 'light'
            ? 'light'
            : candidate.profile.theme === 'pink'
              ? 'pink'
              : 'dark',
        accentColor: typeof candidate.profile.accentColor === 'string' && candidate.profile.accentColor ? candidate.profile.accentColor : base.profile.accentColor
      }
    : base.profile;

  const nextLibrary = Array.isArray(candidate?.library)
    ? candidate!.library
        .filter((item): item is LibraryGame => Boolean(item && item.id && item.title && item.platform && item.romPath))
        .map((item) =>
          syncGamePresentation({
            ...item,
            supportTier: V1_PLATFORMS.has(item.platform) ? 'v1' : 'future',
            title: normalizeTitle(item.title || path.basename(item.romPath, path.extname(item.romPath))) || item.title,
            metadata: mergeGameMetadata(item.metadata, item.romFileName, item.coverDataUrl)
          })
        )
    : base.library;

  const nextFriends = Array.isArray(candidate?.friends)
    ? candidate.friends
        .filter((item): item is FriendEntry => Boolean(item && item.id && item.name))
        .map((item) => {
          const friendId = String(item.id);
          const normalizedName = normalizeLegacyText(item.name, 'Друг');
          const normalizedNote = normalizeLegacyText(item.note || '');
          const defaultFriend = defaultFriendLookup[friendId];
          const name = defaultFriend && isClearlyBrokenText(item.name, normalizedName) ? defaultFriend.name : normalizedName;
          const note =
            defaultFriend && (isClearlyBrokenText(item.note, normalizedNote) || legacySystemFriendNotes.has(normalizedNote))
              ? defaultFriend.note
              : normalizedNote;

          return {
            id: friendId,
            name: name.slice(0, 28) || 'Друг',
            status: (item.status === 'online' || item.status === 'playing' ? item.status : 'offline') as FriendStatus,
            note: note.slice(0, 120)
          };
        })
    : base.friends;

  const nextProfiles = createDefaultEmulatorProfiles();
  const inputProfiles: Partial<EmulatorProfiles> = candidate?.emulatorProfiles ?? {};

  for (const platform of Object.keys(nextProfiles) as PlatformId[]) {
    const fromInput = inputProfiles[platform];
    if (fromInput) {
      nextProfiles[platform] = {
        executablePath: String(fromInput.executablePath || ''),
        argsTemplate: String(fromInput.argsTemplate || '"{rom}"')
      };
    }
  }

  const nextEmbeddedPreferencesByPlatform = createDefaultEmbeddedPreferencesByPlatform();
  const candidatePreferencesByPlatform: Partial<EmbeddedPreferencesByPlatform> = legacyAwareCandidate?.embeddedPreferencesByPlatform ?? {};
  const legacyEmbeddedPreferences = legacyAwareCandidate?.embeddedPreferences;

  for (const platform of Object.keys(nextEmbeddedPreferencesByPlatform) as PlatformId[]) {
    nextEmbeddedPreferencesByPlatform[platform] = mergeEmbeddedPreferenceCandidate(
      nextEmbeddedPreferencesByPlatform[platform],
      candidatePreferencesByPlatform[platform] ?? legacyEmbeddedPreferences
    );
  }

  const nextGameControlBindingsByGameId: GameControlBindingsByGameId = {};
  const knownGameIds = new Set(nextLibrary.map((game) => game.id));
  const candidateGameControlBindings =
    legacyAwareCandidate?.gameControlBindingsByGameId && typeof legacyAwareCandidate.gameControlBindingsByGameId === 'object'
      ? legacyAwareCandidate.gameControlBindingsByGameId
      : {};

  for (const [gameId, bindings] of Object.entries(candidateGameControlBindings)) {
    if (!knownGameIds.has(gameId)) {
      continue;
    }

    const game = nextLibrary.find((entry) => entry.id === gameId);
    if (!game) {
      continue;
    }

    const platformDefaults = nextEmbeddedPreferencesByPlatform[game.platform]?.controlBindings ?? defaultControlBindings();
    nextGameControlBindingsByGameId[gameId] = mergeControlBindingCandidate(platformDefaults, bindings);
  }

  return {
    profile: nextProfile,
    library: nextLibrary,
    friends: nextFriends,
    emulatorProfiles: nextProfiles,
    embeddedPreferencesByPlatform: nextEmbeddedPreferencesByPlatform,
    gameControlBindingsByGameId: nextGameControlBindingsByGameId
  };
};

export const loadAppState = async (): Promise<PersistedAppState> => {
  await ensureStateDirectory();

  try {
    const raw = await fs.readFile(stateFilePath(), 'utf8');
    const normalized = mergeState(JSON.parse(raw) as Partial<PersistedAppState>);
    const serialized = JSON.stringify(normalized, null, 2);

    if (raw !== serialized) {
      await fs.writeFile(stateFilePath(), serialized, 'utf8');
    }

    return normalized;
  } catch {
    const fresh = defaultState();
    await saveAppState(fresh);
    return fresh;
  }
};

export const saveAppState = async (state: PersistedAppState): Promise<PersistedAppState> => {
  const normalized = mergeState(state);
  await ensureStateDirectory();
  await fs.writeFile(stateFilePath(), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
};

export const saveProfileState = async (profile: ProfileState): Promise<ProfileState> => {
  const state = await loadAppState();
  state.profile = {
    displayName: String(profile.displayName || 'Игрок'),
    avatarDataUrl: profile.avatarDataUrl,
    theme: profile.theme === 'light' ? 'light' : profile.theme === 'pink' ? 'pink' : 'dark',
    accentColor: String(profile.accentColor || '#ff5548')
  };
  const next = await saveAppState(state);
  return next.profile;
};

export const saveFriendEntry = async (
  friend: Omit<FriendEntry, 'id'> & { id?: string }
): Promise<FriendEntry[]> => {
  const state = await loadAppState();
  const normalizedId = typeof friend.id === 'string' && friend.id.trim() ? friend.id.trim() : randomUUID();
  const normalizedFriend: FriendEntry = {
    id: normalizedId,
    name: normalizeLegacyText(friend.name || normalizedId, normalizedId).slice(0, 60) || normalizedId,
    status: friend.status === 'online' || friend.status === 'playing' ? friend.status : 'offline',
    note: normalizeLegacyText(friend.note || '').slice(0, 120)
  };

  const existingIndex = state.friends.findIndex((item) => item.id.toLowerCase() === normalizedFriend.id.toLowerCase());
  if (existingIndex >= 0) {
    state.friends[existingIndex] = normalizedFriend;
  } else {
    state.friends.unshift(normalizedFriend);
  }

  const next = await saveAppState(state);
  return next.friends;
};

export const removeFriendEntry = async (friendId: string): Promise<FriendEntry[]> => {
  const state = await loadAppState();
  state.friends = state.friends.filter((item) => item.id !== friendId);
  const next = await saveAppState(state);
  return next.friends;
};

export const saveEmbeddedPreferences = async (
  platform: PlatformId,
  preferences: Partial<EmbeddedPreferences>
): Promise<EmbeddedPreferencesByPlatform> => {
  const state = await loadAppState();
  state.embeddedPreferencesByPlatform[platform] = mergeEmbeddedPreferenceCandidate(
    state.embeddedPreferencesByPlatform[platform] ?? defaultEmbeddedPreferences(),
    preferences
  );

  const next = await saveAppState(state);
  return next.embeddedPreferencesByPlatform;
};

export const saveGameControlBindings = async (
  gameId: string,
  bindings: Partial<ControlBindings>
): Promise<GameControlBindingsByGameId> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  const platformDefaults = state.embeddedPreferencesByPlatform[game.platform]?.controlBindings ?? defaultControlBindings();
  const currentBindings = state.gameControlBindingsByGameId[gameId] ?? platformDefaults;
  state.gameControlBindingsByGameId[gameId] = mergeControlBindingCandidate(currentBindings, bindings);

  const next = await saveAppState(state);
  return next.gameControlBindingsByGameId;
};

export const saveEmulatorProfile = async (
  platform: PlatformId,
  profile: Partial<EmulatorProfile>
): Promise<EmulatorProfiles> => {
  const state = await loadAppState();
  state.emulatorProfiles[platform] = {
    executablePath: typeof profile.executablePath === 'string' ? profile.executablePath : state.emulatorProfiles[platform].executablePath,
    argsTemplate: typeof profile.argsTemplate === 'string' && profile.argsTemplate.trim()
      ? profile.argsTemplate
      : state.emulatorProfiles[platform].argsTemplate || '"{rom}"'
  };
  const next = await saveAppState(state);
  return next.emulatorProfiles;
};

export const importRomFiles = async (filePaths: string[]): Promise<ImportRomsResult> => {
  const state = await loadAppState();
  const knownPaths = new Set(state.library.map((item) => item.romPath.toLowerCase()));
  const addedGameIds: string[] = [];
  const duplicateFiles: string[] = [];
  const unsupportedFiles: string[] = [];

  for (const filePath of filePaths) {
    const normalizedPath = filePath.toLowerCase();
    if (knownPaths.has(normalizedPath)) {
      duplicateFiles.push(path.basename(filePath));
      continue;
    }

    const platform = detectPlatformFromPath(filePath);
    if (!platform) {
      unsupportedFiles.push(path.basename(filePath));
      continue;
    }

    const supportTier: SupportTier = V1_PLATFORMS.has(platform) ? 'v1' : 'future';
    const fileName = path.basename(filePath);
    const title = normalizeTitle(path.basename(filePath, path.extname(filePath))) || fileName;
    const metadata = createImportedMetadata(fileName);

    state.library.unshift(
      syncGamePresentation({
      id: randomUUID(),
      title,
      subtitle: '',
      platform,
      supportTier,
      romPath: filePath,
      romFileName: fileName,
      summary: '',
      statusLabel: '',
      tags: [],
      addedAt: new Date().toISOString(),
      launchCount: 0,
      metadata
      })
    );

    knownPaths.add(normalizedPath);
    addedGameIds.push(state.library[0].id);
  }

  const next = await saveAppState(state);
  return {
    library: next.library,
    addedGameIds,
    duplicateFiles,
    unsupportedFiles
  };
};

export const setGameCover = async (
  gameId: string,
  coverDataUrl: string | undefined,
  source: CoverSource = coverDataUrl ? 'manual' : 'none'
): Promise<LibraryGame> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  game.coverDataUrl = coverDataUrl;
  game.metadata = applyMetadataPatch(game.metadata, {
    coverSource: coverDataUrl ? source : 'none'
  });
  Object.assign(game, syncGamePresentation(game));
  const next = await saveAppState(state);
  const updated = next.library.find((item) => item.id === gameId);

  if (!updated) {
    throw new Error('Не удалось обновить обложку.');
  }

  return updated;
};

export const fetchAndSetGameAutoCover = async (gameId: string): Promise<LibraryGame | null> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  if (game.coverDataUrl) {
    return game;
  }

  const coverDataUrl = await fetchAutoCoverDataUrl(game);
  if (!coverDataUrl) {
    return null;
  }

  game.coverDataUrl = coverDataUrl;
  game.metadata = applyMetadataPatch(game.metadata, {
    coverSource: 'auto'
  });
  Object.assign(game, syncGamePresentation(game));

  const next = await saveAppState(state);
  return next.library.find((item) => item.id === gameId) ?? null;
};

export const saveGameMetadata = async (gameId: string, patch: Partial<GameMetadata>): Promise<LibraryGame> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  game.metadata = applyMetadataPatch(game.metadata, patch);
  Object.assign(game, syncGamePresentation(game));

  const next = await saveAppState(state);
  const updated = next.library.find((item) => item.id === gameId);

  if (!updated) {
    throw new Error('Не удалось сохранить метаданные игры.');
  }

  return updated;
};

export const removeGameFromLibrary = async (gameId: string): Promise<LibraryGame[]> => {
  const state = await loadAppState();
  state.library = state.library.filter((item) => item.id !== gameId);
  delete state.gameControlBindingsByGameId[gameId];
  const next = await saveAppState(state);
  return next.library;
};

export const relinkGameRom = async (gameId: string, nextRomPath: string): Promise<RelinkGameRomResult> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  await ensurePathExists(nextRomPath, 'Выбранный ROM не найден.');

  const detectedPlatform = detectPlatformFromPath(nextRomPath);
  if (detectedPlatform !== game.platform) {
    throw new Error(`Выбран ROM другой платформы. Ожидался ${formatPlatform(game.platform)}.`);
  }

  game.romPath = nextRomPath;
  game.romFileName = path.basename(nextRomPath);

  const next = await saveAppState(state);
  const updated = next.library.find((item) => item.id === gameId);

  if (!updated) {
    throw new Error('Не удалось обновить путь к ROM.');
  }

  return {
    game: updated,
    library: next.library
  };
};

const tokenizeArgs = (value: string): string[] => {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((item) => item.replace(/^['"]|['"]$/g, ''));
};

const ensurePathExists = async (targetPath: string, errorMessage: string): Promise<void> => {
  try {
    await fs.access(targetPath);
  } catch {
    throw new Error(errorMessage);
  }
};

export const launchGame = async (gameId: string): Promise<LaunchGameResult> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  await ensurePathExists(game.romPath, 'Файл ROM не найден. Проверьте путь к игре.');

  const emulatorProfile = state.emulatorProfiles[game.platform];
  if (!emulatorProfile?.executablePath) {
    throw new Error(`Сначала укажите путь к эмулятору для платформы ${formatPlatform(game.platform)}.`);
  }

  await ensurePathExists(
    emulatorProfile.executablePath,
    `Эмулятор для ${formatPlatform(game.platform)} не найден по указанному пути.`
  );

  const expandedArgs = (emulatorProfile.argsTemplate || '"{rom}"')
    .replaceAll('{rom}', game.romPath)
    .replaceAll('{romName}', game.romFileName)
    .replaceAll('{romDir}', path.dirname(game.romPath))
    .replaceAll('{title}', game.title);

  const args = tokenizeArgs(expandedArgs);

  if (process.platform === 'darwin' && emulatorProfile.executablePath.toLowerCase().endsWith('.app')) {
    const child = spawn('open', ['-a', emulatorProfile.executablePath, '--args', ...args], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  } else {
    const child = spawn(emulatorProfile.executablePath, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  }

  game.lastPlayedAt = new Date().toISOString();
  game.launchCount += 1;
  await saveAppState(state);

  return {
    ok: true,
    message: `Запущено через внешний эмулятор: ${game.title}`
  };
};

export const prepareEmbeddedLaunch = async (gameId: string): Promise<EmbeddedLaunchPayload> => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  if (!V1_PLATFORMS.has(game.platform)) {
    throw new Error(`Платформа ${formatPlatform(game.platform)} пока не входит во встроенную поддержку первой версии.`);
  }

  await ensurePathExists(game.romPath, 'Файл ROM не найден. Проверьте путь к игре.');

  const romBase64 = (await fs.readFile(game.romPath)).toString('base64');
  game.lastPlayedAt = new Date().toISOString();
  game.launchCount += 1;

  const next = await saveAppState(state);
  const updated = next.library.find((item) => item.id === gameId);

  if (!updated) {
    throw new Error('Не удалось подготовить запуск игры.');
  }

  return {
    game: updated,
    library: next.library,
    romBase64,
    preferences: next.embeddedPreferencesByPlatform[game.platform]
  };
};

export const saveGameStateSlot = async (
  gameId: string,
  slot: number,
  stateBase64: string,
  thumbnailDataUrl?: string
): Promise<SaveSlotSummary[]> => {
  if (slot < 1 || slot > 3) {
    throw new Error('Неверный слот сохранения.');
  }

  const gameDirectory = path.join(saveStatesRootPath(), gameId);
  await ensureSaveStatesDirectory();
  await fs.mkdir(gameDirectory, { recursive: true });
  await fs.writeFile(saveSlotFilePath(gameId, slot), Buffer.from(stateBase64, 'base64'));

  if (thumbnailDataUrl) {
    await fs.writeFile(saveSlotThumbnailPath(gameId, slot), dataUrlToBuffer(thumbnailDataUrl));
  }

  return listSaveSlots(gameId);
};

export const loadGameStateSlot = async (gameId: string, slot: number): Promise<LoadGameStateResult> => {
  if (slot < 1 || slot > 3) {
    throw new Error('Неверный слот сохранения.');
  }

  const targetPath = saveSlotFilePath(gameId, slot);
  await ensurePathExists(targetPath, `Слот ${slot} пуст.`);
  const buffer = await fs.readFile(targetPath);

  return {
    stateBase64: buffer.toString('base64'),
    slots: await listSaveSlots(gameId)
  };
};

export const getGameSaveSlots = async (gameId: string): Promise<SaveSlotSummary[]> => listSaveSlots(gameId);

export const saveAutoState = async (gameId: string, stateBase64: string, thumbnailDataUrl?: string): Promise<AutoSaveSummary> => {
  const gameDirectory = path.join(saveStatesRootPath(), gameId);
  await ensureSaveStatesDirectory();
  await fs.mkdir(gameDirectory, { recursive: true });
  await fs.writeFile(autoSaveFilePath(gameId), Buffer.from(stateBase64, 'base64'));

  if (thumbnailDataUrl) {
    await fs.writeFile(autoSaveThumbnailPath(gameId), dataUrlToBuffer(thumbnailDataUrl));
  }

  return getAutoSaveSummaryInternal(gameId);
};

export const loadAutoState = async (gameId: string): Promise<LoadAutoSaveResult> => {
  const targetPath = autoSaveFilePath(gameId);
  await ensurePathExists(targetPath, 'Автосейв пока отсутствует.');
  const buffer = await fs.readFile(targetPath);

  return {
    stateBase64: buffer.toString('base64'),
    summary: await getAutoSaveSummaryInternal(gameId)
  };
};

export const getAutoSaveSummary = async (gameId: string): Promise<AutoSaveSummary> => getAutoSaveSummaryInternal(gameId);
