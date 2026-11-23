import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../components/google-drive-backup.tsx", import.meta.url), "utf8");
test("si la autorización de Drive venció, el panel ofrece volver a conectarla", () => {
  assert.match(src, /invalid_grant\|venció\|fue rechazada/);
  assert.ok(src.includes('data-testid="drive-reconnect"') && src.includes('href="/api/drive/connect"'));
});

test("el aviso de respaldo ocupa una línea y el detalle aparece al pasar el ratón; los avisos de reconexión y fallo siguen visibles", () => {
  const section = src.slice(src.indexOf('data-testid="drive-backup-status"'));
  const details = section.indexOf('data-testid="drive-backup-details"');
  assert.ok(details > 0);
  assert.match(section.slice(details - 200, details + 120), /hidden[^"]*group-hover:block[^"]*group-focus-within:block/);
  const visible = section.slice(0, details);
  assert.match(visible, /Respaldo automático activo en/);
  assert.match(visible, /drive-reconnect/, "reconectar sigue a la vista");
  assert.match(visible, /El último respaldo falló/, "un fallo no queda escondido");
  const hidden = section.slice(details);
  assert.match(hidden, /Copia adicional en/);
  assert.match(hidden, /drive-last-check/);
  assert.match(hidden, /Agregar otra cuenta de Drive/);
});
