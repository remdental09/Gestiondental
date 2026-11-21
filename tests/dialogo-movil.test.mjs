import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("los diálogos no se ensanchan más que la pantalla del teléfono (columna de grilla con minmax(0,1fr))", () => {
  assert.match(read("components/ui/dialog.tsx"), /z-50 grid w-full max-w-\[calc\(100%-2rem\)\] grid-cols-\[minmax\(0,1fr\)\]/);
});

test("el diálogo del dictado no desborda en horizontal y su fecha y nota ocupan solo el ancho disponible", () => {
  const dictation = read("components/clinical-dictation.tsx");
  assert.match(dictation, /overflow-y-auto overflow-x-hidden overscroll-contain/);
  assert.match(dictation, /type="date" aria-label="Fecha de atención"/);
  assert.match(dictation, /className="mt-1 w-full min-w-0 max-w-full" type="date"/);
  assert.match(dictation, /<Textarea className="mt-2 min-h-56 w-full min-w-0 max-w-full/);
});
