# Emusol Master Prompt

Use this as the base project prompt for future iterations.

## Product prompt

Build `Emusol`, a desktop-first unified emulator hub with a Switch-inspired interface and future mobile support.

### Product goals

- One app for multiple emulator systems.
- Switch-inspired layout.
- Social features with friends, invites, parties, and online sessions.
- Automatic cover art and metadata.
- Profile customization with avatar, display name, themes, and custom accent color.
- Future cross-platform support for iOS and Android.

### Layout requirements

- Left column top: account card with avatar, display name, online status, theme controls.
- Left column middle: user's games list with search, filters, platform tags, and installed status.
- Left column bottom: collapsible friends section with online presence and invite actions.
- Right side: selected game page with large cover, title, metadata, and local play controls.
- The visual tone should feel closer to Nintendo Switch than Steam.

### Platform scope

Start with:

- NES
- SNES
- GB
- GBC
- GBA
- Sega Genesis / Mega Drive

Later add:

- N64
- GameCube
- DS
- 3DS

### Technical constraints

- Desktop first, Windows first.
- Must be buildable for macOS from the beginning.
- Architecture must be extensible for mobile later.
- Use clean separation between UI, emulator adapters, metadata providers, and online services.
- Do not bundle ROMs.
- Do not promise netplay for every platform at MVP stage.
- Online can be deferred until after the local emulation MVP.

### Online requirements

- Friends system.
- Presence.
- Invite to party.
- Room creation and joining.
- ROM hash verification.
- Emulator/core version verification.
- Desync detection and logs.

### UX direction

- Switch-inspired, but not a clone.
- Strong visual hierarchy.
- Good dark and light themes.
- Optional user-selected accent color.
- Desktop and mobile-friendly design tokens from the start.

### Engineering direction

- Monorepo.
- Electron + React + TypeScript for desktop.
- Expo React Native for mobile.
- Node.js + WebSocket signaling service.
- Shared packages for contracts and UI tokens.

### Delivery approach

Implement in phases:

1. Monorepo and architecture.
2. Desktop launcher shell.
3. Profile, themes, library, and friends UI.
4. Local emulation support for NES, SNES, GB, GBC, GBA, and Mega Drive.
5. Cover and metadata pipeline.
6. Expand harder systems.
7. Signaling and rooms.
8. Netplay for MVP systems.
9. Mobile companion and then gameplay where feasible.

## Project rule

Whenever scope is unclear, choose the path that preserves architecture quality and ships a working local desktop slice first.

