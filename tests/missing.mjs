// A song that names what this build doesn't have (an instrument, an effect) or that LMMS can't load whole (a sample that isn't
// there): LMMS would render it with a silence in its place, so lmms_render refuses it (4) and says what, and a page's studio has
// the song mixed elsewhere. The same project unchanged renders (0).
//
//   node tests/missing.mjs <lmms.js> tests/tripleoscillator.mmp
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, projectPath] = process.argv.slice(2);
const base = readFileSync(projectPath, "utf8");
const effect = `<fxchain numofeffects="1" enabled="1"><effect name="nosucheffect" on="1" wet="1" autoquit="1" gate="0"><nosucheffectcontrols/></effect></fxchain>`;
const sample = `<track type="2" name="Missing sample" muted="0" solo="0"><sampletrack vol="100" pan="0"/><sampleclip pos="0" len="192" src="/work/nothing-here.wav" muted="0" off="0"/></track>\n    </trackcontainer>`;
const cases = [
	["the project as it is", base, 0, null],
	["an instrument this build doesn't have", base.replace('<instrument name="tripleoscillator"', '<instrument name="vestige"'), 4, "vestige"],
	["an effect this build doesn't have", base.replace('<fxchain numofeffects="0" enabled="0"/>', effect), 4, "nosucheffect"],
	["a sample that isn't there", base.replace("</trackcontainer>", sample), 4, "nothing-here.wav"],
];
const { default: createLmms } = await import(pathToFileURL(resolve(modulePath)).href);
let failed = 0;
for (const [label, text, want, says] of cases) {
	const errs = [];
	const lmms = await createLmms({ print: () => {}, printErr: (t) => errs.push(t) });   // a fresh module each, as a page's render has
	lmms.ccall("lmms_init", "number", [], []);
	try { lmms.FS.mkdir("/work"); } catch { /* there */ }
	lmms.FS.writeFile("/work/song.mmp", text);
	const rc = lmms.ccall("lmms_render", "number", ["string", "string", "number", "number"], ["/work/song.mmp", "/work/out.wav", 44100, 1]);
	const said = errs.filter((t) => /^Not (in this build|loaded whole)/.test(t)).join(" | ");
	const ok = rc === want && (!says || said.includes(says));
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${rc}${said ? ` (${said})` : ""}`);
}
process.exit(failed ? 1 : 0);
