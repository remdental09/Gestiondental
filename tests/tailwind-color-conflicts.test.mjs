import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// En Tailwind v4 dos utilidades que fijan la misma propiedad (bg-white + bg-[#473a6d]) no se resuelven por el orden
// del atributo class sino por el del CSS compilado. Así quedaron botones blancos sobre blanco (#353 y «Terminar» del
// dictado periodontal). Se revisan los className de components/ y app/ (los de components/ui usan cn/twMerge).
const root = new URL("..", import.meta.url).pathname;
const files = dir => readdirSync(join(root, dir)).flatMap(name => { const path = join(dir, name); return statSync(join(root, path)).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : []; });
const COLOR = "(?:white|black|transparent|current|\\[#[0-9a-fA-F]{3,8}\\]|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3})(?:/\\d+)?";
const groups = { fondo: new RegExp(`^bg-${COLOR}$`), texto: new RegExp(`^text-${COLOR}$`), borde: new RegExp(`^border-${COLOR}$`) };
function conflicts(classes) {
  const seen = new Map(), out = [];
  for (const token of classes) {
    const parts = token.split(":"), util = parts.pop().replace(/^!/, ""), variant = parts.join(":");
    for (const [group, rx] of Object.entries(groups)) if (rx.test(util)) {
      const key = `${variant}|${group}`;
      if (seen.has(key) && seen.get(key) !== util) out.push(`${variant ? variant + ":" : ""}${seen.get(key)} / ${util}`);
      seen.set(key, util);
    }
  }
  return out;
}
const literals = text => [...text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)].map(m => (m[1] ?? m[2]).split(/\s+/).filter(Boolean));
function product(options) { return options.reduce((acc, choices) => acc.flatMap(a => choices.map(c => [...a, ...c])), [[]]); }

test("ningún className mezcla dos colores de fondo, texto o borde (misma variante)", () => {
  const problems = [];
  for (const file of [...files("components"), ...files("app")]) {
    if (file.startsWith("components/ui/")) continue;
    const src = readFileSync(join(root, file), "utf8");
    const consts = new Map([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*"([^"]*)"\s*;/g)].map(m => [m[1], m[2].split(/\s+/).filter(Boolean)]));
    const multi = new Map([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*([^;\n]*\?[^;\n]*);/g)].map(m => [m[1], literals(m[2])]).filter(([, l]) => l.length));
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      if (m[1] !== undefined) { const c = conflicts(m[1].split(/\s+/)); if (c.length) problems.push(`${file}:${line} ${c.join(", ")}`); continue; }
      const base = m[2].replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean), options = [];
      for (const [, expr] of m[2].matchAll(/\$\{([^}]*)\}/g)) {
        const e = expr.trim();
        if (consts.has(e)) { base.push(...consts.get(e)); continue; }
        const ids = [...e.matchAll(/\b(\w+)\b/g)].map(x => x[1]);
        const choices = [...literals(e), ...ids.filter(i => consts.has(i)).map(i => consts.get(i)), ...ids.filter(i => multi.has(i)).flatMap(i => multi.get(i))];
        if (choices.length) options.push(e.includes("&&") ? [...choices, []] : choices);
      }
      for (const combo of product(options)) { const c = conflicts([...base, ...combo]); if (c.length) { problems.push(`${file}:${line} ${c.join(", ")}`); break; } }
    }
  }
  assert.deepEqual(problems, []);
});

test("el detector sí encuentra el caso de #353", () => {
  assert.ok(conflicts("border-[#473a6d] bg-white text-[#473a6d] border-transparent bg-[#473a6d] text-white".split(" ")).length === 3);
  assert.deepEqual(conflicts("bg-white hover:bg-[#f3f1f7] text-sm text-[#473a6d]".split(" ")), []);
});
