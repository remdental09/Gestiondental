import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { auditRecord } from "../lib/audit/record-audit.ts";
import { measure } from "../lib/audit/eval.ts";

const cases = JSON.parse(readFileSync(new URL("./fixtures/auditoria-fichas.json", import.meta.url), "utf8"));

test("el auditor encuentra todos los errores sembrados y no avisa en las fichas correctas", () => {
  const report = measure(cases);
  const bad = report.results.filter((item) => item.missed.length || item.extra.length).map((item) => `${item.id}: faltó [${item.missed}] sobró [${item.extra}]`);
  assert.deepEqual(bad, []);
  assert.equal(report.detected, report.planted);
  assert.equal(report.falseAlarms, 0);
});

test("la misma ficha da siempre las mismas observaciones, con claves estables", () => {
  const sample = cases.find((item) => item.id === "a04");
  const first = auditRecord({ ...sample, patientId: 7 });
  const second = auditRecord({ ...sample, patientId: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.match(first[0].key, /^hecha-sin-registro\|7\|1\|5005002\|16$/);
  assert.match(first[0].message, /todavía muestra caries/);
});

test("el trabajo realizado hace más de 30 días no se audita; el pendiente sí", () => {
  const sample = cases.find((item) => item.id === "c04");
  assert.equal(auditRecord({ ...sample, patientId: 1 }).length, 0);
  assert.equal(auditRecord({ ...sample, patientId: 1, recentDays: 200 }).length, 1);
  const pending = cases.find((item) => item.id === "a01");
  assert.equal(auditRecord({ ...pending, patientId: 1, today: "2030-01-01" }).length, 1);
});

test("el endpoint calcula al leer, aísla por propietario y solo guarda la decisión del profesional", () => {
  const route = readFileSync(new URL("../app/api/auditoria/route.ts", import.meta.url), "utf8");
  assert.match(route, /WHERE owner_id = \?", owner/g);
  assert.match(route, /INSERT INTO audit_decisions/);
  assert.doesNotMatch(route, /UPDATE (patients|budgets|evolutions|tooth_statuses)/);
  assert.doesNotMatch(route, /INSERT INTO (patients|budgets|evolutions|tooth_statuses)/);
  assert.match(route, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
});
