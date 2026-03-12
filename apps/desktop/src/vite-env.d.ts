/// <reference types="vite/client" />

import type {
  AutoSaveSummary,
  AppStatePayload,
  ControlBindings,
  GameMetadata,
  GameControlBindingsByGameId,
  EmbeddedLaunchPayload,
  EmbeddedPreferences,
  EmbeddedPreferencesByPlatform,
  EmulatorProfile,
  EmulatorProfiles,
  ImportRomsResult,
  LoadAutoSaveResult,
  LoadGameStateResult,
  LaunchGameResult,
  LibraryGame,
  FriendEntry,
  FriendStatus,
  PlatformId,
  ProfileState,
  SaveSlotSummary
} from './types';

interface EmusolBridge {
  getRuntimeInfo: () => Promise<{
    appVersion: string;
    platform: string;
    isPackaged: boolean;
  }>;
  loadState: () => Promise<AppStatePayload>;
  saveProfile: (profile: ProfileState) => Promise<ProfileState>;
  saveFriend: (friend: { id?: string; name: string; status: FriendStatus; note: string }) => Promise<FriendEntry[]>;
  removeFriend: (friendId: string) => Promise<FriendEntry[]>;
  saveEmbeddedPreferences: (platform: PlatformId, preferences: Partial<EmbeddedPreferences>) => Promise<EmbeddedPreferencesByPlatform>;
  saveGameControlBindings: (gameId: string, bindings: Partial<ControlBindings>) => Promise<GameControlBindingsByGameId>;
  importRoms: () => Promise<ImportRomsResult>;
  removeGame: (gameId: string) => Promise<LibraryGame[]>;
  setGameCover: (gameId: string, coverDataUrl?: string, source?: 'none' | 'auto' | 'manual') => Promise<LibraryGame>;
  fetchAutoCover: (gameId: string) => Promise<LibraryGame | null>;
  saveGameMetadata: (gameId: string, patch: Partial<GameMetadata>) => Promise<LibraryGame>;
  chooseEmulatorExecutable: (platform: PlatformId) => Promise<string | null>;
  saveEmulatorProfile: (platform: PlatformId, profile: Partial<EmulatorProfile>) => Promise<EmulatorProfiles>;
  launchGame: (gameId: string) => Promise<LaunchGameResult>;
  prepareEmbeddedLaunch: (gameId: string) => Promise<EmbeddedLaunchPayload>;
  relinkMissingRom: (gameId: string) => Promise<{ game: LibraryGame; library: LibraryGame[] } | null>;
  getGameSaveSlots: (gameId: string) => Promise<SaveSlotSummary[]>;
  getAutoSave: (gameId: string) => Promise<AutoSaveSummary>;
  saveGameStateSlot: (gameId: string, slot: number, stateBase64: string, thumbnailDataUrl?: string) => Promise<SaveSlotSummary[]>;
  loadGameStateSlot: (gameId: string, slot: number) => Promise<LoadGameStateResult>;
  saveAutoState: (gameId: string, stateBase64: string, thumbnailDataUrl?: string) => Promise<AutoSaveSummary>;
  loadAutoState: (gameId: string) => Promise<LoadAutoSaveResult>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
}

declare global {
  interface Window {
    emusol?: EmusolBridge;
  }
}

export {};
