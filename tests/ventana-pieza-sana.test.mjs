import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toothPhotoFor } from "../lib/tooth-photos.ts";

const modal = readFileSync(new URL("../components/tooth-3d-modal.tsx", import.meta.url), "utf8");

test("la ventana de una pieza sana muestra la foto realista y no el modelo 3D", () => {
  assert.match(modal, /status === "Sin hallazgos" && findings\.length === 0 && !periodontalSites/);
  assert.match(modal, /data-testid="tooth-modal-photo"/);
  assert.match(modal, /data-testid="tooth-modal-toggle3d"/);
});

test("el modelo 3D sigue disponible con un clic y con hallazgos o periodontograma no se reemplaza", () => {
  assert.match(modal, /const \[show3d, setShow3d\] = useState\(false\)/);
  assert.match(modal, /Ver modelo 3D/);
  assert.match(modal, /healthyPhoto && !fullArch/);
});

test("la pieza superior (1.1) se muestra invertida y la inferior (4.1) no", () => {
  const upper = toothPhotoFor({ fdi: 11, status: "Sin hallazgos" });
  assert.equal(upper.upper, true);
  assert.equal(upper.transform, "scaleY(-1)");
  const lower = toothPhotoFor({ fdi: 41, status: "Sin hallazgos" });
  assert.equal(lower.upper, false);
  assert.equal(lower.transform, undefined);
  assert.equal(toothPhotoFor({ fdi: 21, status: "Sin hallazgos" }).transform, "scale(-1,-1)");
});
