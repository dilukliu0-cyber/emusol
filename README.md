# Emusol

Emusol is a long-term project for a unified emulator hub with a Switch-inspired interface, local library management, social features, themes, and future online/mobile expansion.

## Product direction

- Desktop-first MVP.
- Switch-style launcher UI.
- Local emulation first.
- Single library for multiple systems.
- macOS build support from the start.
- Online and mobile after the local desktop base is stable.

## Realistic scope

This should not be built as "all consoles + perfect online + mobile" in one pass.

The practical path is:

1. Build the desktop launcher shell, profile system, game library, friends panel, themes, and cover pipeline.
2. Add local launch support for NES, SNES, GB, GBC, GBA, and Sega Mega Drive.
3. Add future platform adapters for N64, GameCube, DS, and 3DS.
4. Add online later when the local stack is stable.
5. Add mobile later when the shared product model is mature.

## Initial repo layout

- `apps/desktop` - Electron desktop shell and Switch-style launcher UI.
- `apps/mobile` - future Expo/React Native client.
- `packages/ui` - shared design tokens and reusable components.
- `packages/shared` - shared types, contracts, validation.
- `services/signaling` - lobby, friends, invites, room signaling.
- `docs` - product documents, roadmap, architecture, and master prompt.

## Current status

The repository now contains:

- planning and architecture baseline,
- MVP product decisions,
- a working Electron desktop app,
- built-in local emulation for NES, SNES, GB, GBC, GBA, and Mega Drive,
- built-in launch for N64 and DS,
- ROM import with persistence,
- auto and manual cover support,
- per-platform control/audio/video profiles,
- pause menu with save slots and autosave,
- signaling service with rooms, invites, ready-state, and the first experimental online play flow for NES, SNES, and Mega Drive,
- anti-desync MVP for that online path: ROM hash check, periodic state hash exchange, and guest resync from the host snapshot on mismatch.

Next step:

- extend online beyond the first Nostalgist-based systems and keep pushing platform parity for N64, GameCube, and 3DS.

## Run

Install dependencies once:

```bat
cd C:\Users\fedor\Desktop\Emusol
cmd /c npm install
```

Start the signaling service for online:

```bat
cd C:\Users\fedor\Desktop\Emusol
cmd /c npm run start:signaling
```

In a second terminal, start the desktop app:

```bat
cd C:\Users\fedor\Desktop\Emusol
cmd /c npm run preview:desktop
```
