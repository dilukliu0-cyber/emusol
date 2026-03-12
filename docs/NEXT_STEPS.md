# Emusol Next Steps

## Immediate next implementation step

Use the new native `3DS` launch path now, and switch to a true built-in `3DS` runtime only after a real browser-capable core exists.

## Recommended order

1. Run practical QA on `N64` with real ROMs and deepen controller profiles beyond the first gamepad path.
2. Extend the online MVP beyond rooms/invites and the first `Nostalgist` relay path.
3. Keep using the native `3DS` launch slot from Emusol for real play.
4. As soon as a real `3DS` browser core exists, replace the native path with boot inside the Emusol window, pause menu integration, saves, and dual-screen layout.
5. Prepare the heavier-platform strategy for `GameCube`.
6. Add screenshots and richer media in the metadata layer.

## Practical engineering choice

Keep the current version 1 systems stable and self-contained inside the app while `3DS` is playable through a native launcher and honestly blocked from an in-window runtime by the missing core. Build online out in layers: signaling first, then platform-specific input sync and desync control.

That keeps:

- the MVP playable,
- the UI honest,
- and future platform expansion cleaner.
