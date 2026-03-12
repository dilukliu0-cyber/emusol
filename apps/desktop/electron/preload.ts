import { contextBridge, ipcRenderer } from 'electron';
import type { EmbeddedPreferences, EmulatorProfile, FriendStatus, PlatformId, ProfileState } from './appState';
import type { GameMetadata } from './gameMetadata';

contextBridge.exposeInMainWorld('emusol', {
  getRuntimeInfo: async () => ipcRenderer.invoke('app:get-runtime-info'),
  loadState: async () => ipcRenderer.invoke('app:load-state'),
  saveProfile: async (profile: ProfileState) => ipcRenderer.invoke('profile:save', profile),
  saveFriend: async (friend: { id?: string; name: string; status: FriendStatus; note: string }) => ipcRenderer.invoke('friends:save', friend),
  removeFriend: async (friendId: string) => ipcRenderer.invoke('friends:remove', friendId),
  saveEmbeddedPreferences: async (platform: PlatformId, preferences: Partial<EmbeddedPreferences>) =>
    ipcRenderer.invoke('embedded:save-preferences', platform, preferences),
  importRoms: async () => ipcRenderer.invoke('library:import-roms'),
  removeGame: async (gameId: string) => ipcRenderer.invoke('library:remove-game', gameId),
  setGameCover: async (gameId: string, coverDataUrl?: string, source?: 'none' | 'auto' | 'manual') =>
    ipcRenderer.invoke('library:set-cover', gameId, coverDataUrl, source),
  fetchAutoCover: async (gameId: string) => ipcRenderer.invoke('library:auto-cover', gameId),
  saveGameMetadata: async (gameId: string, patch: Partial<GameMetadata>) => ipcRenderer.invoke('library:save-metadata', gameId, patch),
  chooseEmulatorExecutable: async (platform: PlatformId) => ipcRenderer.invoke('emulator:choose-executable', platform),
  saveEmulatorProfile: async (platform: PlatformId, profile: Partial<EmulatorProfile>) =>
    ipcRenderer.invoke('emulator:save-profile', platform, profile),
  launchGame: async (gameId: string) => ipcRenderer.invoke('game:launch', gameId),
  prepareEmbeddedLaunch: async (gameId: string) => ipcRenderer.invoke('game:prepare-embedded-launch', gameId),
  relinkMissingRom: async (gameId: string) => ipcRenderer.invoke('game:relink-missing-rom', gameId),
  getGameSaveSlots: async (gameId: string) => ipcRenderer.invoke('game:get-save-slots', gameId),
  getAutoSave: async (gameId: string) => ipcRenderer.invoke('game:get-auto-save', gameId),
  saveGameStateSlot: async (gameId: string, slot: number, stateBase64: string, thumbnailDataUrl?: string) =>
    ipcRenderer.invoke('game:save-state-slot', gameId, slot, stateBase64, thumbnailDataUrl),
  loadGameStateSlot: async (gameId: string, slot: number) => ipcRenderer.invoke('game:load-state-slot', gameId, slot),
  saveAutoState: async (gameId: string, stateBase64: string, thumbnailDataUrl?: string) =>
    ipcRenderer.invoke('game:save-auto-state', gameId, stateBase64, thumbnailDataUrl),
  loadAutoState: async (gameId: string) => ipcRenderer.invoke('game:load-auto-state', gameId),
  minimizeWindow: async () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: async () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: async () => ipcRenderer.invoke('window:close'),
  setFullscreen: async (fullscreen: boolean) => ipcRenderer.invoke('window:set-fullscreen', fullscreen)
});
