import test from "node:test";
import assert from "node:assert/strict";
import { applyToothStatus, removeToothLesion, allToothStatuses } from "../lib/tooth-status.ts";

const empty = { extras: [] };
test("una lesión se acumula sobre una corona", () => {
  const s = applyToothStatus(applyToothStatus(empty, "Corona"), "Granuloma apical");
  assert.deepEqual(s, { primary: "Corona", extras: ["Granuloma apical"] });
});
test("dos lesiones conviven y no se duplican", () => {
  let s = applyToothStatus(empty, "Fisura coronaria");
  s = applyToothStatus(s, "Periodontitis apical");
  s = applyToothStatus(s, "Periodontitis apical");
  assert.deepEqual(allToothStatuses(s), ["Fisura coronaria", "Periodontitis apical"]);
});
test("ausente, implante y sin hallazgos borran las lesiones", () => {
  const s = applyToothStatus(applyToothStatus(empty, "Corona"), "Quiste radicular");
  assert.deepEqual(applyToothStatus(s, "Ausente"), { primary: "Ausente", extras: [] });
  assert.deepEqual(applyToothStatus(s, "Sin hallazgos"), { extras: [] });
});
test("una lesión no se agrega a una pieza ausente", () => {
  assert.deepEqual(applyToothStatus({ primary: "Ausente", extras: [] }, "Granuloma apical"), { primary: "Ausente", extras: [] });
});
test("quitar la lesión principal promueve la siguiente", () => {
  const s = removeToothLesion({ primary: "Granuloma apical", extras: ["Fisura coronaria"] }, "Granuloma apical");
  assert.deepEqual(s, { primary: "Fisura coronaria", extras: [] });
});

import { applyStatusToChart, removeLesionFromChart } from "../lib/tooth-status.ts";
import { toothHistorySnapshot, appendToothHistory } from "../app/odontogram-history.ts";
import { snapshotOf, applyEffect } from "../lib/odontogram-timeline.ts";

test("el historial registra las lesiones adicionales y se puede reproducir", () => {
  const chart = { teeth: {}, surfaces: {}, missingReason: {}, crowns: {}, history: [] };
  applyStatusToChart(chart, 16, "Corona");
  const before = toothHistorySnapshot(chart, 16);
  applyStatusToChart(chart, 16, "Granuloma apical");
  assert.deepEqual(chart.extras[16], ["Granuloma apical"]);
  appendToothHistory(chart, 16, "status", before, { recordedAt: "2026-01-01T00:00:00Z" });
  const ev = chart.history[0];
  assert.deepEqual(ev.after.extras, ["Granuloma apical"]);
  assert.equal(ev.before.extras, undefined);
  assert.deepEqual(applyEffect(ev.before, ev).extras, ["Granuloma apical"]);
  assert.deepEqual(snapshotOf(chart, 16).extras, ["Granuloma apical"]);
});
test("quitar la última lesión deja la pieza limpia", () => {
  const chart = { teeth: { 26: "Fisura coronaria" }, extras: {} };
  removeLesionFromChart(chart, 26, "Fisura coronaria");
  assert.equal(chart.teeth[26], undefined);
  assert.equal(chart.extras[26], undefined);
});
