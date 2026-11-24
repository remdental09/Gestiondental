import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { conciseEvidence, tidyDiagnosisItems, ruleItems } from "../lib/dictation/clinical-items.ts";

// Textos sintéticos (estilo ficha). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;
const tools = { sentences: (t) => t.split(/(?<=[.!?])\s+/), teethIn: (t) => [...t.matchAll(/\b([1-8])\.([1-8])\b/g)].map((m) => Number(m[1]) * 10 + Number(m[2])), isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };
const junk = (p, text) => (p.items ?? []).filter((i) => i.kind === "diagnostico" && (/^(Pzas?|pza|PZA|Piezas?)\b/.test(i.what.trim()) || (text.length > 60 && i.what.length > 0.6 * text.length)));

test("acto de ficha sin verbo («2.4 Y 2.5, EXODONCIA») es realizado: ausentes y arancel, no un diagnóstico", async () => {
  const text = "2.4 Y 2.5, EXODONCIA. ROG CON 0,25 cc DE INJERTO Y MEMBRANA. INDICO AMOXI Y AINES SOS.";
  const p = await run(text);
  const states = p.odontogram.filter((o) => o.kind === "status" && !o.advisory).map((o) => `${o.tooth}:${o.status}`).sort();
  assert.deepEqual(states, ["24:Ausente", "25:Ausente"]);
  assert.ok(!(p.items ?? []).some((i) => i.kind === "diagnostico" && i.category === "exodoncia"));
});

test("«1 sesión de Blqto desvital» en la 2.1 es lo realizado, no un diagnóstico con la frase entera", async () => {
  const text = "Pza 2.1 Tope cervical VI / 1 sesión de Blqto desvital - Perborato de Na - Algodón - VI";
  const p = await run(text);
  assert.deepEqual(junk(p, text), []);
});

test("«se debe extraer la 1.4 y conectar en marzo el implante de la 3.5» es plan: nada queda hecho", async () => {
  const p = await run("SE DEBE EXTRAER LA 1.4 Y CONECTAR EN MARZO EL IMPLANTE DE LA 3.5");
  assert.ok(!p.odontogram.some((o) => !o.advisory && (o.status === "Implante" || o.status === "Ausente")), JSON.stringify(p.odontogram));
});

test("«impresión para coronas sobre implantes 2.4 - 4.6» no instala implantes ni cobra la instalación", async () => {
  const p = await run("hilo retractor / impresión digital para coronas sobre implantes pza 2.4 - 4.6 / color A2");
  assert.ok(!(p.prestaciones ?? []).some((x) => x.code === "5011001" && !x.advisory), JSON.stringify(p.prestaciones));
});

test("«la doctora indica exodoncia de la 4.8» sigue siendo una indicación", () => {
  const items = ruleItems("la doctora Rojas indica exodoncia de la 4.8", tools);
  assert.ok(!items.some((i) => i.kind === "realizado"));
});

test("un diagnóstico de procedimiento que repite el acto realizado de la misma pieza sale; un hallazgo largo queda con su tramo", () => {
  const base = { chile: null, surfaces: [], origin: "reglas" };
  const items = [
    { ...base, id: "a", tooth: 15, kind: "realizado", category: "exodoncia", what: "Exodoncia", evidence: "Exodoncia de resto radicular" },
    { ...base, id: "b", tooth: 15, kind: "diagnostico", category: "exodoncia", what: "Exodoncia de resto radicular de pieza 1.5, elevación transcrestal y sutura", evidence: "x" },
    { ...base, id: "c", tooth: 12, kind: "diagnostico", category: "otro", what: "Acude por dolor en zona de pieza 1.2 - ex clínico: dolor a la percusión - rx sin lesión - se indica control", evidence: "y" },
  ];
  const text = "Acude por dolor en zona de pieza 1.2 - ex clínico: dolor a la percusión - rx sin lesión - se indica control. Exodoncia de la 1.5";
  const out = tidyDiagnosisItems(items, text);
  assert.deepEqual(out.map((i) => i.id), ["a", "c"]);
  assert.ok(out[1].what.length <= 0.6 * text.length, out[1].what);
});

test("cita breve: de una frase de ficha con varias piezas queda el acto, sin la lista de materiales", () => {
  const ev = "Pzas 4.3-3.3-3.4-3.5 Rc CV  -Denticlean-Cap Hib SB-A3 Z250/ Pulido/ A2 % mentoniana";
  const out = conciseEvidence(ev, 34);
  assert.equal(out, "Pzas 4.3-3.3-3.4-3.5 Rc CV");
  assert.ok(ev.includes(out));
  assert.equal(conciseEvidence("pieza 3.6 caries distal", 36), "pieza 3.6 caries distal");
});
