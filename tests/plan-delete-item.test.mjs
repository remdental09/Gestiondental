import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
const odontogram = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("la API quita una prestación sin dejar el total bajo los abonos", () => {
  const block = route.slice(route.indexOf('action === "removeBudgetItem"'));
  assert.match(block, /budgetAccess\(ownerId, budgetId\)\)\.editable/);
  assert.match(block, /data\.items\.length === 1/);
  assert.match(block, /total < paid/);
});

test("el plan del odontograma ofrece Eliminar con confirmación", () => {
  assert.match(odontogram, /data-testid="plan-delete"/);
  assert.match(odontogram, /window\.confirm\(`¿Eliminar «/);
  assert.match(page, /onDeletePlanned=\{removeBudgetItem\}/);
});
