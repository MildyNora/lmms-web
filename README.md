# lmms-web

[LMMS](https://lmms.io), the free digital audio workstation, compiled to WebAssembly so a browser can render LMMS projects
itself. It is the in-browser engine of [Musical](https://musical.sh): the studio's mixes, instruments and effects run on the
listener's own computer, with the server as the fallback.

What it does today: LMMS's headless renderer (`lmms render <project> -o <file.wav>`) as an Emscripten module, with the
instruments TripleOscillator, AudioFileProcessor (samples and DrumSynth sounds), Kicker, BitInvader, FreeBoy, LB302, Monstro,
Nescaline, OpulenZ, Organic, Sf2Player (SoundFont 2 and 3, on FluidSynth 2.6.1), SID, Vibed, Watsyn, Xpressive and
ZynAddSubFX, LMMS's everyday effects and the LADSPA effects its presets use (CMT, CAPS, Calf, TAP, SWH). An `.mmp` project and
the files it uses go into the module's virtual file system, a WAV comes out. It runs in a page, a Web Worker or Node, and a
render nulls against LMMS's own release rendering the same project (see Tests). Progress, run links, sizes and timings are in
[PROGRESS.md](PROGRESS.md).

## Using it

The build makes two files, `lmms.js` (an ES module that loads the other) and `lmms.wasm` (28 MB, about 10 MB gzipped).
Each [release](https://github.com/MildyNora/lmms-web/releases) has both, as CI built and tested them, with `SHA256SUMS`.

```js
import createLmms from "./lmms.js";

const lmms = await createLmms();          // in a Worker: everything below stays off the page's thread
lmms.ccall("lmms_init", "number", [], []); // optional: start the engine before the first render

lmms.FS.mkdir("/work");
lmms.FS.writeFile("/work/song.mmp", projectText);  // and any samples it names, at the paths it names
const rc = lmms.ccall("lmms_render", "number",
	["string", "string", "number", "number"],
	["/work/song.mmp", "/work/song.wav", 44100, 1]); // sample rate, 1 = 32-bit float (0 = 16-bit)
if (rc === 0) {
	const wav = lmms.FS.readFile("/work/song.wav");   // Uint8Array
}
```

`lmms_render` returns 0 when the WAV was written, 1 for bad arguments, 2 when the project can't be loaded or is empty, 3 when
no audio came out. The engine starts on the first render and stays up, so later renders skip its setup, and each render starts
LMMS's random numbers where a fresh process's stand: a render doesn't depend on what the module rendered before.
`lmms_version()` gives the LMMS version it was built from. `callMain(["render", "song.mmp", "-o", "song.wav", "-a"])` takes
LMMS's own command line too.

The module carries LMMS's wavetables but not its samples, presets or a soundfont: a project's files go where it names them
(LMMS looks for its own under `/lmms/data/`, e.g. `/lmms/data/samples/drums/kick01.ogg`). A soundfont can be cut down to the
presets a project plays with [tools/sf-subset.py](tools/sf-subset.py), which copies them as they are (FluidSynth renders the
cut soundfont bit for bit as the whole one), or split into one soundfont per preset, so a page downloads only what it plays.

## How it's built

Everything is built by GitHub Actions ([.github/workflows/build.yml](.github/workflows/build.yml)) on Ubuntu; nothing needs
building locally.

1. **Toolchain**: Emscripten 3.1.56 and Qt 6.8.3 for WebAssembly (single-threaded), with the host Qt its tools (moc, rcc,
   uic) come from, installed with aqtinstall. Qt 6.8 is built with, and documents, that Emscripten version.
2. **Libraries** ([scripts/build-deps.sh](scripts/build-deps.sh)): what LMMS needs, cross-compiled with emcmake/emconfigure
   into a cached prefix, each download checked by SHA-256.
3. **LMMS** ([scripts/fetch-lmms.sh](scripts/fetch-lmms.sh)): the `v1.3.0-alpha.2` tag with its submodules, with the patches
   in [patches/](patches/) applied, configured by [scripts/configure-lmms.sh](scripts/configure-lmms.sh) with every optional
   backend and plugin family off except the ones the web build adds back.
4. **The module** ([web/](web/)): LMMS's core and the plugins built for it linked into one Emscripten module (modularized ES
   module; web, worker and node; file system and memory growth on) whose entry point,
   [web/lmms_web_main.cpp](web/lmms_web_main.cpp), does what LMMS's command-line render does.
5. **Tests** ([tests/](tests/)): projects written by Musical's engine are rendered under Node and by LMMS's own release
   (its Linux AppImage, checksum-verified, in a Debian bookworm container, with FluidSynth 2.6.1 under it), and the two renders
   are nulled ([tests/compare.mjs](tests/compare.mjs)): [tests/musical.mmp](tests/musical.mmp) (sample tracks through every
   effect Musical uses) and [tests/instruments.mmp](tests/instruments.mmp) (each instrument in turn, compared one at a time).
   [tests/twice.mjs](tests/twice.mjs) renders several projects in one module and holds a project to the same samples before
   and after the others. A version tag publishes the module as a release.

### What the patches change

LMMS loads its plugins as shared libraries and renders on threads; a web page has neither. The patches (against LMMS
v1.3.0-alpha.2, kept as patch files rather than a fork) make an Emscripten build of it:

- [0001-web-build.patch](patches/0001-web-build.patch): CMake for Emscripten (`LMMS_BUILD_WEB`): plugins as static
  libraries with their entry point named after them, the web module's target added after the plugins, no install rules or
  tests, no remote plugins (they need a second process).
- [0002-static-plugins.patch](patches/0002-static-plugins.patch): `PluginFactory` and `LadspaManager` take the plugins and
  LADSPA libraries from a registry compiled into the module (generated by `web/CMakeLists.txt`) instead of `QLibrary`.
- [0003-single-threaded-render.patch](patches/0003-single-threaded-render.patch): the audio engine with zero worker threads, the
  project renderer's work run inline rather than on its `QThread`, the dummy audio device without its thread, the wavetables
  generated serially.
- [0004-web-platform.patch](patches/0004-web-platform.patch): what a page can't do (start other programs, share memory with
  them) is left out.
- [0005-static-ladspa.patch](patches/0005-static-ladspa.patch): the LADSPA libraries LMMS bundles (CMT, CAPS, TAP, SWH,
  Calf) as static libraries for the module.
- [0006-wasm32.patch](patches/0006-wasm32.patch): wasm32 is a 32-bit target with LMMS's 64-bit frame count; two layout
  checks that assume a 64-bit target are skipped there.
- [0007-zynaddsubfx-local.patch](patches/0007-zynaddsubfx-local.patch): ZynAddSubFX runs in LMMS's own process
  (LocalZynAddSubFx), as it does elsewhere while its window is closed: no FLTK window and no separate process.
- [0008-xpressive-no-exceptions.patch](patches/0008-xpressive-no-exceptions.patch): Xpressive without `-fexceptions`, as
  everything else here is built.
- [0009-organic-own-oscillator.patch](patches/0009-organic-own-oscillator.patch): Organic's `OscillatorObject` under a name of
  its own (TripleOscillator has one too, and every plugin links into one module here).
- [0010-fastrand-seed.patch](patches/0010-fastrand-seed.patch): `fastRand()`'s state where the module can set it again before
  each render.

## License

LMMS is free software under the GNU General Public License, version 2 or later; so is everything here (see [LICENSE](LICENSE)).
LMMS is the work of the LMMS developers: https://github.com/LMMS/lmms. This repository only builds it for the web.

The module also contains Qt (used under the GPL), libsndfile (LGPL-2.1-or-later) with libogg, libvorbis, FLAC and Opus
(BSD-3-Clause), FFTW (GPL-2.0-or-later), libsamplerate (BSD-2-Clause), FluidSynth (LGPL-2.1-or-later), zlib (Zlib) and the
plugins' own libraries that LMMS bundles, each under its own license; Emscripten's runtime is under the MIT and University of
Illinois/NCSA licenses.
