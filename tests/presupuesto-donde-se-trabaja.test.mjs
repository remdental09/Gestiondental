import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chileToFdiTooth, fdiToChile, parseTeethInput, teethHintsFromLabel } from "../lib/tooth-numbering.ts";
import { itemWhereText, normalizeBudgetItems } from "../lib/budget-plans.ts";
import { zoneOptions, zoneTeeth } from "../lib/treatment-zones.ts";

test("FDI ↔ chilena: 3.6 = Chile 30, 4.6 = Chile 19 (no la Universal), temporales con letra", () => {
  assert.equal(fdiToChile(36), "30");
  assert.equal(fdiToChile(46), "19");
  assert.equal(fdiToChile(18), "1");
  assert.equal(fdiToChile(28), "16");
  assert.equal(fdiToChile(53), "C");
  for (let n = 1; n <= 32; n++) assert.equal(fdiToChile(chileToFdiTooth(n)), String(n), `Chile ${n} ida y vuelta`);
  assert.equal(chileToFdiTooth("H"), 63);
  assert.equal(chileToFdiTooth(33), null);
});

test("las piezas se escriben en FDI o en chilena según lo elegido", () => {
  assert.deepEqual(parseTeethInput("1.4, 1.5 y 36", "fdi"), [14, 15, 36]);
  assert.deepEqual(parseTeethInput("5, 4, 30", "chile"), [14, 15, 36]);
  assert.deepEqual(parseTeethInput("C H", "chile"), [53, 63]);
  assert.deepEqual(parseTeethInput("99 0", "fdi"), []);
});

test("un nombre como «implante 14 15 y 12» es ambiguo: se ofrecen las dos lecturas", () => {
  const hints = teethHintsFromLabel("implante 14 15 y 12");
  assert.deepEqual(hints.fdi, [12, 14, 15]);
  assert.deepEqual(hints.chile, [24, 26, 27], "Chile 12, 14, 15 = FDI 2.4, 2.6, 2.7");
  assert.deepEqual(teethHintsFromLabel("Corona 3.6").chile, [], "con punto es FDI sin duda");
  assert.deepEqual(teethHintsFromLabel("Destartraje -10%"), { fdi: [], chile: [] });
});

test("dónde se trabaja: boca completa, sextante, grupo, boca parcial con piezas y detalle libre", () => {
  assert.equal(itemWhereText({ label: "Destartraje", amount: 1, zone: "perm:boca" }), "Boca completa");
  assert.equal(itemWhereText({ label: "Pulido", amount: 1, zone: "perm:sext-2", teeth: zoneTeeth("perm:sext-2") }), "Sextante 2 · Superior anterior · 1.3–2.3");
  assert.equal(itemWhereText({ label: "Carillas", amount: 1, zone: "perm:ant-sup" }), "Anteriores superiores · 1.3–2.3");
  assert.equal(itemWhereText({ label: "Raspado", amount: 1, zone: "perm:parcial", teeth: [16, 26], area: "sitios con sacos > 4 mm" }), "Boca parcial — Piezas 1.6, 2.6 · Chile 3, 14 — sitios con sacos > 4 mm");
  assert.equal(itemWhereText({ label: "Implantes", amount: 1, teeth: [12, 14, 15] }), "Piezas 1.2, 1.4, 1.5 · Chile 7, 5, 4");
  assert.equal(itemWhereText({ label: "Control", amount: 1 }), "");
});

test("el plan guarda el detalle libre y la boca parcial conserva las piezas que indicó el dentista", () => {
  const [item] = normalizeBudgetItems([{ label: "Raspado", amount: 100, zone: "perm:parcial", teeth: [16, 26], area: "  sitios   con sacos  " }]);
  assert.deepEqual(item.teeth, [16, 26]);
  assert.equal(item.area, "sitios con sacos");
  const [fixed] = normalizeBudgetItems([{ label: "Destartraje", amount: 100, zone: "perm:boca", teeth: [11] }]);
  assert.equal(fixed.teeth.length, 32, "una zona fija manda sobre piezas sueltas");
  assert.ok(zoneOptions("perm").some(o => o.key === "molares") && zoneOptions("temp").some(o => o.key === "molares"));
});

test("editar un plan o crear su alternativa no borra piezas, zona, código ni detalle", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /setBudgetItems\(budget\.items\.map\(item=>\(\{\.\.\.item,phase:/, "editar conserva todo, incluida la fecha de realizada");
  assert.match(page, /budget\.items\.map\(\(\{doneOn:_done,\.\.\.item\}\)=>\(\{\.\.\.item,/, "la alternativa conserva todo menos «realizada»");
  const plan = readFileSync(new URL("../components/budget-plan.tsx", import.meta.url), "utf8");
  assert.match(plan, /<WherePicker item=\{item\}/);
  assert.match(plan, /itemWhereText\(item\)/, "el plan muestra dónde se trabaja");
});

test("revisión: comas sin espacio, «a/e/o» y números que no son piezas", () => {
  assert.deepEqual(parseTeethInput("1.4,1.5", "fdi"), [14, 15]);
  assert.deepEqual(parseTeethInput("14,15", "fdi"), [14, 15]);
  assert.deepEqual(parseTeethInput("5,4,30", "chile"), [14, 15, 36]);
  assert.deepEqual(parseTeethInput("C,H", "chile"), [53, 63]);
  assert.deepEqual(parseTeethInput("5 a 8 y 30 e 19 o 4", "chile"), [11, 14, 15, 36, 46], "las palabras a/e/o no son piezas temporales");
  assert.deepEqual(parseTeethInput("1.500", "fdi"), []);
  for (const label of ["Obturación resina 2 caras", "Ortodoncia 24 meses", "Control 12/05/2026", "Corona 3/4", "x 6", "3 conductos", "Valor $45.000"]) {
    assert.deepEqual(teethHintsFromLabel(label), { fdi: [], chile: [] }, label);
  }
  assert.deepEqual(teethHintsFromLabel("Implante 1.4 y 15"), { fdi: [14, 15], chile: [14, 27] }, "lo con punto es FDI; lo suelto, ambiguo");
  assert.deepEqual(teethHintsFromLabel("pieza 6 corona").chile, [13], "un dígito solo si dice «pieza»");
});

test("revisión: la dentición temporal también tiene posteriores; el formulario no borra al solo mirar ni al escribir mal", () => {
  const temp = zoneOptions("temp").map(o => o.key);
  for (const key of ["ant-sup", "ant-inf", "post-sup", "post-inf", "molares"]) assert.ok(temp.includes(key), key);
  const picker = readFileSync(new URL("../components/zone-picker.tsx", import.meta.url), "utf8");
  assert.match(picker, /if \(GROUP_OF\[next\]\) \{ setPending\(/, "tocar Cuadrante/Sextante/Grupo solo abre opciones");
  assert.match(picker, /if \(text\.trim\(\) && !parsed\.length\) \{ setNotice\(/, "texto sin piezas reconocibles no borra las piezas");
  assert.match(picker, /const kind: Kind = pending \?\? kindOf\(item\.zone\)/, "lo guardado manda sobre el estado local");
  const plan = readFileSync(new URL("../components/budget-plan.tsx", import.meta.url), "utf8");
  assert.match(plan, /<section key=\{keyOf\(index\)\}/, "clave estable por prestación");
});
