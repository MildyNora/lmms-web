# lmms-web

[LMMS](https://lmms.io), the free digital audio workstation, compiled to WebAssembly so a browser can render LMMS projects
itself. It is the in-browser engine of [Musical](https://musical.sh): the studio's mixes, instruments and effects run on the
listener's own computer, with the server as the fallback.

Status: work in progress. The first goal is LMMS's headless renderer (an `.mmp` project and its files in, a WAV out) running
in a Web Worker; then each instrument and effect as a plugin the page loads the first time a project needs it.

## How it's built

GitHub Actions does the build (`.github/workflows/build.yml`): Emscripten, Qt 6 for WebAssembly, LMMS's libraries (libsndfile,
FFTW, libsamplerate) cross-compiled, then LMMS itself with the patches in `patches/`. The built files are the workflow's
artifacts.

## License

LMMS is free software under the GNU General Public License, version 2 or later; so is everything here (see `LICENSE`).
LMMS is the work of the LMMS developers: https://github.com/LMMS/lmms. This repository only builds it for the web.
