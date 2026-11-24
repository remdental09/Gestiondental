import test from "node:test";
import assert from "node:assert/strict";

test("el código y el aviso de firma/timbre salen de SpeakDent y no exigen el correo a pacientes de la Agenda", async () => {
  const { readFile } = await import("node:fs/promises");
  const codigo = await readFile(new URL("../app/api/documentos/imagen/codigo/route.ts", import.meta.url), "utf8");
  const imagen = await readFile(new URL("../app/api/documentos/imagen/route.ts", import.meta.url), "utf8");
  const mail = await readFile(new URL("../app/login-code-mail.ts", import.meta.url), "utf8");
  assert.doesNotMatch(codigo, /Primero conecta el correo de envío/);
  assert.doesNotMatch(codigo, /getSender/);
  assert.match(codigo, /sendSystemMail/);
  assert.match(imagen, /sendSystemMail/);
  assert.match(mail, /export async function sendSystemMail/);
});
