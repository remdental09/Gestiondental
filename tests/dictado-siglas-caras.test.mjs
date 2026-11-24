import test from "node:test";
import assert from "node:assert/strict";
import { expandClinicShorthand } from "../lib/dictation/clinic-shorthand.ts";
import { classifyEvolution } from "../lib/dictation/evolution-type.ts";
import { dictatedDates, keepDictatedDates } from "../lib/dictation/dictated-dates.ts";
import { applyClinicalItems } from "../lib/dictation/clinical-items.ts";

// Textos sintéticos estilo ficha. Ninguno es una evolución real.
const x = (t) => expandClinicShorthand(t).text;

test("caras con C, «RS C» y «Rc Poro I» son restauraciones con cara", () => {
  assert.match(x("Pza 3.5 Rc MC Denticlean / Pulido"), /Pieza 3\.5 restauración de resina compuesta mesial y cervical vestibular/);
  assert.match(x("Pza 1.4 Rc CMV-denticlean / pulido"), /restauración de resina compuesta cervical, mesial y vestibular/);
  assert.match(x("Pza 3.1 Rc Poro I Denticlean / Pulido"), /restauración de resina compuesta incisal\s+\(poro\)/);
  assert.match(x("Pza 1.3 RS C z350 A2 - pulido"), /Pieza 1\.3 restauración de resina compuesta cervical vestibular/);
  for (const t of ["Pza 3.5 Rc MC Denticlean / Pulido", "Pza 1.3 RS C z350 - pulido", "Pza 1.7 Rc Reconstrucción -Denticlean / Pulido", "Pza 3.1 Rc Poro I / Pulido"]) {
    assert.doesNotMatch(JSON.stringify(classifyEvolution(x(t))), /pulido/i, t);
  }
});

test("«Pza 2,1» y «Pza-2-7» son FDI 2.1 y 2.7", () => {
  assert.match(x("Pza 2,1 Rc I-Denticlean"), /Pieza 2\.1 restauración de resina compuesta incisal/);
  assert.match(x("Pzas 2,1-2,2 Rc M-M"), /2\.1.*2\.2/);
  assert.match(x("Pza-2-7 Rc -MO base"), /Pieza 2\.7/);
  assert.match(x("Pza 1.2 Rc M"), /Pieza 1\.2/);
});

test("glosario: BQTO; Miris y Pola quedan como marcas; TPMOP y OC literales; 2½ tubos se conserva", () => {
  assert.match(x("BQTO 3 ciclos"), /blanqueamiento 3 ciclos/);
  assert.match(x("resina Miris NR"), /Miris NR/);
  assert.match(x("TPMOP control en OC"), /TPMOP control en OC/);
  assert.match(x("anestesia infiltrativa 21/2 tubos 2%"), /2 tubos y medio/);
  assert.match(x("anestesia 2 1/2 tubos"), /2 tubos y medio/);
});

test("las fechas escritas en el dictado no se pierden de la nota", () => {
  assert.deepEqual(dictatedDates("Con fecha 1 de junio se realiza eliminación de caries"), ["1 de junio"]);
  assert.deepEqual(dictatedDates("03/07 Cementación de corona"), ["03/07"]);
  assert.deepEqual(dictatedDates("22/10/2026\n\nevaluación de ortodoncia"), ["22/10/2026"]);
  assert.deepEqual(dictatedDates("anestesia 2 1/2 tubos"), []);
  assert.deepEqual(dictatedDates("Control el 15/12 por dolor"), []);
  assert.match(keepDictatedDates("Se cementa corona.", "03/07 Cementación de corona").body, /^Fecha indicada en el dictado: 03\/07\.\nSe cementa corona\./);
  assert.equal(keepDictatedDates("El 3/7 se cementa corona.", "03/07 Cementación").kept.length, 0);
});

test("pieza restaurada hoy: sus caras con caries pasan a restauración, no quedan como caries", () => {
  const tools = { sentences: (t) => t.split(/(?<=[.!?/])\s+/), teethIn: (t) => [...t.matchAll(/\b([1-8])\.([1-8])\b/g)].map((m) => Number(m[1]) * 10 + Number(m[2])), isPlan: () => false, formatFdi: (n) => `${Math.floor(n / 10)}.${n % 10}` };
  const face = (tooth, surface, src) => ({ id: `c${tooth}${surface}`, tooth, kind: "surface", surface, finding: { condition: "caries", depth: null, icdas: null, activity: null }, numbering: "FDI", numberingLabel: `FDI ${tooth}`, sourceText: src, evidence: src, origin: "reglas" });
  const text = "Se realiza eliminación de caries pieza 2.5 OD. Se restaura pieza 2.5 con resina compuesta z350.";
  const proposal = { odontogram: [face(25, "O", text), face(25, "D", text)], evolution: { title: "Obturación", body: text }, prestaciones: [], clarifications: [] };
  const aiItems = [{ id: "a", kind: "realizado", category: "obturacion", tooth: 25, evidence: "Se restaura pieza 2.5 con resina compuesta z350", origin: "ia+reglas", surfaces: [] }];
  const out = applyClinicalItems(proposal, { text, aiItems, chart: [] }, tools);
  const faces = out.odontogram.filter((c) => c.tooth === 25);
  assert.ok(faces.length === 2 && faces.every((c) => c.finding.condition === "restored"), JSON.stringify(faces.map((c) => c.finding)));
  // Caries dejada para otra sesión: se mantiene.
  const later = "Caries pieza 2.6 D para la próxima sesión.";
  const p2 = { odontogram: [face(26, "D", later)], evolution: { title: "x", body: later }, prestaciones: [], clarifications: [] };
  const out2 = applyClinicalItems(p2, { text: `Se restaura pieza 2.6 O con resina. ${later}`, aiItems: [{ id: "b", kind: "realizado", category: "obturacion", tooth: 26, evidence: "Se restaura pieza 2.6 O con resina", origin: "reglas", surfaces: [] }], chart: [] }, tools);
  assert.equal(out2.odontogram.find((c) => c.tooth === 26 && c.surface === "D").finding.condition, "caries");
});
