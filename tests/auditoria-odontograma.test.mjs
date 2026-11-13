import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditChart } from "../lib/chart-audit.ts";

// Réplica anónima de combinaciones encontradas en fichas reales durante la auditoría.
const chart = {
  teeth: { 44: "Implante", 46: "Corona", 36: "Implante", 74: "Corona", 45: "Corona", 14: "Ausente" },
  surfaces: { 44: { M: { condition: "restored" } }, 46: { O: { condition: "sealant" } }, 45: { O: { condition: "restored" } }, 14: { O: { condition: "not_examined" } } },
  missingReason: {},
  crowns: { 36: { material: "Zirconio", foundation: "implant" }, 45: { material: "Zirconio", foundation: "tooth" } },
};

test("la auditoría encuentra las combinaciones imposibles y nada más", () => {
  const issues = auditChart(chart).map((i) => [i.tooth, i.problem.split(" ").slice(0, 3).join(" ")]);
  assert.deepEqual(issues, [
    [44, "figura como implante"],
    [46, "tiene corona y"],
    [74, "es una pieza"],
  ]);
});

test("el servidor limpia caras al marcar implante o ausente y no acepta sellante sobre corona", () => {
  const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  assert.match(route, /\["Ausente", "Implante", "Implante con pilar"\]\.includes\(effective\)\) delete data\.surfaces\[tooth\]/);
  assert.match(route, /condition === "sealant" && data\.teeth\[tooth\] === "Corona"/);
});
