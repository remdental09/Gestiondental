import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
const history = readFileSync(new URL("../components/evolution-history.tsx", import.meta.url), "utf8");
const block = route.slice(route.indexOf('action === "updateEvolution"'), route.indexOf('action === "annulEvolution"'));

test("editar evolución: solo vigentes, de esa ficha y del dueño, y guarda el texto anterior", () => {
  assert.ok(block.includes("evolutions.patientId, patientId") && block.includes("evolutions.ownerId, ownerId"));
  assert.ok(block.includes('status === "anulada"') && block.includes("409"));
  assert.ok(block.includes("evolution_edits") && block.includes("previous_body"));
  assert.ok(block.includes("La evolución no puede quedar vacía"));
  assert.ok(block.includes('eq(evolutions.status, "vigente")'));
});
test("editar evolución: no borra ni anula nada", () => {
  assert.ok(!block.includes(".delete(") && !block.includes('status: "anulada"'));
});
test("la historia ofrece Editar solo en evoluciones vigentes", () => {
  assert.ok(history.includes('data-testid="note-edit"') && history.includes("onEdit &&"));
  const buttons = history.slice(history.indexOf("startEdit(note)") - 400);
  assert.ok(buttons.indexOf("note-edit") < buttons.indexOf("note-annul"));
  assert.ok(history.includes("annulled ?") );
});
