// Compares two float WAV renders of the same project, the web build's against native LMMS's: their lengths, the lag between
// them (if any, within 64 samples), and how deep the difference nulls, overall and second by second (0 dB: nothing alike;
// below about -60 dB: the same sound for any ear; native against native nulls completely).
//
//   node tests/compare.mjs <native.wav> <web.wav> [<fail above dB>] [--segments <file.json>]
//
// --segments names stretches of the song ({"segments": [{"name", "from_s", "to_s"}]}, an instrument each in
// tests/instruments.json), and the table is then one row per stretch. Prints a JSON summary and a table for the job summary. Fails only when a file isn't a stereo float WAV, either render is
// silent, the lengths differ by more than a quarter of a second, or (when given) the overall null is above the limit.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const segAt = args.indexOf("--segments");
const segments = segAt >= 0 ? JSON.parse(readFileSync(args.splice(segAt, 2)[1], "utf8")).segments : null;
const [nativePath, webPath, limitArg] = args;
if (!nativePath || !webPath) { console.error("usage: node tests/compare.mjs <native.wav> <web.wav> [<fail above dB>]"); process.exit(2); }
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

function read(path) {
	const wav = readFileSync(path);
	if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") fail(`${path}: not a RIFF/WAVE file`);
	let fmt = null, data = null;
	for (let at = 12; at + 8 <= wav.length;) {
		const id = wav.toString("ascii", at, at + 4), size = wav.readUInt32LE(at + 4);
		if (id === "fmt ") fmt = { at: at + 8, size };
		if (id === "data") data = { at: at + 8, size: Math.min(size, wav.length - at - 8) };
		at += 8 + size + (size & 1);
	}
	if (!fmt || !data) fail(`${path}: no fmt or data chunk`);
	let format = wav.readUInt16LE(fmt.at);
	const channels = wav.readUInt16LE(fmt.at + 2), rate = wav.readUInt32LE(fmt.at + 4), bits = wav.readUInt16LE(fmt.at + 14);
	if (format === 0xfffe && fmt.size >= 26) format = wav.readUInt16LE(fmt.at + 24);
	if (format !== 3 || bits !== 32 || channels !== 2) fail(`${path}: expected stereo 32-bit float, got format ${format}, ${bits} bits, ${channels} channels`);
	const frames = Math.floor(data.size / 8), l = new Float32Array(frames), r = new Float32Array(frames);
	for (let i = 0; i < frames; i++) { l[i] = wav.readFloatLE(data.at + 8 * i); r[i] = wav.readFloatLE(data.at + 8 * i + 4); }
	return { rate, frames, l, r };
}

const a = read(nativePath), b = read(webPath);
if (a.rate !== b.rate) fail(`sample rates differ: ${a.rate} and ${b.rate}`);
const rms = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
if (rms(a.l) + rms(a.r) < 1e-4) fail("the native render is silent");
if (rms(b.l) + rms(b.r) < 1e-4) fail("the web render is silent");
const seconds = (x) => x.frames / x.rate;
if (Math.abs(seconds(a) - seconds(b)) > 0.25) fail(`lengths differ: ${seconds(a).toFixed(3)} s and ${seconds(b).toFixed(3)} s`);

// the lag: the shift of b within ±64 samples that best matches a over the loudest second
const n = Math.min(a.frames, b.frames);
let loud = 0, loudAt = 0;
for (let s = 0; s + a.rate <= n; s += a.rate) { const v = rms(a.l, s, s + a.rate); if (v > loud) { loud = v; loudAt = s; } }
let lag = 0, best = Infinity;
for (let k = -64; k <= 64; k++) {
	let e = 0;
	for (let i = loudAt + 64; i < Math.min(n - 64, loudAt + a.rate); i++) { const d = a.l[i] - b.l[i + k]; e += d * d; }
	if (e < best) { best = e; lag = k; }
}
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const QUIET = 1e-5;   // a stretch of the native render under -100 dB RMS: too quiet to say how alike they are (any difference is huge beside it)
function nullDb(from, to) {
	let d = 0, ref = 0;
	for (let i = Math.max(from, 64); i < Math.min(to, n - 64); i++) {
		for (const [x, y] of [[a.l, b.l], [a.r, b.r]]) { const e = x[i] - y[i + lag]; d += e * e; ref += x[i] * x[i]; }
	}
	const frames = Math.max(1, Math.min(to, n - 64) - Math.max(from, 64));
	if (ref <= 0 || Math.sqrt(ref / (2 * frames)) < QUIET) return null;
	return Number(db(Math.sqrt(d / ref)).toFixed(1));
}
const overall = nullDb(0, n);
const perSecond = [];
for (let s = 0; s < n; s += a.rate) perSecond.push(nullDb(s, Math.min(n, s + a.rate)));
const perSegment = segments && segments.map((s) => ({ name: s.name, null_db: nullDb(Math.round(s.from_s * a.rate), Math.round(s.to_s * a.rate)),
	native_rms_db: Number(db(rms(a.l, Math.round(s.from_s * a.rate), Math.min(n, Math.round(s.to_s * a.rate)))).toFixed(1)),
	web_rms_db: Number(db(rms(b.l, Math.round(s.from_s * a.rate), Math.min(n, Math.round(s.to_s * a.rate)))).toFixed(1)) }));
const summary = { native_seconds: Number(seconds(a).toFixed(3)), web_seconds: Number(seconds(b).toFixed(3)), lag_samples: lag, null_db: overall,
	...(perSegment ? { per_segment: perSegment } : { per_second_db: perSecond }) };
console.log(JSON.stringify(summary));
if (perSegment) {
	console.log("| part | null (dB) | native level (dB) | web level (dB) |\n| --- | --- | --- | --- |");
	for (const s of perSegment) console.log(`| ${s.name} | ${s.null_db ?? "quiet"} | ${s.native_rms_db} | ${s.web_rms_db} |`);
} else {
	console.log(`| second | ${perSecond.map((_, i) => i + 1).join(" | ")} |\n| --- | ${perSecond.map(() => "---").join(" | ")} |\n| null (dB) | ${perSecond.map((v) => (v == null ? "quiet" : v)).join(" | ")} |`);
}
if (limitArg !== undefined && overall != null && overall > Number(limitArg)) fail(`the renders differ: null ${overall} dB, above ${limitArg} dB`);
console.log("OK");
