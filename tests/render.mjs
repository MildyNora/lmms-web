// Renders an LMMS project with the web build under Node and checks the WAV that comes out.
//
//   node tests/render.mjs <lmms.js> <project.mmp> <out.wav> <expected seconds> [<file to include>...]
//
// A file to include goes at the same absolute path in the module's file system, or, given as
// <file>=<path>, at that path (a soundfont cut down to the presets a project uses, LMMS's
// samples where the module's LMMS looks for them, /lmms/data/samples/...).
//
// The project (and the files it uses)
// goes into Emscripten's in-memory file system, lmms_render() turns it into a float WAV
// there, and the WAV is copied out and checked: RIFF/WAVE, stereo float at 44.1 kHz,
// about the expected length, finite samples, not silent. Prints the timings as JSON.
//
// tests/tripleoscillator.mmp is one TripleOscillator track (a C major arpeggio and chord
// over two bars at 120 BPM) written by hand in the shape Musical's engine writes
// (cue_engine/lmms.py); LMMS renders to the end of the last bar plus one: 6 seconds.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, projectPath, outPath, expectArg, ...extraFiles] = process.argv.slice(2);
if (!modulePath || !projectPath || !outPath || !expectArg) {
	console.error("usage: node tests/render.mjs <lmms.js> <project.mmp> <out.wav> <expected seconds> [files...]");
	process.exit(2);
}
const expected = Number(expectArg);

function fail(message) {
	console.error(`FAIL: ${message}`);
	process.exit(1);
}

function mkdirs(FS, path) {
	let at = "";
	for (const part of path.split("/").filter(Boolean)) {
		at += `/${part}`;
		try { FS.mkdir(at); } catch { /* exists */ }
	}
}

const t0 = performance.now();
const { default: createLmms } = await import(pathToFileURL(resolve(modulePath)).href);
const lmms = await createLmms({
	print: (text) => console.log(text),
	printErr: (text) => console.error(text),
});
const t1 = performance.now();
console.log(`LMMS ${lmms.ccall("lmms_version", "string", [], [])} (web) ready in ${Math.round(t1 - t0)} ms`);

const project = `/work/${projectPath.split("/").pop()}`;
mkdirs(lmms.FS, "/work");
lmms.FS.writeFile(project, readFileSync(projectPath));
for (const arg of extraFiles) {
	const [file, to] = arg.includes("=") ? arg.split("=", 2) : [arg, resolve(arg)];
	mkdirs(lmms.FS, dirname(to));
	lmms.FS.writeFile(to, readFileSync(file));
}

const tInit = performance.now();
lmms.ccall("lmms_init", "number", [], []);
const engine_ms = Math.round(performance.now() - tInit);
console.log(`Engine up in ${engine_ms} ms`);

const output = "/work/out.wav";
const t2 = performance.now();
const rc = lmms.ccall("lmms_render", "number", ["string", "string", "number", "number"], [project, output, 44100, 1]);
const t3 = performance.now();
if (rc !== 0) fail(`lmms_render returned ${rc}`);

const wav = Buffer.from(lmms.FS.readFile(output));
writeFileSync(outPath, wav);

// RIFF/WAVE: find the fmt and data chunks
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") fail("not a RIFF/WAVE file");
let fmt = null;
let data = null;
for (let at = 12; at + 8 <= wav.length;) {
	const id = wav.toString("ascii", at, at + 4);
	const size = wav.readUInt32LE(at + 4);
	if (id === "fmt ") fmt = { at: at + 8, size };
	if (id === "data") data = { at: at + 8, size: Math.min(size, wav.length - at - 8) };
	at += 8 + size + (size & 1);
}
if (!fmt || !data) fail("no fmt or data chunk");
let format = wav.readUInt16LE(fmt.at);
const channels = wav.readUInt16LE(fmt.at + 2);
const rate = wav.readUInt32LE(fmt.at + 4);
const bits = wav.readUInt16LE(fmt.at + 14);
if (format === 0xfffe && fmt.size >= 26) format = wav.readUInt16LE(fmt.at + 24); // WAVE_FORMAT_EXTENSIBLE
if (format !== 3 || bits !== 32) fail(`expected 32-bit float samples, got format ${format} with ${bits} bits`);
if (channels !== 2) fail(`expected stereo, got ${channels} channels`);
if (rate !== 44100) fail(`expected 44100 Hz, got ${rate}`);

const frames = Math.floor(data.size / (4 * channels));
const seconds = frames / rate;
let peak = 0;
let sum = 0;
let finite = true;
for (let i = 0; i < frames * channels; i++) {
	const v = wav.readFloatLE(data.at + 4 * i);
	if (!Number.isFinite(v)) { finite = false; break; }
	peak = Math.max(peak, Math.abs(v));
	sum += v * v;
}
const rms = Math.sqrt(sum / Math.max(1, frames * channels));
const result = {
	module_ready_ms: Math.round(t1 - t0),
	engine_init_ms: engine_ms,
	render_ms: Math.round(t3 - t2),
	seconds: Number(seconds.toFixed(3)),
	expected_seconds: expected,
	peak: Number(peak.toFixed(4)),
	rms: Number(rms.toFixed(4)),
	bytes: wav.length,
};
console.log(JSON.stringify(result));
if (!finite) fail("the samples aren't all finite");
if (Math.abs(seconds - expected) > 0.25) fail(`expected about ${expected} s, got ${seconds.toFixed(3)} s`);
if (peak < 0.01 || rms < 0.001) fail(`the render is silent (peak ${peak}, rms ${rms})`);
console.log("OK");
