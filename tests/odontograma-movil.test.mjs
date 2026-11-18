import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");

test("en el celular el odontograma se ve por cuadrante, sin scroll lateral", () => {
  assert.match(src, /data-testid="odontogram-mobile"/);
  assert.match(src, /sm:hidden" data-testid="odontogram-mobile"/);
  assert.match(src, /hidden space-y-3 overflow-x-auto sm:block/);
  assert.match(src, /teeth\.slice\(mobileQuad\*quadSize,\(mobileQuad\+1\)\*quadSize\)/);
  assert.match(src, /grid-cols-8/);
});

test("la cuadrícula del celular muestra el esquema de caras en solo lectura; se edita en la ficha de la pieza", () => {
  assert.match(src, /<OcclusalToothView compact=\{compact\}/);
  assert.match(src, /compact\?"pointer-events-none aspect-square/);
  assert.match(src, /onClick=\{\(\)=>\{setMessage\(""\);setSelectedTooth\(tooth\)\}\} onDoubleClick=\{e=>\{setMessage\(""\);setSelectedTooth\(tooth\);if\(compact\)setSheetOpen\(true\);else openTooth3D/);
});

test("la ficha de la pieza se abre como hoja inferior en el celular y se cierra", () => {
  assert.match(src, /data-testid="tooth-panel"/);
  assert.match(src, /max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0/);
  assert.match(src, /"max-sm:hidden"/);
  assert.match(src, /Cerrar ficha de la pieza/);
  assert.match(src, /e\.key==="Escape"\)setSheetOpen\(false\)/);
});
