#!/usr/bin/env bash
# Cross-compile the libraries LMMS needs for WebAssembly into a prefix, with Emscripten.
#
#   scripts/build-deps.sh <prefix>
#
# Needs emsdk's environment (emcc, emcmake, emconfigure on PATH), cmake, ninja, curl.
# Every download is checked against its SHA-256.
#
#   libsamplerate 0.2.2   BSD-2-Clause        CMake
#   libogg 1.3.5          BSD-3-Clause        CMake
#   libvorbis 1.3.7       BSD-3-Clause        CMake
#   FLAC 1.4.3            BSD-3-Clause        CMake, the C library only
#   Opus 1.5.2            BSD-3-Clause        CMake, without intrinsics
#   libsndfile 1.2.2      LGPL-2.1-or-later   CMake, with FLAC, Ogg Vorbis and Opus (sample tracks play FLAC)
#   FFTW 3.3.10           GPL-2.0-or-later    autotools, single precision (libfftw3f)
#   zlib 1.3.1            Zlib                its configure, the static library (ZynAddSubFX reads compressed banks)
#   FluidSynth 2.6.1      LGPL-2.1-or-later   CMake, the library with libsndfile (SF3 soundfonts), no threads or drivers
set -euo pipefail

PREFIX=$(realpath -m "${1:?usage: build-deps.sh <prefix>}")
WORK=$(realpath -m "${WORK:-${RUNNER_TEMP:-/tmp}/lmms-web-deps}")
JOBS=${JOBS:-$(nproc)}
mkdir -p "$PREFIX" "$WORK"

fetch() { # <url> <sha256> -> unpacked source directory on stdout
	local url=$1 sum=$2 file="$WORK/${1##*/}"
	if [ ! -f "$file" ]; then curl -fsSL --retry 3 -o "$file" "$url"; fi
	echo "$sum  $file" | sha256sum -c - >&2
	tar -xf "$file" -C "$WORK"
}

cmake_lib() { # <source dir> <name> <cmake args...>
	local src=$1 name=$2
	shift 2
	emcmake cmake -S "$src" -B "$WORK/build-$name" -G Ninja \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_INSTALL_PREFIX="$PREFIX" \
		-DBUILD_SHARED_LIBS=OFF \
		-DCMAKE_PREFIX_PATH="$PREFIX" \
		-DCMAKE_FIND_ROOT_PATH="$PREFIX" \
		"$@"
	cmake --build "$WORK/build-$name" -j "$JOBS"
	cmake --install "$WORK/build-$name"
}

echo "::group::libsamplerate"
fetch https://github.com/libsndfile/libsamplerate/releases/download/0.2.2/libsamplerate-0.2.2.tar.xz \
	3258da280511d24b49d6b08615bbe824d0cacc9842b0e4caf11c52cf2b043893
cmake_lib "$WORK/libsamplerate-0.2.2" samplerate \
	-DBUILD_TESTING=OFF \
	-DLIBSAMPLERATE_EXAMPLES=OFF \
	-DLIBSAMPLERATE_INSTALL=ON
echo "::endgroup::"

echo "::group::libogg"
fetch https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.xz \
	c4d91be36fc8e54deae7575241e03f4211eb102afb3fc0775fbbc1b740016705
cmake_lib "$WORK/libogg-1.3.5" ogg \
	-DINSTALL_DOCS=OFF \
	-DBUILD_TESTING=OFF
echo "::endgroup::"

echo "::group::libvorbis"
fetch https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz \
	b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b
cmake_lib "$WORK/libvorbis-1.3.7" vorbis
echo "::endgroup::"

echo "::group::FLAC"
fetch https://downloads.xiph.org/releases/flac/flac-1.4.3.tar.xz \
	6c58e69cd22348f441b861092b825e591d0b822e106de6eb0ee4d05d27205b70
cmake_lib "$WORK/flac-1.4.3" flac \
	-DBUILD_CXXLIBS=OFF \
	-DBUILD_PROGRAMS=OFF \
	-DBUILD_EXAMPLES=OFF \
	-DBUILD_TESTING=OFF \
	-DBUILD_DOCS=OFF \
	-DINSTALL_MANPAGES=OFF \
	-DWITH_OGG=ON \
	-DWITH_STACK_PROTECTOR=OFF
echo "::endgroup::"

echo "::group::Opus"
fetch https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz \
	65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
cmake_lib "$WORK/opus-1.5.2" opus \
	-DOPUS_BUILD_PROGRAMS=OFF \
	-DOPUS_BUILD_TESTING=OFF \
	-DOPUS_STACK_PROTECTOR=OFF \
	-DOPUS_DISABLE_INTRINSICS=ON \
	-DOPUS_INSTALL_PKG_CONFIG_MODULE=ON \
	-DOPUS_INSTALL_CMAKE_CONFIG_MODULE=ON
echo "::endgroup::"

