import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signRequestEmail, signedCopyEmail } from "../lib/appointment-mail.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("el correo de firma trae el botón «Revisar y firmar» con el enlace y sin inyectar HTML", () => {
  const url = "https://speakdent.cl/api/firmar?t=abc123";
  const mail = signRequestEmail({ patientName: "Ana <b>Pérez", clinicName: "Clínica <i>X", doctorName: "Dr. Prueba", url, hours: 72 });
  assert.match(mail.subject, /Consentimiento informado para firmar/);
  assert.match(mail.html, /Revisar y firmar/);
  assert.ok(mail.html.includes(`href="${url}"`));
  assert.ok(mail.text.includes(url));
  assert.match(mail.html, /72 horas/);
  assert.doesNotMatch(mail.html, /<b>Pérez|<i>X/);
});

test("el correo de copia firmada lleva el código y no mezcla saltos de línea en el asunto", () => {
  const mail = signedCopyEmail({ patientName: "Ana", clinicName: "Clínica\nOculta: x", doctorName: "Dr. P", code: "52D8-46F4-E1B8" });
  assert.match(mail.subject, /firmado/);
  assert.doesNotMatch(mail.subject, /[\r\n]/);
  assert.match(mail.html, /52D8-46F4-E1B8/);
  assert.match(mail.text, /52D8-46F4-E1B8/);
});

test("la acción «correo» comprueba correo y remitente antes de crear el enlace, y cancela el enlace si el envío falla", () => {
  const route = read("app/api/documentos/firma/route.ts");
  assert.match(route, /action !== "correo"/);
  assert.ok(route.indexOf("await signMailTarget(") < route.indexOf("tokenHash: await sha256Hex(token)"), "primero se valida el destino");
  assert.match(route, /sendSignRequestMail\(user\.userId/);
  assert.match(route, /status: "cancelado", tokenHash: null \}\)\.where\(eq\(consentSignatures\.id, row!\.id\)\)/);
});

test("al firmar por enlace se envía la copia en PDF sin poder hacer fallar la firma", () => {
  const route = read("app/api/firmar/route.ts");
  assert.ok(route.indexOf("await getDb().update(consentSignatures)") < route.indexOf("sendSignedCopy("), "la copia sale después de guardar la firma");
  assert.match(route, /try \{ await sendSignedCopy\(row\.ownerId, doc\.id[\s\S]*?copySent = true; \} catch/);
  assert.match(route, /copySent/);
  assert.match(route, /También te enviamos una copia firmada en PDF a tu correo\./);
});

test("la ficha ofrece «Enviar por correo para firmar» y se deshabilita sin correo", () => {
  const card = read("components/consent-signing.tsx");
  assert.match(card, /data-testid="consent-sign-mail"/);
  assert.match(card, /disabled=\{busy \|\| !patient\.email\}/);
  assert.match(card, /action: "correo"/);
});

test("la copia usa el PDF ya firmado del consentimiento y el correo de la ficha", () => {
  const pdf = read("app/document-pdf.ts");
  assert.match(pdf, /export async function sendSignedCopy[\s\S]*renderDocumentPdf\(ownerId, documentId, origin\)[\s\S]*mailTarget\(ownerId, pdf\.patient\.email/);
});
