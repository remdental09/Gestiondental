import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("los box son de la clínica (espacio), con origen verificado y «Box 1» inicial", () => {
  const route = read("../app/api/box/route.ts");
  assert.ok(route.includes('request.headers.get("origin")'));
  assert.ok(route.includes("listBoxes(user.userId)") && !route.includes("personalIdOf"));
  const db = read("../app/box-db.ts");
  assert.match(db, /const INITIAL_BOXES = \["Box 1"\];/, "las clínicas nuevas parten solo con Box 1");
  assert.ok(db.includes("treatment_boxes_seeded"), "los box iniciales se crean una sola vez");
});

test("Configuración muestra el panel de box", () => {
  assert.ok(read("../app/page.tsx").includes("<BoxPanel/>"));
});