echo "::group::libsndfile"
fetch https://github.com/libsndfile/libsndfile/releases/download/1.2.2/libsndfile-1.2.2.tar.xz \
	3799ca9924d3125038880367bf1468e53a1b7e3686a934f098b7e1d286cdb80e
cmake_lib "$WORK/libsndfile-1.2.2" sndfile \
	-DBUILD_PROGRAMS=OFF \
	-DBUILD_EXAMPLES=OFF \
	-DBUILD_TESTING=OFF \
	-DBUILD_REGTEST=OFF \
	-DENABLE_EXTERNAL_LIBS=ON \
	-DENABLE_MPEG=OFF \
	-DENABLE_CPACK=OFF \
	-DENABLE_PACKAGE_CONFIG=ON \
	-DINSTALL_PKGCONFIG_MODULE=ON \
	-DINSTALL_MANPAGES=OFF
echo "::endgroup::"

echo "::group::FFTW (single precision)"
fetch https://www.fftw.org/fftw-3.3.10.tar.gz \
	56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467
(
	cd "$WORK/fftw-3.3.10"
	# WebAssembly has no cycle counter, yet configure's check of kernel/cycle.h finds one
	# for Emscripten, and FFTW's measuring planner then never finishes (FFTW_MEASURE, which
	# LMMS asks for). Without one FFTW plans by its estimates, as on any platform lacking a
	# counter: FFTW_MEASURE acts as FFTW_ESTIMATE.
	sed -i 's|^#  include "cycle.h"$|&\n#  ifdef __EMSCRIPTEN__\n#    undef HAVE_TICK_COUNTER\n#  endif|' kernel/timer.c
	grep -q "undef HAVE_TICK_COUNTER" kernel/timer.c
	emconfigure ./configure \
		--prefix="$PREFIX" \
		--enable-float \
		--enable-static \
		--disable-shared \
		--disable-fortran \
		--disable-threads \
		--disable-openmp \
		--disable-mpi \
		--disable-doc \
		CFLAGS="-O3"
	emmake make -j "$JOBS"
	emmake make install
)
echo "::endgroup::"

echo "::group::zlib"
fetch https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.xz \
	38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32
(
	cd "$WORK/zlib-1.3.1"
	emconfigure ./configure --prefix="$PREFIX" --static
	emmake make -j "$JOBS" libz.a
	emmake make install
)
echo "::endgroup::"

echo "::group::FluidSynth"
# The library only, as LMMS's Sf2Player uses it: libsndfile decodes SF3's compressed samples; no
# audio or MIDI drivers, no threads (the web build renders on one), no OpenMP, no network.
# GCEM, a header library it needs, is downloaded by its own CMake module and checked there.
fetch https://github.com/FluidSynth/fluidsynth/archive/refs/tags/v2.6.1.tar.gz \
	3d258a3bf97cc20c59eeebfe62c2432fae88adda74d3ad098681c76e0ebf446b
# A thread asking for real-time priority (pthread_setschedparam, which Emscripten has only with
# threads) just doesn't get it: this build never starts one
sed -i -e 's|^#include "fluid_sys.h"$|&\n#ifdef __EMSCRIPTEN__\n#define FLUID_WEB_SETSCHEDPARAM(thread, policy, param) (-1)\n#else\n#define FLUID_WEB_SETSCHEDPARAM pthread_setschedparam\n#endif|' \
	-e 's|if(pthread_setschedparam(pthread_self(), SCHED_FIFO, &priority) == 0)|if(FLUID_WEB_SETSCHEDPARAM(pthread_self(), SCHED_FIFO, \&priority) == 0)|' \
	"$WORK/fluidsynth-2.6.1/src/utils/fluid_sys.c"
[ "$(grep -c FLUID_WEB_SETSCHEDPARAM "$WORK/fluidsynth-2.6.1/src/utils/fluid_sys.c")" = 3 ]
# (its command-line program links libsndfile, whose codecs its CMake files don't name)
cmake_lib "$WORK/fluidsynth-2.6.1" fluidsynth \
	-DCMAKE_EXE_LINKER_FLAGS="-L$PREFIX/lib -lvorbisenc -lvorbis -logg -lFLAC -lopus" \
	-Dosal=cpp11 \
	-Denable-threads=OFF \
	-Denable-openmp=OFF \
	-Denable-libsndfile=ON \
	-Denable-alsa=OFF -Denable-aufile=OFF -Denable-dbus=OFF -Denable-ipv6=OFF -Denable-jack=OFF \
	-Denable-ladspa=OFF -Denable-midishare=OFF -Denable-network=OFF -Denable-oss=OFF -Denable-sdl3=OFF \
	-Denable-pulseaudio=OFF -Denable-pipewire=OFF -Denable-readline=OFF -Denable-systemd=OFF \
	-Denable-portaudio=OFF -Denable-opensles=OFF -Denable-oboe=OFF \
	-Denable-native-dls=OFF \
	-Denable-signalsmith=OFF
echo "::endgroup::"

echo "Installed into $PREFIX:"
find "$PREFIX" -name '*.a' -o -name '*.pc' | sort
