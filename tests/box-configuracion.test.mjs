import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("los box son de la clínica (espacio), con origen verificado y los tres iniciales", () => {
  const route = read("../app/api/box/route.ts");
  assert.ok(route.includes('request.headers.get("origin")'));
  assert.ok(route.includes("listBoxes(user.userId)") && !route.includes("personalIdOf"));
  const db = read("../app/box-db.ts");
  for (const name of ["Box 1", "Box 2", "Vitacura"]) assert.ok(db.includes(`"${name}"`));
  assert.ok(db.includes("treatment_boxes_seeded"), "los box iniciales se crean una sola vez");
});

test("Configuración muestra el panel de box", () => {
  assert.ok(read("../app/page.tsx").includes("<BoxPanel/>"));
});
