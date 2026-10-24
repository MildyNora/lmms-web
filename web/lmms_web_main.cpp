/*
 * lmms_web_main.cpp - the web build's entry point: LMMS's command-line render, headless
 *
 * Does what LMMS's main() does for `lmms render <project> -o <file>`: load the project,
 * render it with a RenderManager to a WAV file, return. No GUI and no threads: in this
 * build the render runs inline (patches/0003), so the call returns once the file is
 * written. Paths are in Emscripten's virtual file system.
 *
 * The engine starts on the first render and stays up, so later renders skip its setup
 * (wavetables, plugin discovery).
 *
 * Part of lmms-web (https://github.com/MildyNora/lmms-web), LMMS for WebAssembly.
 * LMMS is the work of the LMMS developers (https://lmms.io).
 *
 * This program is free software; you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software Foundation;
 * either version 2 of the License, or (at your option) any later version.
 */

#include <QCoreApplication>
#include <QFile>
#include <QFileInfo>
#include <QString>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "ConfigManager.h"
#include "Engine.h"
#include "Hardware.h"
#include "NotePlayHandle.h"
#include "OutputSettings.h"
#include "ProjectRenderer.h"
#include "RenderManager.h"
#include "Song.h"
#include "lmmsversion.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define LMMS_WEB_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define LMMS_WEB_EXPORT extern "C"
#endif

using namespace lmms;

namespace
{

int s_argc = 1;
char s_arg0[] = "lmms";
char* s_argv[] = {s_arg0, nullptr};

bool s_engineUp = false;

//! What LMMS's main() sets up before it renders, done once for the module's lifetime
void startEngine()
{
	if (s_engineUp) { return; }

	// LMMS's own files (wavetables, presets, samples) are looked for here unless the
	// page says otherwise (ENV.LMMS_DATA_DIR before the first render)
	setenv("LMMS_DATA_DIR", "/lmms/data/", 0);

	if (!QCoreApplication::instance()) { new QCoreApplication(s_argc, s_argv); }
	NotePlayHandleManager::init();
	disableDenormals();
	ConfigManager::inst()->loadConfigFile(QString{});
	Engine::init(true);
	s_engineUp = true;
}

} // namespace


//! The LMMS version this module was built from, e.g. "1.3.0-alpha.2"
LMMS_WEB_EXPORT const char* lmms_version()
{
	return LMMS_VERSION;
}


//! Render an LMMS project (.mmp or .mmpz) to a WAV file.
//! sampleRate: 44100 to 192000, or 0 for 44100. floatOutput: 32-bit float samples when
//! nonzero, else 16-bit. Returns 0 when the file was written; 1 for bad arguments, 2 when
//! the project can't be loaded or is empty, 3 when no file came out.
LMMS_WEB_EXPORT int lmms_render(const char* projectPath, const char* outputPath, int sampleRate, int floatOutput)
{
	if (!projectPath || !outputPath || !*projectPath || !*outputPath) { return 1; }
	if (sampleRate == 0) { sampleRate = 44100; }
	if (sampleRate < 44100 || sampleRate > 192000)
	{
		std::fprintf(stderr, "Invalid sample rate %d\n", sampleRate);
		return 1;
	}

	const auto project = QString::fromUtf8(projectPath);
	const auto output = QString::fromUtf8(outputPath);
	if (!QFileInfo(project).isFile())
	{
		std::fprintf(stderr, "No project file %s\n", projectPath);
		return 2;
	}

	startEngine();

	std::printf("Loading project...\n");
	Song* song = Engine::getSong();
	song->loadProject(project);
	if (song->isEmpty())
	{
		std::fprintf(stderr, "The project %s is empty, aborting!\n", projectPath);
		return 2;
	}
	std::printf("Done\n");
	song->setExportLoop(false);

	const auto depth = floatOutput ? OutputSettings::BitDepth::Depth32Bit : OutputSettings::BitDepth::Depth16Bit;
	const auto settings = OutputSettings(static_cast<sample_rate_t>(sampleRate), 160, depth,
		OutputSettings::StereoMode::Stereo);

	QFile::remove(output);
	{
		RenderManager renderer(settings, ProjectRenderer::ExportFileFormat::Wave, output);
		renderer.renderProject(); // inline here: returns when the whole song is rendered
	} // the WAV is finished when the renderer gives back the audio device
	QCoreApplication::sendPostedEvents();

	if (QFileInfo(output).size() <= 44)
	{
		std::fprintf(stderr, "Rendering %s produced no audio\n", projectPath);
		return 3;
	}
	std::printf("Rendered %s to %s\n", projectPath, outputPath);
	return 0;
}


//! As LMMS's command line: lmms render <project> [-o <file.wav>] [-s <rate>] [-a]
int main(int argc, char** argv)
{
	std::string project, output;
	int rate = 44100;
	bool asFloat = false;
	for (int i = 1; i < argc; ++i)
	{
		const std::string arg = argv[i];
		if ((arg == "render" || arg == "--render" || arg == "-r") && i + 1 < argc) { project = argv[++i]; }
		else if ((arg == "--output" || arg == "-o") && i + 1 < argc) { output = argv[++i]; }
		else if ((arg == "--samplerate" || arg == "-s") && i + 1 < argc) { rate = std::atoi(argv[++i]); }
		else if (arg == "--float" || arg == "-a") { asFloat = true; }
		else if (arg == "--version" || arg == "-v") { std::printf("LMMS %s (web)\n", LMMS_VERSION); return 0; }
		else if (project.empty() && arg[0] != '-') { project = arg; }
		else
		{
			std::fprintf(stderr, "Usage: lmms render <project> [-o <file.wav>] [-s <samplerate>] [-a]\n");
			return 1;
		}
	}
	if (project.empty()) { return 0; }
	if (output.empty())
	{
		const auto dot = project.find_last_of('.');
		output = (dot == std::string::npos ? project : project.substr(0, dot)) + ".wav";
	}
	return lmms_render(project.c_str(), output.c_str(), rate, asFloat ? 1 : 0);
}
