import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/tooth-3d-stage.tsx", import.meta.url), "utf8");

test("las piezas superiores (cuadrantes 1, 2, 5 y 6) se invierten en la vista 3D individual", () => {
  assert.match(src, /const upper = \[1, 2, 5, 6\]\.includes\(Math\.floor\(tooth \/ 10\)\)/);
  assert.match(src, /if \(upper\) flip\.rotation\.z = Math\.PI/);
  assert.match(src, /flip\.add\(inner\)/);
});
