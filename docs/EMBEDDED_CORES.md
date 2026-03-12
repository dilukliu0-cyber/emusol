# Embedded Cores

Emusol now bundles the first-wave emulator cores directly inside the desktop app.

Bundled base systems:

- `NES` -> `fceumm`
- `SNES` -> `snes9x`
- `GB / GBC / GBA` -> `mgba`
- `Mega Drive` -> `genesis_plus_gx`
- `N64` -> `parallel_n64`
- `DS` -> `desmume`

Current asset source:

- upstream package runtime: `nostalgist@0.21.0`
- core asset source used by Nostalgist: `arianrhodsandlot/retroarch-emscripten-build`
- pinned asset version: `v1.22.2`

Bundled files for Nostalgist:

- `fceumm_libretro.js`
- `fceumm_libretro.wasm`
- `snes9x_libretro.js`
- `snes9x_libretro.wasm`
- `mgba_libretro.js`
- `mgba_libretro.wasm`
- `genesis_plus_gx_libretro.js`
- `genesis_plus_gx_libretro.wasm`

Bundled files for EmulatorJS:

- `parallel_n64-*.data`
- `desmume-*.data`

Notes:

- First version now runs these systems inside the Emusol window, without external emulator executables.
- `N64` and `DS` already run through EmulatorJS inside Emusol.
- On March 11, 2026, the npm registry did not expose an official EmulatorJS `3DS` core package, so Emusol currently uses a native external `3DS` launcher path instead of an in-window runtime.
- `GameCube` and full `3DS` runtime remain future work.
- Before public distribution, audit the exact licenses and redistribution requirements of each bundled core.
