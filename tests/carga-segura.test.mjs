import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("la carga de fichas no queda colgada y una página desactualizada se recupera sola", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /fetch\("\/api\/clinical",\{cache:"no-store",signal:AbortSignal\.timeout\(15000\)\}\)/);
  assert.match(page, /__gdReady=true/);
  assert.match(page, /Reintentar/);
  assert.match(layout, /Importing a module script failed/);
  assert.match(layout, /now-last<60000/, "recarga a lo más una vez por minuto (sin bucles)");
  assert.match(layout, /indexOf\("Cargando fichas"\)>=0/);
});
