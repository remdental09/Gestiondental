import test from "node:test";
import assert from "node:assert/strict";
import { revertEvolution, chartAt, chartDates } from "../lib/odontogram-timeline.ts";

const snap = (status, extra = {}) => ({ status, surfaces: {}, missingReason: null, crown: null, ...extra });
const ev = (id, tooth, date, before, after, evo) => ({ id, tooth, recordedAt: `${date}T12:00:00.000Z`, clinicalDate: date, eventType: "status", source: evo ? "evolution" : "manual", ...(evo ? { sourceEvolutionId: evo } : {}), before, after });
const zirc = { material: "Zirconio", foundation: "tooth" };

// Pieza 4.5: corona natural (03-11), una evolución errónea la pasa a implante (09-11) y luego se agrega una caries manual.
const chart = () => ({
  teeth: { 45: "Implante", 46: "Implante" },
  surfaces: { 45: { D: { condition: "caries" } } },
  missingReason: {},
  crowns: {},
  history: [
    ev("a", 45, "2026-11-03", snap("PMMA"), snap("Corona", { crown: zirc })),
    ev("b", 45, "2026-11-09", snap("Corona", { crown: zirc }), snap("Implante"), 194),
    ev("c", 46, "2026-11-09", snap("Sin hallazgos"), snap("Implante"), 194),
    { ...ev("d", 45, "2026-11-10", snap("Implante"), snap("Implante", { surfaces: { D: { condition: "caries" } } })), eventType: "surface" },
  ],
});

test("borrar o anular una evolución deshace sus cambios y conserva lo posterior", () => {
  const { chart: out, teeth } = revertEvolution(chart(), 194);
  assert.deepEqual(teeth.sort(), [45, 46]);
  assert.equal(out.teeth[45], "Corona");
  assert.deepEqual(out.crowns[45], zirc);
  assert.equal(out.teeth[46], undefined, "la 4.6 vuelve a «sin hallazgos»");
  assert.deepEqual(out.surfaces[45], { D: { condition: "caries" } }, "la caries anotada después se conserva");
  assert.ok(!out.history.some((e) => e.sourceEvolutionId === 194));
  assert.equal(revertEvolution(chart(), 999).teeth.length, 0);
});

test("ver el odontograma de una fecha", () => {
  const c = chart();
  assert.equal(chartAt(c, "2026-11-05").teeth[45], "Corona");
  assert.equal(chartAt(c, "2026-11-05").teeth[46], undefined);
  assert.equal(chartAt(c, "2026-11-01").teeth[45], "PMMA");
  assert.equal(chartAt(c, "2026-11-09").teeth[45], "Implante");
  assert.equal(chartAt(c, "2026-11-09").surfaces[45], undefined);
  assert.deepEqual(chartAt(c, "2026-11-10").surfaces[45], { D: { condition: "caries" } });
  assert.deepEqual(chartDates(c), ["2026-11-10", "2026-11-09", "2026-11-03"]);
});

import { readFileSync } from "node:fs";
test("la ficha ofrece ver el odontograma por fecha y el servidor revierte al borrar o anular", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  assert.match(page, /<OdontogramDateBar /);
  assert.match(page, /chartAt\(toothStatuses\[selectedId\]/);
  assert.equal(route.split("revertChartOf(db, ownerId, patientId, evolutionId)").length - 1, 2);
});
