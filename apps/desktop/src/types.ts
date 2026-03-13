export type ThemeMode = 'dark' | 'light' | 'pink';
export type FilterMode = 'ALL' | 'ACTIVE' | 'FUTURE';
export type PlatformId = 'NES' | 'SNES' | 'GB' | 'GBC' | 'GBA' | 'MEGADRIVE' | 'N64' | 'GCN' | 'DS' | '3DS';
export type SupportTier = 'v1' | 'future';
export type FriendStatus = 'online' | 'offline' | 'playing';
export type ControlAction = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select';
export type VideoFilterMode = 'sharp' | 'smooth';
export type VideoAspectRatio = 'auto' | '4:3' | '8:7' | '3:2';
export type SecondScreenLayoutMode = 'right' | 'left' | 'top' | 'bottom' | 'detached';
export type DualScreenPrimary = 'top' | 'bottom';
export type ScreenScaleMode = 'fit' | 'stretch';
export type CoverSource = 'none' | 'auto' | 'manual';
export type MetadataSource = 'import' | 'manual' | 'mixed';

export interface GameMetadata {
  description: string;
  genres: string[];
  releaseYear?: number;
  developer?: string;
  publisher?: string;
  region?: string;
  languages: string[];
  notes?: string;
  coverSource: CoverSource;
  metadataSource: MetadataSource;
  updatedAt?: string;
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

export interface FriendEntry {
  id: string;
  name: string;
  status: FriendStatus;
  note: string;
  avatarDataUrl?: string;
}

export interface ProfileState {
  displayName: string;
  avatarDataUrl?: string;
  theme: ThemeMode;
  accentColor: string;
}

export interface RuntimeInfo {
  appVersion: string;
  platform: string;
  isPackaged: boolean;
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

export interface AppStatePayload {
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
