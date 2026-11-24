import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Presupuestos tiene un buscador por nombre o RUT con la misma lógica que Pacientes y su propio texto", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const matchPatients=\(text:string\)=>/);
  assert.match(page, /budgetPatients=useMemo\(\(\)=>matchPatients\(budgetSearch\)/);
  assert.match(page, /filteredPatients=useMemo\(\(\)=>matchPatients\(search\)/);
  assert.match(page, /data-testid="budget-search"/);
  assert.match(page, /budgetPatients\.length\?budgetPatients\.map/);
  assert.match(page, /Ningún paciente coincide con la búsqueda\./);
});
