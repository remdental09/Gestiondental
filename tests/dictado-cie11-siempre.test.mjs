import test from "node:test";
import assert from "node:assert/strict";
import { proposeFromTranscript } from "../lib/dictation/proposal.ts";
import { dxStartsChecked, reviewableDiagnoses, withoutAutoProposal } from "../lib/dictation/diagnosis-review.ts";
import { fallbackDiagnoses } from "../lib/dictation/clinical-items.ts";
import { sanitizeDiagnosisTags } from "../lib/evolution-diagnoses.ts";
import { readFileSync } from "node:fs";

// Textos sintéticos (estilo ficha). Ninguno es una evolución real.
const run = async (text) => (await proposeFromTranscript({ transcript: text, chart: [] }, null, () => {}, { today: "2026-11-24", sensitivity: "basic" })).proposal;
const dxOf = (p, tooth) => (p.diagnoses ?? []).filter((d) => d.tooth === tooth);
const tools = { sentences: (t) => [t], teethIn: () => [], isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };

test("cirugía de implante en la 4.5: se propone DA0A.1 y parte marcado para que se guarde", async () => {
  const p = await run("cirugía implante pieza 4.5");
  const dx = dxOf(p, 45);
  assert.ok(dx.some((d) => d.code === "DA0A.1"), JSON.stringify(p.diagnoses));
  assert.ok(dx.every((d) => dxStartsChecked(d)));
});

test("endodoncia en taquigrafía sin diagnóstico dictado: la pieza tiene un CIE-11 propuesto de la pulpa", async () => {
  const p = await run("Pza 2.6 PQM Cdto MV 17mm-ref cusp MV - Cdto P 19mm / NaOCl-EDTA / OBC Guta");
  const dx = dxOf(p, 26);
  assert.ok(dx.length >= 1, JSON.stringify(p.diagnoses));
  assert.ok(dx.every((d) => d.code.startsWith("DA09")), JSON.stringify(dx));
});

test("restauración hecha sin diagnóstico: la pieza queda con CIE-11 propuesto (tejidos duros)", async () => {
  const p = await run("Ajusto plano de oclusión, hago restauración pza 3.4 clase V con flow A2");
  const dx = dxOf(p, 34);
  assert.ok(dx.length >= 1, JSON.stringify(p.diagnoses));
  assert.ok(dx.every((d) => d.code.startsWith("DA08") || d.code.startsWith("NA0D")));
});

test("exodoncia sin causa dictada: propone un CIE-11 para la pieza", async () => {
  const p = await run("Anestesia spix. Pza 3.8 exodoncia. Sutura reabsorbible. Cito a control.");
  assert.ok(dxOf(p, 38).length >= 1, JSON.stringify(p.diagnoses));
});

test("lo dictado como diagnóstico no se reemplaza por la propuesta de respaldo", async () => {
  const p = await run("Pieza 3.6 con pulpitis irreversible, se realiza trepanación y pulpectomía.");
  const dx = dxOf(p, 36);
  assert.ok(dx.some((d) => d.code === "DA09.0"), JSON.stringify(dx));
  assert.ok(!dx.some((d) => d.id.startsWith("dx-respaldo")));
});

test("el respaldo no inventa diagnóstico para lo planificado", () => {
  const items = [{ id: "i1", tooth: 46, chile: null, surfaces: [], kind: "plan", category: "implante", what: "implante", evidence: "se planifica implante", origin: "reglas" }];
  assert.deepEqual(fallbackDiagnoses(items, [], [], tools), []);
});

test("respaldo por categoría: corona sobre implante es DA0A.1; destartraje es depósitos DA08.4", () => {
  const items = [
    { id: "i1", tooth: 24, chile: null, surfaces: [], kind: "realizado", category: "pilar", what: "conexión", evidence: "conecto pilar 2.4", origin: "reglas" },
    { id: "i2", tooth: 24, chile: null, surfaces: [], kind: "realizado", category: "corona", what: "corona", evidence: "corona 2.4", origin: "reglas" },
    { id: "i3", tooth: 31, chile: null, surfaces: [], kind: "realizado", category: "destartraje", what: "destartraje", evidence: "destartraje 3.1", origin: "reglas" },
  ];
  const out = fallbackDiagnoses(items, [], [], tools);
  assert.deepEqual(out.map((d) => `${d.tooth}:${d.code}:${d.suggested.from}`), ["24:DA0A.1:nota", "31:DA08.4:nota"]);
});

test("caries en la raíz sin cara en el odontograma: el DA08.0 se revisa y se guarda; con cara, va con la cara", () => {
  const dx = [{ code: "DA08.0", tooth: 15 }, { code: "DA08.0", tooth: 26 }, { code: "DA09.1", tooth: 26 }];
  const odo = [{ tooth: 26, kind: "surface", finding: { condition: "caries" } }];
  assert.deepEqual(reviewableDiagnoses(dx, odo).map((d) => `${d.tooth}:${d.code}`), ["15:DA08.0", "26:DA09.1"]);
});

