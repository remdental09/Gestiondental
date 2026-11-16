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

import { pruneChartExtras } from "../lib/tooth-status.ts";
import { projectEvolutionChart } from "../app/odontogram-projection.ts";

test("lesión → Corona conserva la lesión, igual que Corona → lesión", () => {
  const a = applyToothStatus({ primary: "Granuloma apical", extras: [] }, "Corona");
  assert.deepEqual(allToothStatuses(a).sort(), ["Corona", "Granuloma apical"]);
  assert.equal(a.primary, "Corona");
});
test("pruneChartExtras limpia basura y piezas ausentes", () => {
  const chart = { teeth: { 11: "Ausente", 12: "Corona", 13: "Granuloma apical" }, extras: { 11: ["Quiste radicular"], 12: ["Corona", "Fisura coronaria", "Fisura coronaria"], 13: ["Granuloma apical"] } };
  pruneChartExtras(chart);
  assert.deepEqual(chart.extras, { 12: ["Fisura coronaria"] });
});
test("proyectar un implante no pierde las lesiones de otras piezas", () => {
  const chart = { teeth: { 16: "Corona" }, surfaces: {}, missingReason: {}, crowns: {}, extras: { 16: ["Granuloma apical"] }, history: [] };
  const out = projectEvolutionChart(chart, [46], null, false);
  assert.deepEqual(out.data.extras, { 16: ["Granuloma apical"] });
});

import { lesionEffect } from "../lib/tooth-status.ts";

test("las etapas apicales se reemplazan entre sí y conviven con fracturas y corona", () => {
  let s = applyToothStatus(empty, "Periodontitis apical");
  s = applyToothStatus(s, "Fractura radicular vertical");
  s = applyToothStatus(s, "Absceso apical agudo");
  assert.deepEqual(allToothStatuses(s), ["Absceso apical agudo", "Fractura radicular vertical"]);
  s = applyToothStatus(applyToothStatus({ primary: "Corona", extras: [] }, "Granuloma apical"), "Quiste radicular");
  assert.deepEqual(s, { primary: "Corona", extras: ["Quiste radicular"] });
  assert.deepEqual(lesionEffect(s, "Osteítis condensante"), { kind: "reemplaza", replaced: "Quiste radicular" });
  assert.deepEqual(lesionEffect(s, "Fisura coronaria"), { kind: "suma" });
  assert.deepEqual(lesionEffect(s, "Quiste radicular"), { kind: "igual" });
});

test("una ficha con varias etapas apicales acumuladas queda con la más reciente", () => {
  const chart = { teeth: { 46: "Periodontitis apical" }, extras: { 46: ["Absceso apical agudo", "Fractura radicular vertical", "Quiste radicular", "Osteítis condensante"] } };
  pruneChartExtras(chart);
  assert.equal(chart.teeth[46], "Osteítis condensante");
  assert.deepEqual(chart.extras[46], ["Fractura radicular vertical"]);
  const corona = { teeth: { 36: "Corona" }, extras: { 36: ["Granuloma apical", "Quiste radicular"] } };
  pruneChartExtras(corona);
  assert.deepEqual(corona.extras[36], ["Quiste radicular"]);
});
