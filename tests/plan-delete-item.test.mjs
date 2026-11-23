import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
const odontogram = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("la API quita una prestación sin dejar el total bajo los abonos", () => {
  const block = route.slice(route.indexOf('action === "removeBudgetItem"'));
  assert.match(block, /budgetAccess\(ownerId, budgetId\)\)\.editable/);
  assert.doesNotMatch(block.slice(0, block.indexOf('setBudgetItemDone')), /única prestación del plan; elimina/, 'ya no bloquea quitar la única prestación');
  assert.match(block, /if \(!items\.length\)/);
  assert.match(block, /db\.delete\(budgets\)/);
  assert.match(block, /abonos registrados; no se puede eliminar/, 'con abonos no se borra el plan');
  assert.match(block, /removedBudgetId/);
  assert.match(block, /total < paid/);
});

test("el plan del odontograma ofrece Eliminar con confirmación", () => {
  assert.match(odontogram, /data-testid="plan-delete"/);
  assert.match(odontogram, /window\.confirm\(`¿Eliminar «/);
  assert.match(page, /onDeletePlanned=\{removeBudgetItem\}/);
});

test("el aviso de la acción se ve dentro del panel del plan, no solo al pie del odontograma", () => {
  const panel = odontogram.slice(odontogram.indexOf("Plan de tratamiento en FDI"));
  assert.match(panel.slice(0, panel.indexOf("surfaceKeys.map")), /data-testid="plan-message"/);
  assert.match(page, /removedBudgetId\?previous\.filter/);
});
