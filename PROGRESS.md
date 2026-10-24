# Progress

LMMS v1.3.0-alpha.2 for WebAssembly, built by GitHub Actions. Newest first within each milestone.

## Milestones

| | Milestone | State |
| --- | --- | --- |
| M1 | Toolchain and libraries in CI (Emscripten 3.1.56, Qt 6.8.3 for WebAssembly single-threaded + host Qt, libsndfile, FFTW, libsamplerate), cached | done |
| M2 | Configure LMMS (Qt 6, every optional backend and plugin family off) | done |
| M3 | Compile and link for the web (static plugins with a compiled-in registry, no threads, headless entry point) | done: LMMS's core, its GUI code and 10 plugins compile and link into `lmms.js` + `lmms.wasm` |
| M4 | It renders: a TripleOscillator project under Node, checked | in progress: the module loads under Node; the engine's start hung in FFTW's planner (fixed in the libraries' build, being checked) |
| M5 | Sample tracks and Musical's effects (native and LADSPA), a project shaped like Musical's | prepared: LADSPA libraries as static libraries (patches/0005), FLAC/Ogg/Vorbis/Opus for libsndfile, the test project (tests/musical.mmp) |
| M6 | Sf2Player (FluidSynth), ZynAddSubFX, the other instruments; plugins loaded separately | not started |

## Where things stand

- **Toolchain (M1)**: emsdk 3.1.56 (`mymindstorm/setup-emsdk`, cached), Qt 6.8.3 `wasm_singlethread` and `linux_gcc_64` from
  aqtinstall 3.3.0 (only qtbase, qtsvg and the host's ICU), cached. Qt for WebAssembly 6.8.3 is built without threads, without
  wasm exceptions (so its targets add `-sDISABLE_EXCEPTION_CATCHING=1`), without SIMD, without QProcess and system semaphores.
  The libraries (libsamplerate 0.2.2, libsndfile 1.2.2, FFTW 3.3.10 single precision) build in about four minutes the first time
  and come from the cache after that. Emscripten's own library cache and ccache are kept between runs too.
- **Configure (M2)**: `scripts/configure-lmms.sh`, through Qt's `qt-cmake`, with `WANT_QT6=ON` and every `WANT_*` off.
- **Compile and link (M3)**: the core (`lmmsobjs`, which includes the GUI code), TripleOscillator, AudioFileProcessor, Kicker,
  Amplifier, Compressor, Delay, Eq, Flanger, StereoMatrix and WaveShaper compile; with ccache warm a rebuild takes a few minutes.
  `lmms.wasm` is 19.2 MB and `lmms.js` 267 KB before any size work (no compression, the GUI code still in).
- **Render (M4)**: the module instantiates under Node in about 90 ms and answers `lmms_version()`. `lmms_init()` (the engine's
  start) didn't return: V8's profile of the stuck run shows FFTW measuring plans for the oscillators' wavetables forever.
  FFTW's configure finds a "cycle counter" under Emscripten that WebAssembly doesn't have, so `FFTW_MEASURE` (what LMMS asks
  for) never gets a usable timing. The libraries' build now takes the counter away, so FFTW plans by its estimates, as it
  does on any platform without one.

## Runs

- https://github.com/MildyNora/lmms-web/actions — every push to `main` builds.

## Next

1. Find what the engine's start waits on under Node, fix it, get the TripleOscillator render checked (M4).
2. M5: LADSPA libraries (CMT, CAPS, Calf, TAP, SWH), FLAC sample clips, the Musical-shaped project, and a null test against
   native LMMS (the release's AppImage renders the same projects in CI).
3. Size: leave out the GUI code and Qt's platform/image plugins the headless module doesn't use.

## Blockers

None.