test("elegir una opción de «¿olvidaste el diagnóstico?» reemplaza la propuesta automática de esa pieza", () => {
  const items = [{ code: "DA09.Z", tooth: 26, suggested: { from: "nota" } }, { code: "DA09.1", tooth: 26 }, { code: "DA08.Z", tooth: 14, suggested: { from: "nota" } }];
  assert.deepEqual(withoutAutoProposal(items, 26).map((d) => d.code), ["DA09.1", "DA08.Z"]);
});

test("el origen «propuesto según la nota» se guarda con el diagnóstico", () => {
  const ok = sanitizeDiagnosisTags([{ code: "DA0A.1", title: "x", tooth: 45, findings: "", evidence: "implante 4.5", origin: "reglas", suggestedFrom: "nota" }]);
  assert.ok(!("error" in ok));
  assert.equal(ok.tags[0].suggestedFrom, "nota");
});

test("la revisión usa las funciones comunes (no vuelve a botar el DA08.0 ni a desmarcar lo propuesto)", () => {
  const src = readFileSync(new URL("../components/clinical-dictation.tsx", import.meta.url), "utf8");
  assert.match(src, /reviewableDiagnoses\(data\.proposal\.diagnoses/);
  assert.match(src, /withoutAutoProposal\(current, tooth\)/);
});

// ── Diagnósticos propuestos cercanos a lo dicho (en vez del residual «sin especificación») ──
const item = (over) => ({ id: "i", tooth: 36, chile: null, surfaces: [], kind: "realizado", category: "obturacion", what: "resina", evidence: "resina oclusal en la 3.6", origin: "reglas", ...over });

test("restauración sin causa dictada NO inventa caries: queda el residual rotulado como propuesta", () => {
  const out = fallbackDiagnoses([item({})], [], [], tools);
  assert.deepEqual(out.map((d) => d.code), ["DA08.Z"]);
  assert.ok(out[0].label.includes("propuesto según la nota"), "queda rotulada como propuesta");
});

test("si la nota dice la causa (caries, fractura, abrasión, erosión), la propuesta la sigue", () => {
  const code = (evidence, category = "obturacion") => fallbackDiagnoses([item({ evidence, category })], [], [], tools)[0].code;
  assert.equal(code("resina por fractura de cúspide"), "NA0D.02");
  assert.equal(code("resina en lesión por abrasión cervical"), "DA08.11");
  assert.equal(code("resina por erosión"), "DA08.12");
  assert.equal(code("resina por caries oclusal"), "DA08.0");
  assert.equal(code("corona por fractura", "corona"), "NA0D.02");
  assert.equal(code("corona 3.6", "corona"), "DA08.Z");
});

test("destartraje sin pieza propone depósitos (DA08.4) aunque la nota ya traiga el diagnóstico de una restauración", () => {
  const items = [item({}), item({ id: "d", tooth: null, category: "destartraje", what: "destartraje", evidence: "destartraje en todo el sector" })];
  const out = fallbackDiagnoses(items, [], [], tools);
  assert.deepEqual(out.map((d) => `${d.tooth ?? "general"}:${d.code}`), ["36:DA08.Z", "general:DA08.4"]);
});

test("destartraje no repite diagnóstico si la nota ya dice algo gingival o periodontal", () => {
  const items = [item({ id: "d", tooth: null, category: "destartraje", what: "destartraje", evidence: "destartraje general" })];
  assert.deepEqual(fallbackDiagnoses(items, [], [{ code: "DA0B.Z", tooth: undefined }], tools), []);
  assert.deepEqual(fallbackDiagnoses(items, [], [{ code: "DA0C.Z", tooth: 16 }], tools), []);
});

test("con una pieza ausente en la ficha, la advertencia de incongruencia se mantiene y no aparece el residual genérico (solo reglas, sin modelo)", async () => {
  const { proposal } = await proposeFromTranscript(
    { transcript: "Paciente viene por dolor en el 36, destartraje en todo el sector, anestesia infiltrativa con lidocaína y resina oclusal en la 36.", chart: [{ tooth: 36, status: "Ausente" }] },
    null, () => {}, { today: "2026-11-24", sensitivity: "basic" });
  const codes = (proposal.diagnoses ?? []).map((d) => d.code);
  assert.ok(!codes.includes("DA08.Z"), `sin residual genérico: ${codes}`);
  const warned = proposal.clarifications.some((text) => /figura como ausente|figura ausente/.test(text)) || JSON.stringify(proposal).includes("figura ausente");
  assert.ok(warned, "se sigue advirtiendo la pieza ausente: " + JSON.stringify(proposal.clarifications));
});
