// One module, several renders: a page keeps the module loaded and renders song after song in it, so a render must not depend on
// what was rendered before. Renders project A, then B, then A again in the same module and checks the two renders of A are the
// same sample for sample (and that B's wasn't A's).
//
//   node tests/twice.mjs <lmms.js> <a.mmp> <b.mmp> [<file to include>...]   (files as in render.mjs: <file> or <file>=<path>)

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, a, b, ...extraFiles] = process.argv.slice(2);
if (!modulePath || !a || !b) {
	console.error("usage: node tests/twice.mjs <lmms.js> <a.mmp> <b.mmp> [files...]");
	process.exit(2);
}
const { default: createLmms } = await import(pathToFileURL(resolve(modulePath)).href);
const lmms = await createLmms({ print: () => {}, printErr: () => {} });
const mkdirs = (p) => { let at = ""; for (const part of p.split("/").filter(Boolean)) { at += `/${part}`; try { lmms.FS.mkdir(at); } catch { /* there */ } } };
for (const arg of extraFiles) {
	const [file, to] = arg.includes("=") ? arg.split("=", 2) : [arg, resolve(arg)];
	mkdirs(dirname(to));
	lmms.FS.writeFile(to, readFileSync(file));
}
mkdirs("/work");
lmms.ccall("lmms_init", "number", [], []);
const render = (project, n) => {
	const at = `/work/p${n}.mmp`;
	lmms.FS.writeFile(at, readFileSync(project));
	const t0 = performance.now();
	const rc = lmms.ccall("lmms_render", "number", ["string", "string", "number", "number"], [at, `/work/out${n}.wav`, 44100, 1]);
	if (rc !== 0) { console.error(`FAIL: render ${n} returned ${rc}`); process.exit(1); }
	const wav = lmms.FS.readFile(`/work/out${n}.wav`);
	return { ms: Math.round(performance.now() - t0), bytes: wav.length, sha: createHash("sha256").update(wav).digest("hex"), wav };
};
// where two float renders differ: the first frame that does, the largest difference, and how deep they null in all and second by second
function differ(a, b) {
	const data = (w) => { const v = new DataView(w.buffer, w.byteOffset, w.byteLength); let at = 12; while (at + 8 <= w.length) { const id = String.fromCharCode(...w.subarray(at, at + 4)), n = v.getUint32(at + 4, true); if (id === "data") return new Float32Array(w.buffer.slice(w.byteOffset + at + 8, w.byteOffset + at + 8 + n)); at += 8 + n + (n & 1); } return new Float32Array(0); };
	const x = data(a), y = data(b), n = Math.min(x.length, y.length);
	let first = -1, most = 0, d = 0, r = 0;
	const perSecond = [];
	let sd = 0, sr = 0;
	for (let i = 0; i < n; i++) {
		const e = x[i] - y[i];
		if (e !== 0 && first < 0) first = i;
		most = Math.max(most, Math.abs(e)); d += e * e; r += x[i] * x[i]; sd += e * e; sr += x[i] * x[i];
		if ((i + 1) % (44100 * 2) === 0 || i === n - 1) { perSecond.push(sr > 0 ? Number((10 * Math.log10(sd / sr || 1e-30)).toFixed(1)) : null); sd = 0; sr = 0; }
	}
	return { first_frame: first < 0 ? null : Math.floor(first / 2), max_abs: Number(most.toPrecision(3)), null_db: r > 0 ? Number((10 * Math.log10(d / r || 1e-30)).toFixed(1)) : null, per_second_db: perSecond };
}
const r1 = render(a, 1), r2 = render(b, 2), r3 = render(a, 3);
const strip = ({ wav, ...r }) => r;
console.log(JSON.stringify({ first: strip(r1), other: strip(r2), again: strip(r3) }));
if (r1.sha !== r3.sha) { console.error(`FAIL: the same project rendered differently the second time: ${JSON.stringify(differ(r1.wav, r3.wav))}`); process.exit(1); }
if (r1.sha === r2.sha) { console.error("FAIL: two different projects rendered the same"); process.exit(1); }
console.log("OK");
