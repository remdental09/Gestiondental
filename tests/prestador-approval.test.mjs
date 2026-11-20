import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTO_REVIEWER, autoApproval, isDentist } from "../lib/prestador-approval.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Datos sintéticos con la estructura del certificado del RNPI (no son de una persona real).
const cert = { regSis: "123456", run: "11111111-1", fullName: "Persona De Prueba", profession: "Cirujano Dentista", specialties: ["Implantología Buco Maxilofacial"], issuedOn: "2026-11-19", validationCode: "AbC12xYz9" };
const QR = "https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/?id=AbC12xYz9";

test("habilitación automática: dentista + código + QR oficial que coincide → habilitado", () => {
  assert.deepEqual(autoApproval(cert, QR), { approved: true, reasons: [] });
  assert.deepEqual(autoApproval(cert, ""), { approved: true, reasons: [] }, "sin QR sirve el enlace al validador con el código");
});

test("habilitación automática: profesión distinta → revisión, con el motivo exacto", () => {
  const out = autoApproval({ ...cert, profession: "Enfermera" }, QR);
  assert.equal(out.approved, false);
  assert.match(out.reasons.join(" "), /«Enfermera», no «Cirujano Dentista»/);
  assert.equal(isDentist("CIRUJANO-DENTISTA"), true);
  assert.equal(isDentist("Cirujano dentista"), true);
  assert.equal(isDentist("Técnico dental"), false);
});

test("habilitación automática: sin código válido o QR de otro certificado → revisión", () => {
  assert.match(autoApproval({ ...cert, validationCode: "" }, "").reasons.join(" "), /código de validación/);
  const other = autoApproval(cert, "https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/?id=ZZZ999zzz");
  assert.equal(other.approved, false);
  assert.match(other.reasons.join(" "), /no corresponde al código de validación/);
});

test("ruta: RUN distinto no se guarda; todo coincide → aprobado con revisor automático; revocación manual no se reactiva", () => {
  const route = read("app/api/prestador/route.ts");
  assert.match(route, /if \(!sameRun\(parsed\.data\.run, profile\.rut\)\) return json\(\{ error: `El RUN del certificado/);
  assert.match(route, /autoApproval\(parsed\.data/);
  assert.match(route, /previous\?\.status === "rechazado" && previous\.reviewed_by && previous\.reviewed_by !== AUTO_REVIEWER/);
  assert.match(route, /saveRegistration\([^)]*decision\)/);
  const db = read("app/prestador-db.ts");
  assert.match(db, /const status = approveNow \|\| keepApproved \? "aprobado" : "pendiente";/);
  assert.match(db, /review_note = excluded\.review_note/);
  assert.ok(AUTO_REVIEWER.startsWith("automático"));
});

test("tarjeta: en revisión muestra qué no coincidió; al habilitar avisa que ya puede emitir recetas", () => {
  const card = read("components/prestador-card.tsx");
  assert.match(card, /Qué no coincidió:/);
  assert.match(card, /Quedaste habilitado para emitir recetas/);
});

test("Mi perfil: «Guardar cambios» no queda gris sin cambios y explica qué se guarda solo", () => {
  const dialog = read("components/profile-dialog.tsx");
  assert.match(dialog, /type="submit" disabled=\{saving\}/);
  assert.doesNotMatch(dialog, /disabled=\{saving \|\| !changed\}/);
  assert.match(dialog, /if \(!changed\) \{[^}]*setDone\(/);
  assert.match(dialog, /el certificado de habilitación al subirlo/);
});
