import test from "node:test";
import assert from "node:assert/strict";
import { ENDO_CUE, sanitizeEndoProposals, applyEndoProposal, describeEndoProposal } from "../lib/dictation/endo-dictation.ts";
import { emptyEndo } from "../lib/endodontics.ts";

const transcript = "Pieza 4.6, necrosis pulpar, periodontitis apical asintomática. Conductometría: conducto mesiovestibular longitud de trabajo 20,5 milímetros, distal 21 milímetros. Lima maestra 40/.04. Irrigación con hipoclorito 5,25.";
const raw = { endodoncias: [{
  pieza: "4.6", sistema: "FDI", evidencia: "Pieza 4.6, necrosis pulpar, periodontitis apical asintomática",
  tipo: "Tratamiento de conducto", diagnostico_pulpar: "Necrosis pulpar", diagnostico_periapical: "Periodontitis apical asintomática",
  pruebas: { frio: "Sin respuesta", percusion: "Inventada" },
  conductos: [{ nombre: "MV", longitud_trabajo: 20.5, lima_maestra: "40/.04" }, { nombre: "D", longitud_trabajo: 21 }, { nombre: "DV", longitud_trabajo: 19.5 }],
  pasos: ["Conductometría", "Paso inventado"], irrigantes: ["NaOCl 5,25 %"],
}] };

test("detecta dictados con endodoncia", () => {
  assert.ok(ENDO_CUE.test(transcript));
  assert.ok(!ENDO_CUE.test("Control, caries en 3.6 obturada con resina."));
});

test("valida contra el dictado: enums, medidas dichas y citas literales", () => {
  const { items } = sanitizeEndoProposals(raw, transcript);
  assert.equal(items.length, 1);
  const p = items[0];
  assert.equal(p.tooth, 46);
  assert.deepEqual(p.tests, { frio: "Sin respuesta" }); // la opción inventada se descarta
  assert.deepEqual(p.steps, ["Conductometría"]);
  const mv = p.canals.find(c => c.name === "MV");
  assert.equal(mv.workingLength, 20.5);
  assert.equal(mv.masterFile, "40/.04");
  assert.equal(p.canals.find(c => c.name === "D").workingLength, 21);
  assert.equal(p.canals.find(c => c.name === "DV"), undefined); // 19,5 no se dijo: la IA no inventa medidas ni conductos
});

test("sin cita literal o con pieza que no está en la cita se rechaza", () => {
  assert.equal(sanitizeEndoProposals({ endodoncias: [{ ...raw.endodoncias[0], evidencia: "texto que no se dijo" }] }, transcript).items.length, 0);
  // Si la cita nombra la 4.6, manda la cita aunque la IA diga otra pieza.
  assert.equal(sanitizeEndoProposals({ endodoncias: [{ ...raw.endodoncias[0], pieza: "3.6" }] }, transcript).items[0].tooth, 46);
  // Una cita sin pieza, con un número que la IA propone pero no se dijo ahí, se rechaza.
  const noTooth = sanitizeEndoProposals({ endodoncias: [{ ...raw.endodoncias[0], pieza: "3.6", evidencia: "Irrigación con hipoclorito 5,25" }] }, transcript);
  assert.equal(noTooth.items.length, 0);
  assert.ok(noTooth.rejected.length > 0);
});

test("aplica al endograma: abre el caso, anota conductos y continúa el mismo caso otro día", () => {
  const p = sanitizeEndoProposals(raw, transcript).items[0];
  let n = 0;
  const id = () => `id${++n}`;
  const first = applyEndoProposal(emptyEndo(), p, "2026-11-10", id);
  assert.equal(first.cases.length, 1);
  const c = first.cases[0];
  assert.equal(c.tooth, 46);
  assert.equal(c.pulpal, "Necrosis pulpar");
  assert.equal(c.canals.length, 2);
  assert.equal(c.sessions[0].date, "2026-11-10");
  assert.equal(c.obturation.date, "");
  // Segunda sesión: obturación con el mismo conducto; no duplica el caso ni el conducto.
  const second = applyEndoProposal(first, { ...p, tests: {}, canals: [{ name: "MV", masterCone: "40/.04" }], steps: ["Obturación"], obturation: { technique: "Cono único" } }, "2026-11-17", id);
  assert.equal(second.cases.length, 1);
  assert.equal(second.cases[0].canals.length, 2);
  assert.equal(second.cases[0].canals.find(k => k.name === "MV").masterCone, "40/.04");
  assert.equal(second.cases[0].canals.find(k => k.name === "MV").workingLength, 20.5);
  assert.equal(second.cases[0].obturation.date, "2026-11-17");
  assert.equal(second.cases[0].nextControlDate, "2027-05-17");
});

test("una endodoncia ya obturada no se reabre: una nueva dictada abre otro caso", () => {
  const p = sanitizeEndoProposals(raw, transcript).items[0];
  let n = 0; const id = () => `x${++n}`;
  const done = applyEndoProposal(applyEndoProposal(emptyEndo(), p, "2026-01-05", id), { ...p, steps: ["Obturación"] }, "2026-01-12", id);
  const again = applyEndoProposal(done, { ...p, type: "Retratamiento" }, "2026-11-10", id);
  assert.equal(again.cases.length, 2);
});

test("el resumen muestra lo que se va a anotar", () => {
  const lines = describeEndoProposal(sanitizeEndoProposals(raw, transcript).items[0]);
  assert.ok(lines.some(l => l.includes("LT 20,5 mm")));
  assert.ok(lines.some(l => l.startsWith("Diagnóstico pulpar")));
});
