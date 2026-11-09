import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEndo, emptyEndo, newCase, caseStatus, endoMarksByTooth, missingDocumentation, sessionEvolutionText, followUpEvolutionText, suggestedNextControl, referencedEndoImageIds, canalLine } from "../lib/endodontics.ts";

const base = (over = {}) => ({ ...newCase("c1", 36, "2026-10-01"), ...over });

test("normaliza: descarta piezas, fechas, diagnósticos y medidas inválidas", () => {
  const data = normalizeEndo({ cases: [
    base({ pulpal: "Pulpitis irreversible sintomática", periapical: "Inventado", tests: { frio: "Prolongada (>10 s)", calor: "otra" },
      canals: [{ id: "k1", name: "MV", workingLength: "21,5", apexLocator: 99, apexDistance: "0,5", masterFile: "35/.04" }, { id: "k1", name: "dup" }],
      sessions: [{ id: "s1", date: "2026-10-02", steps: ["Acceso cameral", "Volar"] }, { id: "s2", date: "ayer" }],
      rx: [{ imageId: 7, stage: "Diagnóstica", date: "2026-10-01" }, { imageId: 7, stage: "Control", date: "2026-10-01" }, { imageId: -1, stage: "Control", date: "2026-10-01" }] }),
    base({ id: "c2", tooth: 19 }), base({ id: "c3", openedOn: "2026-02-30" }), base({ id: "c1" }),
  ] });
  assert.equal(data.cases.length, 1);
  const c = data.cases[0];
  assert.equal(c.pulpal, "Pulpitis irreversible sintomática");
  assert.equal(c.periapical, "");
  assert.equal(c.tests.frio, "Prolongada (>10 s)");
  assert.equal(c.tests.calor, "");
  assert.equal(c.canals.length, 1);
  assert.equal(c.canals[0].workingLength, 21.5);
  assert.equal(c.canals[0].apexLocator, 0);
  assert.equal(c.canals[0].apexDistance, 0.5);
  assert.deepEqual(c.sessions.map(s => s.steps), [["Acceso cameral"]]);
  assert.deepEqual(referencedEndoImageIds(data), [7]);
  assert.deepEqual(normalizeEndo("basura"), emptyEndo());
});

test("estado del caso y marca única para el odontograma", () => {
  const today = "2026-11-09";
  const dx = base();
  const curso = base({ id: "c2", tooth: 46, sessions: [{ id: "s", date: "2026-10-02", steps: [], irrigants: [], medication: "", temporary: "", notes: "" }] });
  const obt = base({ id: "c3", tooth: 11, sessions: curso.sessions, obturation: { date: "2026-05-01", technique: "Cono único", sealer: "", coronalSeal: "", notes: "" }, nextControlDate: "2026-11-01" });
  const cerrado = base({ id: "c4", tooth: 21, sessions: curso.sessions, closedReason: "Derivado a especialista" });
  assert.equal(caseStatus(dx, today), "Diagnóstico");
  assert.equal(caseStatus(curso, today), "En curso");
  assert.equal(caseStatus(obt, today), "Control atrasado");
  assert.equal(caseStatus(cerrado, today), "Cerrado");
  assert.deepEqual(endoMarksByTooth({ version: 1, cases: [dx, curso, obt, cerrado] }), { 46: "en curso", 11: "obturado" });
});

test("documentación: avisa lo que falta y queda completa con los datos clave", () => {
  const c = base({ sessions: [{ id: "s", date: "2026-10-02", steps: ["Obturación"], irrigants: [], medication: "", temporary: "", notes: "" }], obturation: { date: "2026-10-02", technique: "", sealer: "", coronalSeal: "", notes: "" }, canals: [{ id: "k", name: "D", apparentLength: 0, apexLocator: 0, workingLength: 0, reference: "", apexDistance: 0, masterFile: "", masterCone: "", notes: "" }] });
  const missing = missingDocumentation(c);
  for (const item of ["diagnóstico pulpar", "RX diagnóstica", "longitud de trabajo de D", "sellado coronario", "RX final de obturación", "fecha de control"]) assert.ok(missing.includes(item), item);
  const full = { ...c, pulpal: "Necrosis pulpar", periapical: "Periodontitis apical asintomática", tests: { ...c.tests, frio: "Sin respuesta" }, canals: [{ ...c.canals[0], workingLength: 20 }], obturation: { ...c.obturation, technique: "Cono único", coronalSeal: "Resina compuesta" }, rx: [{ imageId: 1, stage: "Diagnóstica", date: "2026-10-01" }, { imageId: 2, stage: "Obturación", date: "2026-10-02" }], nextControlDate: "2027-04-02" };
  assert.deepEqual(missingDocumentation(full), []);
});

test("textos de evolución con medidas en FDI y coma decimal", () => {
  const c = base({ pulpal: "Necrosis pulpar", canals: [{ id: "k", name: "MV", apparentLength: 22, apexLocator: 21.5, workingLength: 21, reference: "Cúspide MV", apexDistance: 1, masterFile: "35/.04", masterCone: "35/.04", notes: "" }] });
  const text = sessionEvolutionText(c, { id: "s", date: "2026-10-02", steps: ["Conductometría"], irrigants: ["NaOCl 2,5 %"], medication: "Hidróxido de calcio", temporary: "Cavit / IRM", notes: "" });
  assert.match(text, /pieza 3\.6/);
  assert.match(text, /LT 21 mm \(ref\. cúspide mv\)/);
  assert.match(text, /a 1 mm del ápice radiográfico/);
  assert.match(text, /hidróxido de calcio/);
  assert.match(canalLine({ ...c.canals[0], workingLength: 20.5 }), /LT 20,5 mm/);
  assert.match(followUpEvolutionText({ ...c, obturation: { ...c.obturation, date: "2026-04-01" } }, { id: "f", date: "2026-10-01", pai: 2, symptoms: "Asintomático", outcome: "En cicatrización", notes: "" }, "2027-04-01"), /PAI 2.*01-04-2027/);
});

test("controles sugeridos a 6, 12 meses y luego anuales", () => {
  assert.equal(suggestedNextControl("2026-01-15", 0), "2026-07-15");
  assert.equal(suggestedNextControl("2026-01-15", 1), "2027-01-15");
  assert.equal(suggestedNextControl("2026-01-15", 2), "2028-01-15");
  assert.equal(suggestedNextControl("2026-01-15", 5), "");
});
