#!/usr/bin/env bash
# Cross-compile the libraries LMMS needs for WebAssembly into a prefix, with Emscripten.
#
#   scripts/build-deps.sh <prefix>
#
# Needs emsdk's environment (emcc, emcmake, emconfigure on PATH), cmake, ninja, curl.
# Every download is checked against its SHA-256.
#
#   libsamplerate 0.2.2   BSD-2-Clause        CMake
#   libsndfile 1.2.2      LGPL-2.1-or-later   CMake, its built-in formats only (WAV, AIFF, ...)
#   FFTW 3.3.10           GPL-2.0-or-later    autotools, single precision (libfftw3f)
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

echo "::group::libsndfile"
fetch https://github.com/libsndfile/libsndfile/releases/download/1.2.2/libsndfile-1.2.2.tar.xz \
	3799ca9924d3125038880367bf1468e53a1b7e3686a934f098b7e1d286cdb80e
cmake_lib "$WORK/libsndfile-1.2.2" sndfile \
	-DBUILD_PROGRAMS=OFF \
	-DBUILD_EXAMPLES=OFF \
	-DBUILD_TESTING=OFF \
	-DBUILD_REGTEST=OFF \
	-DENABLE_EXTERNAL_LIBS=OFF \
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

echo "Installed into $PREFIX:"
find "$PREFIX" -name '*.a' -o -name '*.pc' | sort
