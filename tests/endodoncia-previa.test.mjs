import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priorCase, normalizeEndo, endoMarksByTooth, caseStatus, missingDocumentation, emptyEndo } from "../lib/endodontics.ts";

test("una endodoncia previa marca la pieza como obturada sin pedir ficha técnica", () => {
  const data = { ...emptyEndo(), cases: [priorCase("a1", 14, "2026-11-12", "2019")] };
  assert.equal(endoMarksByTooth(data)[14], "obturado");
  assert.equal(caseStatus(data.cases[0], "2026-11-12"), "Obturado");
  assert.deepEqual(missingDocumentation(data.cases[0]), []);
});

test("el servidor conserva prior y limpia el año", () => {
  const raw = { cases: [{ ...priorCase("a1", 14, "2026-11-12", "2019"), priorYear: "20x9" }, { ...priorCase("a2", 15, "2026-11-12", "2015") }] };
  const out = normalizeEndo(JSON.parse(JSON.stringify(raw)));
  assert.equal(out.cases[0].prior, true);
  assert.equal(out.cases[0].priorYear, "");
  assert.equal(out.cases[1].priorYear, "2015");
});

test("la ficha de la pieza ofrece registrar y quitar la endodoncia previa", () => {
  const odo = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
  assert.match(odo, /Registrar endodoncia previa/);
  assert.match(odo, /tooth-endo-prior/);
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /onSetPriorEndo=/);
});
