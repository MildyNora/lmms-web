/*
 * web_stubs.c - what the web build's C library lacks for code it links but never runs
 *
 * Emscripten's C library without threads leaves out a few POSIX calls. Code linked into the
 * module that names one, but never runs where it matters, gets it here, as musl defines it.
 *
 * Part of lmms-web (https://github.com/MildyNora/lmms-web), LMMS for WebAssembly.
 * GPL-2.0-or-later, like LMMS.
 */

#include <semaphore.h>

#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)

/* ZynAddSubFX's WAV recorder (Nio's WavEngine) asks its semaphore for its value; the web build
 * never records (ZynAddSubFX plays through LMMS), and threadless Emscripten has no sem_getvalue */
int sem_getvalue(sem_t* restrict sem, int* restrict value)
{
	const int v = sem->__val[0];
	*value = v < 0 ? 0 : v;
	return 0;
}

#endif
