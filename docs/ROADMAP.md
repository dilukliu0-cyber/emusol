# Emusol Roadmap

## Phase 0: Foundation

- Define product scope and architecture.
- Create monorepo structure.
- Define shared types and service boundaries.
- Decide emulator integration strategy per platform.

## Phase 1: Desktop launcher MVP

- Electron desktop shell.
- Switch-style layout and visual system.
- Profile card with avatar, name, status.
- Game library list with search and platform labels.
- Collapsible friends panel.
- Selected game detail hero area.
- Dark and light theme.
- Experimental accent color selection.
- Local persistence for profile, library, settings.
- macOS-ready packaging configuration.
- Frameless game window and custom window controls.

## Phase 2: Local emulation MVP

- NES local support.
- SNES local support.
- GB / GBC / GBA local support.
- Sega Mega Drive local support.
- One adapter strategy for the first supported group.
- In-game pause menu on `Esc`.
- Save slots and autosave.
- Per-platform control, audio, and video profiles.

## Phase 3: Metadata and cover pipeline

- Metadata service abstraction.
- Auto cover fetch for selected game.
- Manual cover replacement.
- Local image cache.
- Validation and fallback states.

## Phase 4: Emulator adapter expansion

- Adapter contract for supported systems.
- Local launch integration for MVP systems.
- Platform validation before launch.
- N64 adapter preparation.
- GameCube adapter preparation.
- DS adapter preparation.
- 3DS adapter preparation.

## Phase 5: Social and rooms

- Signaling service.
- Friends list and presence.
- Invites.
- Room create and join.
- Party state and room status.

## Phase 6: Netplay for MVP systems

- ROM hash verification.
- Emulator version verification.
- Lockstep session management for deterministic systems.
- Desync detection and logging.

## Phase 7: Mobile

- Shared account and social flow.
- Mobile-friendly UI.
- Companion mode first.
- Native gameplay later for feasible systems.
