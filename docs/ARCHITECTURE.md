# Emusol Architecture

## Recommended stack

### Desktop

- Electron
- React
- TypeScript
- Vite
- Cross-platform desktop packaging with macOS support from day one

### Mobile

- Expo
- React Native
- TypeScript

### Backend services

- Node.js
- TypeScript
- WebSocket signaling
- REST endpoints for metadata and future cloud features

## Monorepo structure

- `apps/desktop`
- `apps/mobile`
- `packages/ui`
- `packages/shared`
- `services/signaling`

## Important architectural rule

Do not couple the UI directly to one emulator implementation.

Use an adapter layer:

- `EmulatorAdapter`
- `NetplayAdapter`
- `MetadataProvider`

## Emulator strategy

### Version 1 strategy

For version 1, prioritize one reliable local-emulation path for:

- NES
- SNES
- GB
- GBC
- GBA
- Sega Mega Drive

Instead:

- use a launcher-oriented architecture,
- embed local cores for the first platform batch,
- keep platform-specific preference profiles in shared app state,
- keep N64, GameCube, DS, and 3DS as later adapters,
- keep online outside the first delivery slice.

### Why

If we try to solve NES, SNES, GB, GBA, Mega Drive, N64, GameCube, DS, and 3DS in one engine immediately, the project will stall under integration complexity.

## Suggested package responsibilities

### `packages/shared`

- shared types
- zod schemas or equivalent validators later
- IPC contracts
- network payload contracts

### `packages/ui`

- color tokens
- theme tokens
- layout primitives
- reusable account, library, and friends components

### `services/signaling`

- auth-lite session identity
- friends
- invites
- room state
- online presence

### `apps/desktop`

- Switch-style shell UI
- local file system access
- emulator path settings
- cover cache
- desktop settings
- macOS and Windows packaging

### `apps/mobile`

- profile
- friends
- room presence
- library browsing
- future lightweight gameplay

## High-risk areas

- Perfect low-desync multiplayer across different emulator families.
- Uniform emulator integration across desktop and mobile.
- Game metadata quality and title matching.
- Input synchronization for non-deterministic systems.

## Practical technical principle

Design for:

- good local launcher first,
- reliable local emulation second,
- harder console support third,
- online after the local base is stable.
