import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("si el respaldo queda pendiente (la ficha cambió durante la copia) se reintenta solo, con espera creciente y tope", () => {
  const ui = readFileSync(new URL("../components/google-drive-backup.tsx", import.meta.url), "utf8");
  assert.match(ui, /retries\.current < 3/);
  assert.match(ui, /setTimeout\(\(\) => \{[\s\S]{0,80}void syncQueue\(\)/);
  assert.match(ui, /8000 \* retries\.current/);
  assert.match(ui, /if \(retryTimer\.current\) clearTimeout\(retryTimer\.current\);\s*window\.removeEventListener/);
});
