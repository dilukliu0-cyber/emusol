# Emusol Product Requirements

## 1. Product vision

Emusol is a unified application for launching retro and console games from one interface with a Switch-inspired layout, social layer, local-first emulation, cover art, profiles, theming, and future cross-platform support.

The product should feel like:

- a personal game launcher,
- a social gaming hub,
- an emulator manager,
- and later a cross-device experience.

## 2. Core UX requirements

### Main layout

- Left top: account block.
- Below account: user's game library.
- Below library: collapsible friends section.
- Right side: selected game details with large cover art.
- The visual language should feel closer to Nintendo Switch than Steam.
- Online controls can be deferred until after the local desktop base is stable.

### Profile

- Change display name.
- Upload or replace avatar.
- Friend code or account identity.
- Online and offline status.
- White theme.
- Dark theme.
- Experimental custom accent color support.

### Library

- Add game manually.
- Group by platform.
- Search and filter.
- Track play time.
- Track last played date.
- Show installed status and ROM path validity.
- Store local cover if manual override is used.

### Game details page

- Large hero cover.
- Game title and platform.
- Short metadata panel.
- Local play button.
- Online play button.
- Invite friend button.
- System requirements or emulator mapping info.

## 3. Platform support target

### Version 1 platforms

- NES
- SNES
- Game Boy
- Game Boy Color
- Game Boy Advance
- Sega Genesis / Mega Drive

### Phase 2 platforms

- Nintendo 64
- Nintendo DS
- GameCube

### Phase 3 platforms

- Nintendo 3DS

## 4. Online play requirements

### User expectation

User should be able to create or join a party, invite a friend, and play together with minimal desync.

### Engineering reality

Different systems require different multiplayer strategies:

- Deterministic systems can use lockstep or rollback-like synchronized input.
- Some cores are better integrated through RetroArch netplay.
- Complex systems like GameCube, DS, and 3DS may require emulator-specific integration or host-authoritative streaming.

### Deferred online scope

These stay in the architecture, but do not block version 1:

- Friends list.
- Presence.
- Invite flow.
- Party room.
- ROM hash verification.
- Core and emulator version verification.
- Input delay setting.
- Ping indicator.
- Reconnect and room recovery flow.

### Anti-desync requirements

- Same ROM hash check.
- Same emulator/core version check.
- Same region check when possible.
- State hash comparison on interval.
- Session logs for debugging desync.

## 5. Cover and metadata requirements

- Auto-fetch cover art from configured metadata providers.
- Cache covers locally.
- Allow manual replacement.
- Keep local fallback if online metadata fails.
- Later support screenshots, descriptions, genre, and release year.

## 6. Theme requirements

- Dark theme.
- Light theme.
- User-chosen accent color.
- Shared design tokens for desktop and mobile.

## 7. Future mobile support

Mobile should be planned from the start, but does not belong to version 1.

### Mobile goals

- Account access.
- Library browsing.
- Friends and invites.
- Remote session presence.
- Later: direct gameplay for supported platforms only.

### Mobile constraints

- GameCube, 3DS, and some DS flows may not be realistic for equal support on all phones.
- The mobile app should initially focus on companion and lighter systems.

## 8. Non-functional requirements

- Desktop-first performance.
- macOS build support from the first desktop package.
- Clean project structure.
- Reusable shared contracts between desktop, mobile, and backend.
- No ROM bundling.
- Clear separation between launcher UI, emulator adapters, and online services.
- Logging for multiplayer issues.

## 9. Out-of-scope for first milestone

- Full support for every requested system.
- Perfect mobile parity.
- Advanced achievements ecosystem.
- Marketplace or cloud sync of ROM files.
- Automatic emulator binary downloads without a controlled flow.

## 10. First milestone definition

The first milestone is successful when:

- a desktop app opens,
- profile block exists,
- library exists,
- friends section is collapsible,
- selected game details are shown on the right,
- the visual style follows a Switch-like direction,
- theme switching works,
- covers can be added automatically and manually,
- built-in local emulation works for the version 1 systems,
- pause menu on `Esc` supports controls, audio, video, and save slots,
- autosave works on exit,
- platform-specific preferences are persisted,
- and the desktop package is prepared for macOS builds.
