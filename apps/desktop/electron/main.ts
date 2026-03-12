import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  createRomDialogFiltersForPlatform,
  fetchAndSetGameAutoCover,
  createRomDialogFilters,
  getAutoSaveSummary,
  getGameSaveSlots,
  importRomFiles,
  launchGame,
  loadAutoState,
  loadGameStateSlot,
  loadAppState,
  prepareEmbeddedLaunch,
  relinkGameRom,
  removeFriendEntry,
  removeGameFromLibrary,
  saveAutoState,
  saveEmbeddedPreferences,
  saveGameControlBindings,
  saveFriendEntry,
  saveGameMetadata,
  saveGameStateSlot,
  saveEmulatorProfile,
  saveProfileState,
  setGameCover,
  type PlatformId
} from './appState';

interface RuntimeInfo {
  appVersion: string;
  platform: NodeJS.Platform;
  isPackaged: boolean;
}

let mainWindow: BrowserWindow | null = null;
const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const USE_STATIC_RENDERER = app.isPackaged || process.argv.includes('--static');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const loadFailureScreen = async (window: BrowserWindow, message: string): Promise<void> => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Ошибка запуска Emusol</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #0b1020;
            color: #f7f8fc;
            font-family: "Segoe UI", sans-serif;
          }
          main {
            width: min(680px, 92vw);
            padding: 28px;
            border-radius: 24px;
            background: rgba(18, 24, 43, 0.94);
            border: 1px solid rgba(255, 255, 255, 0.12);
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
          }
          p, code {
            color: #aeb6cf;
            line-height: 1.6;
          }
          code {
            display: block;
            margin-top: 14px;
            padding: 12px;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.05);
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Интерфейс не запустился</h1>
          <p>Emusol не смог подключиться к dev-серверу Vite.</p>
          <p>Попробуйте перезапустить через <strong>cmd /c npm run dev:desktop</strong>.</p>
          <code>${message.replace(/[<>&]/g, '')}</code>
        </main>
      </body>
    </html>
  `;

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
};

const loadDevUrlWithRetry = async (window: BrowserWindow, retries = 40, delayMs = 500): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await window.loadURL(DEV_SERVER_URL);
      return;
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Неизвестная ошибка запуска интерфейса.';
  await loadFailureScreen(window, message);
};

const createMainWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1220,
    minHeight: 760,
    backgroundColor: '#0b1020',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  if (USE_STATIC_RENDERER) {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    await loadDevUrlWithRetry(mainWindow);
    if (!mainWindow.webContents.getURL().startsWith('data:text/html')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }
};

ipcMain.handle('app:get-runtime-info', (): RuntimeInfo => ({
  appVersion: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged
}));

ipcMain.handle('app:load-state', async () => loadAppState());

ipcMain.handle('profile:save', async (_, profile) => saveProfileState(profile));
ipcMain.handle('friends:save', async (_, friend) => saveFriendEntry(friend));
ipcMain.handle('friends:remove', async (_, friendId: string) => removeFriendEntry(friendId));
ipcMain.handle('embedded:save-preferences', async (_, platform: PlatformId, preferences) => saveEmbeddedPreferences(platform, preferences));
ipcMain.handle('game:save-control-bindings', async (_, gameId: string, bindings) => saveGameControlBindings(gameId, bindings));

ipcMain.handle('library:import-roms', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Импортировать ROM',
    properties: ['openFile', 'multiSelections'],
    filters: createRomDialogFilters()
  });

  if (result.canceled || result.filePaths.length === 0) {
    const state = await loadAppState();
    return {
      library: state.library,
      addedGameIds: [],
      duplicateFiles: [],
      unsupportedFiles: []
    };
  }

  return importRomFiles(result.filePaths);
});

ipcMain.handle('library:remove-game', async (_, gameId: string) => removeGameFromLibrary(gameId));

ipcMain.handle('library:set-cover', async (_, gameId: string, coverDataUrl?: string, source?: 'none' | 'auto' | 'manual') =>
  setGameCover(gameId, coverDataUrl, source)
);
ipcMain.handle('library:auto-cover', async (_, gameId: string) => fetchAndSetGameAutoCover(gameId));
ipcMain.handle('library:save-metadata', async (_, gameId: string, patch) => saveGameMetadata(gameId, patch));

ipcMain.handle('emulator:choose-executable', async (_, platform: PlatformId) => {
  const result = await dialog.showOpenDialog({
    title: `Выбрать эмулятор для ${platform}`,
    properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('emulator:save-profile', async (_, platform: PlatformId, profile) => saveEmulatorProfile(platform, profile));

ipcMain.handle('game:launch', async (_, gameId: string) => launchGame(gameId));
ipcMain.handle('game:prepare-embedded-launch', async (_, gameId: string) => prepareEmbeddedLaunch(gameId));
ipcMain.handle('game:relink-missing-rom', async (_, gameId: string) => {
  const state = await loadAppState();
  const game = state.library.find((item) => item.id === gameId);

  if (!game) {
    throw new Error('Игра не найдена.');
  }

  const result = await dialog.showOpenDialog({
    title: `Выберите ROM для ${game.title}`,
    defaultPath: game.romPath ? path.dirname(game.romPath) : undefined,
    properties: ['openFile'],
    filters: createRomDialogFiltersForPlatform(game.platform)
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return relinkGameRom(gameId, result.filePaths[0]);
});
ipcMain.handle('game:get-save-slots', async (_, gameId: string) => getGameSaveSlots(gameId));
ipcMain.handle('game:get-auto-save', async (_, gameId: string) => getAutoSaveSummary(gameId));
ipcMain.handle('game:save-state-slot', async (_, gameId: string, slot: number, stateBase64: string, thumbnailDataUrl?: string) =>
  saveGameStateSlot(gameId, slot, stateBase64, thumbnailDataUrl)
);
ipcMain.handle('game:load-state-slot', async (_, gameId: string, slot: number) => loadGameStateSlot(gameId, slot));
ipcMain.handle('game:save-auto-state', async (_, gameId: string, stateBase64: string, thumbnailDataUrl?: string) =>
  saveAutoState(gameId, stateBase64, thumbnailDataUrl)
);
ipcMain.handle('game:load-auto-state', async (_, gameId: string) => loadAutoState(gameId));
ipcMain.handle('window:minimize', async () => {
  mainWindow?.minimize();
});
ipcMain.handle('window:toggle-maximize', async () => {
  if (!mainWindow) {
    return false;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }

  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', async () => {
  mainWindow?.close();
});
ipcMain.handle('window:set-fullscreen', async (_, fullscreen: boolean) => {
  mainWindow?.setFullScreen(Boolean(fullscreen));
});

app.whenReady().then(async () => {
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Не удалось запустить Emusol:', message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
