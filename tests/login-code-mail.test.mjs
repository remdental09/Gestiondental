import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mail = readFileSync(new URL("../app/login-code-mail.ts", import.meta.url), "utf8");
const wrangler = readFileSync(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8");

test("el código sale de SpeakDent (codigo@speakdent.cl) y el Gmail conectado es solo respaldo", () => {
  assert.match(wrangler, /"send_email":\s*\[\{\s*"name":\s*"EMAIL"\s*\}\]/);
  assert.match(mail, /LOGIN_CODE_FROM = "codigo@speakdent\.cl"/);
  const viaBinding = mail.indexOf("binding.send(");
  const viaGmail = mail.indexOf("sendMailWithSender(");
  assert.ok(viaBinding > 0 && viaGmail > viaBinding, "primero el envío de SpeakDent, después el Gmail de respaldo");
  assert.match(mail.slice(viaBinding - 80, viaBinding + 200), /name: "SpeakDent"/);
});
