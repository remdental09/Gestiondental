import test from "node:test";
import assert from "node:assert/strict";
import { groupEvolutionsByDay } from "../lib/evolution-sessions.ts";

const note = (id, date, clinicalDate) => ({ id, date, clinicalDate, title: `Registro ${id}` });

test("agrupa registros con la misma fecha clínica en una sola sesión y conserva su orden", () => {
  const groups = groupEvolutionsByDay([
    note(3, "04 nov 2026", "2026-11-04"),
    note(2, "04 nov 2026", "2026-11-04"),
    note(1, "03 nov 2026", "2026-11-03"),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].notes.map(item => item.id), [3, 2]);
  assert.deepEqual(groups[1].notes.map(item => item.id), [1]);
});

test("agrupa por etiqueta chilena si el registro anterior no tiene fecha clínica ISO", () => {
  const groups = groupEvolutionsByDay([
    note(1, "04 nov 2026", "2026-11-04"),
    note(2, "4 NOVIEMBRE 2026", null),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].notes.map(item => item.id), [1, 2]);
});

test("mantiene separados los registros cuya fecha de atención no está consignada", () => {
  const groups = groupEvolutionsByDay([
    note(1, "Fecha de atención no consignada", null),
    note(2, "Fecha de atención no consignada", null),
  ]);

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].key, groups[1].key);
});
