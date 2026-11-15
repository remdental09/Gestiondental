import test from "node:test";
import assert from "node:assert/strict";
import { appendToothHistory, mergeRecentSurfaceEvent, toothHistorySnapshot } from "../app/odontogram-history.ts";

const chart = () => ({ teeth: {}, surfaces: {}, missingReason: {}, history: [] });
const change = (data, finding, at, meta = {}) => {
  const before = toothHistorySnapshot(data, 47);
  data.surfaces[47] = { ...(data.surfaces[47] ?? {}), V: finding };
  const n = data.history.length;
  appendToothHistory(data, 47, "surface", before, { recordedAt: at, surface: "V", ...meta });
  if (data.history.length > n) mergeRecentSurfaceEvent(data, 47, "V");
};

test("caries y su profundidad, guardadas seguidas, quedan en un solo hito", () => {
  const d = chart();
  change(d, { condition: "caries", depth: null, icdas: null, activity: null }, "2026-11-15T10:00:00.000Z");
  change(d, { condition: "caries", depth: "pulpar", icdas: null, activity: null }, "2026-11-15T10:01:00.000Z");
  assert.equal(d.history.length, 1);
  assert.equal(d.history[0].before.surfaces.V, undefined);
  assert.equal(d.history[0].after.surfaces.V.depth, "pulpar");
});

test("cambios separados por más de diez minutos siguen siendo hitos distintos", () => {
  const d = chart();
  change(d, { condition: "caries", depth: null, icdas: null, activity: null }, "2026-11-15T10:00:00.000Z");
  change(d, { condition: "caries", depth: "esmalte", icdas: null, activity: null }, "2026-11-15T11:00:00.000Z");
  assert.equal(d.history.length, 2);
});

test("un hito de dictado no se une con uno manual", () => {
  const d = chart();
  change(d, { condition: "caries", depth: null, icdas: null, activity: null }, "2026-11-15T10:00:00.000Z", { source: "evolution", sourceEvolutionId: 3 });
  change(d, { condition: "caries", depth: "esmalte", icdas: null, activity: null }, "2026-11-15T10:01:00.000Z");
  assert.equal(d.history.length, 2);
});
