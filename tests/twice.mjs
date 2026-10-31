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
	return { ms: Math.round(performance.now() - t0), bytes: wav.length, sha: createHash("sha256").update(wav).digest("hex") };
};
const r1 = render(a, 1), r2 = render(b, 2), r3 = render(a, 3);
console.log(JSON.stringify({ first: r1, other: r2, again: r3 }));
if (r1.sha !== r3.sha) { console.error("FAIL: the same project rendered differently the second time"); process.exit(1); }
if (r1.sha === r2.sha) { console.error("FAIL: two different projects rendered the same"); process.exit(1); }
console.log("OK");
