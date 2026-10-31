# Progress

LMMS v1.3.0-alpha.2 for WebAssembly, built by GitHub Actions. Newest first within each milestone.

## Milestones

| | Milestone | State |
| --- | --- | --- |
| M1 | Toolchain and libraries in CI (Emscripten 3.1.56, Qt 6.8.3 for WebAssembly single-threaded + host Qt, libsndfile, FFTW, libsamplerate), cached | done |
| M2 | Configure LMMS (Qt 6, every optional backend and plugin family off) | done |
| M3 | Compile and link for the web (static plugins with a compiled-in registry, no threads, headless entry point) | done: LMMS's core, its GUI code and 10 plugins compile and link into `lmms.js` + `lmms.wasm` |
| M4 | It renders: a TripleOscillator project under Node, checked | done: 6.0 s of audio in 100 ms (module ready in 89 ms, engine up in 312 ms) |
| M5 | Sample tracks and Musical's effects (native and LADSPA), a project shaped like Musical's | in progress: FLAC/Ogg/Vorbis/Opus for libsndfile, LadspaEffect with CMT, CAPS, Calf, TAP's echo and SWH's amplifier, decimator and limiter linked in, tests/musical.mmp rendered on the web and by native LMMS and compared |
| M6 | Every instrument Musical's projects use: Sf2Player (FluidSynth), ZynAddSubFX, BitInvader, FreeBoy, LB302, Monstro, Nescaline, OpulenZ, Organic, SID, Vibed, Watsyn, Xpressive | in progress: FluidSynth 2.6.1 and zlib 1.3.1 built, ZynAddSubFX in LMMS's own process (patches/0007), Xpressive without exception catching (patches/0008), tests/instruments.mmp compared with native one instrument at a time |
| M7 | A page's engine: several renders in one loaded module, the soundfont cut into per-preset downloads (tools/sf-subset.py), releases a page pins | in progress |

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
- **Render (M4)**: done. The engine's start had hung in FFTW's planner (Emscripten reports a cycle counter WebAssembly doesn't
  have, so `FFTW_MEASURE` never got a timing); the libraries' build takes the counter away and FFTW plans by its estimates.
  The TripleOscillator project renders 6.0 s of stereo float audio in about 100 ms under Node.
- **Musical's projects (M5)**: `tests/musical.mmp` was written by Musical's engine as it writes every LMMS project: two sample
  tracks of synthetic audio (sines and noise, `tests/assets`), every effect type the engine maps to LMMS (native: amplifier,
  compressor, delay, EQ, stereo matrix, waveshaper; LADSPA: CMT, CAPS, Calf, TAP's stereo echo, SWH's decimator and limiter).
  CI renders it on the web and with LMMS's own release (the Linux AppImage, checksum-verified) and nulls the two
  (`tests/compare.mjs`).

- **Instruments (M6)**: `tests/instruments.mmp` was written by Musical's engine: twenty tracks, each instrument in turn for two
  bars (LMMS presets at Musical's levels, two ZynAddSubFX bank instruments, one of them PADsynth, three soundfont presets on
  Sf2Player, an LMMS sample and a DrumSynth sound on AudioFileProcessor, FreeBoy at its defaults). The web render gets the
  soundfont cut to its three presets by `tools/sf-subset.py`, which copies presets as they are: FluidSynth renders a cut
  soundfont bit for bit as the whole one. The reference runs in a Debian bookworm container as Musical's server runs LMMS.
- **Pages (M7)**: `tests/twice.mjs` renders A, B, then A again in one module (a page keeps it loaded); a version tag publishes the
  tested `lmms.js` and `lmms.wasm` as a release with `SHA256SUMS`.
  Each render starts LMMS's random numbers where they stand once the engine is up (patches/0010, `fastRandSeed`), as a fresh
  process renders: DrumSynth's noise and many oscillators' random phases come from them. Without that, a second render in one
  module differed from the first by -10 dB; starting them from 1 instead made every instrument drift from LMMS's own renders.
  DrumSynth's working state and ZynAddSubFX's random numbers go back to a new process's too (patches/0011): DrumSynth keeps
  envelopes, filters and phases in globals that carried over from one render's sounds into the next.

## Runs

- https://github.com/MildyNora/lmms-web/actions — every push to `main` builds.

## Next

1. M5: get Musical's test project rendering on the web and nulling against native LMMS.
2. M6: Sf2Player (FluidSynth for WebAssembly) with the soundfont split into per-instrument packages loaded when a project
   needs them; ZynAddSubFX as the first plugin loaded on its own (an Emscripten side module); the other instruments.
3. Size: leave out the GUI code and Qt's platform/image plugins the headless module doesn't use.

## Blockers

None.
