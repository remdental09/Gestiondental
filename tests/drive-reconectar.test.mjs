import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../components/google-drive-backup.tsx", import.meta.url), "utf8");
test("si la autorización de Drive venció, el panel ofrece volver a conectarla", () => {
  assert.match(src, /invalid_grant\|venció\|fue rechazada/);
  assert.ok(src.includes('data-testid="drive-reconnect"') && src.includes('href="/api/drive/connect"'));
});
