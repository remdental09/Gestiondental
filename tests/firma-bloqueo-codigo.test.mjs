import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_ATTEMPTS, canResend, changesSavedMark, cleanCode, isCodeShape, isUnlocked, judgeAttempt, newUnlockCode, signatureChangedEmail, unlockCodeEmail } from "../lib/signature-lock.ts";

const row = (extra = {}) => ({ code_hash: "h", expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 0, unlocked_until: "", last_sent_at: "", ...extra });

test("el código tiene 6 dígitos y se limpia", () => {
  for (let i = 0; i < 200; i++) assert.match(newUnlockCode(), /^\d{6}$/);
  assert.equal(newUnlockCode(() => new Uint32Array([7])), "000007");
  // Un valor en la zona sesgada se descarta y se vuelve a sortear.
  const draws = [4_294_000_000, 4_294_967_295, 12];
  assert.equal(newUnlockCode(() => new Uint32Array([draws.shift()])), "000012");
  assert.equal(cleanCode(" 12 34-56 "), "123456");
  assert.equal(isCodeShape("12345"), false);
});

test("intentos: correcto, incorrecto, vencido, bloqueado y sin código", () => {
  const now = Date.now();
  assert.equal(judgeAttempt(row(), true, now), "ok");
  assert.equal(judgeAttempt(row(), false, now), "wrong");
  assert.equal(judgeAttempt(row({ expires_at: new Date(now - 1).toISOString() }), true, now), "expired");
  assert.equal(judgeAttempt(row({ attempts: MAX_ATTEMPTS }), true, now), "blocked");
  assert.equal(judgeAttempt(row({ code_hash: "" }), true, now), "none");
  assert.equal(judgeAttempt(null, true, now), "none");
});

test("desbloqueo vigente, reenvío y cuándo un guardado cambia la firma", () => {
  const now = Date.now();
  assert.equal(isUnlocked(row({ unlocked_until: new Date(now + 1000).toISOString() }), now), true);
  assert.equal(isUnlocked(row({ unlocked_until: new Date(now - 1000).toISOString() }), now), false);
  assert.equal(isUnlocked(row(), now), false);
  assert.equal(canResend(row({ last_sent_at: new Date(now - 10_000).toISOString() }), now), false);
  assert.equal(canResend(row({ last_sent_at: new Date(now - 61_000).toISOString() }), now), true);
  assert.equal(changesSavedMark("", "data:a"), false);
  assert.equal(changesSavedMark("data:a", "data:a"), false);
  assert.equal(changesSavedMark("data:a", "data:b"), true);
  assert.equal(changesSavedMark("data:a", ""), true);
});

test("los correos llevan el código y el aviso", () => {
  const mail = unlockCodeEmail("123456");
  assert.match(mail.subject, /123456/);
  assert.match(mail.html, /123456/);
  assert.match(signatureChangedEmail("cambiada", "21-11-26 19:30").text, /cambiada/);
});

test("el servidor exige el código para cambiar o quitar la firma y la archiva", () => {
  const route = readFileSync(new URL("../app/api/documentos/imagen/route.ts", import.meta.url), "utf8");
  assert.match(route, /changesSavedMark\(saved, mark\)/);
  assert.match(route, /if \(changes && !isUnlocked\(await loadLock\(professionalId\), now\)\) return Response\.json\(\{[^}]*locked: true \}, \{ status: 403/);
  assert.match(route, /archiveMark\(/);
  assert.match(route, /consumeUnlock\(/);
  const codigo = readFileSync(new URL("../app/api/documentos/imagen/codigo/route.ts", import.meta.url), "utf8");
  assert.match(codigo, /to: user\.email\.trim\(\)/);
  assert.match(codigo, /countAttempt\(/);
  assert.doesNotMatch(codigo, /json\(\{[^}]*\bcode\b[^}]*\}\)/); // el código nunca vuelve en la respuesta
});

test("la pantalla muestra «Firma protegida» y pide el código", () => {
  const ui = readFileSync(new URL("../components/signature-editor.tsx", import.meta.url), "utf8");
  assert.match(ui, /Firma protegida/);
  assert.match(ui, /data-testid="signature-code"/);
  assert.match(ui, /pointer-events-none/);
});
