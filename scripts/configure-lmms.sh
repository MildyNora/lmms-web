#!/usr/bin/env bash
# Configure LMMS for WebAssembly with Qt for WebAssembly's CMake wrapper (qt-cmake),
# Emscripten underneath, the cross-compiled libraries, and the web module's target.
#
#   scripts/configure-lmms.sh <lmms source> <build directory>
#
# Environment: QT_WASM (Qt for WebAssembly, single-threaded), QT_HOST (the host Qt its
# tools come from), DEPS (scripts/build-deps.sh's prefix), emsdk's environment.
# PLUGINS overrides the plugins built (LMMS's PLUGIN_LIST).
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC=$(realpath "${1:?usage: configure-lmms.sh <lmms source> <build directory>}")
BUILD=$(realpath -m "${2:?usage: configure-lmms.sh <lmms source> <build directory>}")
shift 2
: "${QT_WASM:?}" "${QT_HOST:?}" "${DEPS:?}"

PLUGINS=${PLUGINS:-"TripleOscillator AudioFileProcessor Kicker Amplifier Compressor Delay Eq Flanger StereoMatrix WaveShaper LadspaEffect"}
# The LADSPA libraries Musical's projects use (its effects: CMT's filters, delays and reverb, CAPS's chorus, Calf's phaser and
# filter, TAP's stereo echo, SWH's amplifier, decimator and limiter); the others come later as plugins loaded on their own
LADSPA=${LADSPA:-"cmt caps veal tap_echo amp_1181 decimator_1202 fast_lookahead_limiter_1913"}

# Only the cross-compiled libraries' pkg-config files, never the host's
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig"
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig"

# Every optional backend and plugin family off; the web build adds them back one by one
OFF=(ALSA OSS JACK WEAKJACK PULSEAUDIO PORTAUDIO SNDIO SOUNDIO SDL CARLA LV2 SUIL VST VST_32 VST_64
	GIG STK MP3LAME OGGVORBIS SF2 SID)
WANTS=()
for want in "${OFF[@]}"; do WANTS+=("-DWANT_$want=OFF"); done

# (qt-cmake comes out of Qt's archives without its executable bit)
sh "$QT_WASM/bin/qt-cmake" -S "$SRC" -B "$BUILD" -G Ninja \
	-DCMAKE_BUILD_TYPE=Release \
	-DQT_HOST_PATH="$QT_HOST" \
	-DQT_HOST_PATH_CMAKE_DIR="$QT_HOST/lib/cmake" \
	-DCMAKE_PREFIX_PATH="$DEPS" \
	-DCMAKE_FIND_ROOT_PATH="$DEPS" \
	-DWANT_QT6=ON \
	"${WANTS[@]}" \
	-DPLUGIN_LIST="$PLUGINS" \
	-DLMMS_WEB_LADSPA="$LADSPA" \
	-DLMMS_WEB_DIR="$HERE/web" \
	-DUSE_COMPILE_CACHE=ON \
	-DSndFile_VERSION=1.2.2 \
	-DSamplerate_VERSION=0.2.2 \
	"$@"
