import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSENT_SPECIALTIES, CONSENT_TEMPLATES, consentTemplateContent, consentTemplateById, consentTemplatesOf } from "../lib/consent-templates.ts";
import { cleanClinicalDocumentContent } from "../lib/clinical-documents.ts";
import {
  SIGN_ACCEPTANCE, SIGN_LINK_HOURS, cleanSignatureImage, identityMatches, identityRequired, isSignLinkActive, shortPatientName,
  signLinkExpiry, signMessage, signUrl, signatureHash, sha256Hex, whatsappSignLink,
} from "../lib/consent-signature.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const png = (n = 800) => `data:image/png;base64,${"A".repeat(n)}`;
const base = { documentHash: "d".repeat(64), image: png(), signedAt: "2026-11-21T17:00:00.000Z", signerName: "Paciente de Prueba", signerRole: "paciente", signerRelation: "", method: "presencial" };

test("hay plantillas para cada especialidad del quehacer diario, con ids únicos", () => {
  const ids = CONSENT_TEMPLATES.map(template => template.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const specialty of ["Operatoria y restauradora", "Endodoncia", "Cirugía oral", "Implantología", "Periodoncia", "Rehabilitación oral y prótesis", "Ortodoncia", "Odontopediatría", "Urgencia"]) {
    assert.ok(CONSENT_SPECIALTIES.includes(specialty), specialty);
    assert.ok(consentTemplatesOf(specialty).length >= 1, specialty);
  }
  assert.equal(consentTemplateById("endodoncia-conductos")?.specialty, "Endodoncia");
  assert.equal(consentTemplateById("no-existe"), undefined);
});

test("cada plantilla llena los cinco campos y cabe en los límites del documento (no se trunca)", () => {
  for (const template of CONSENT_TEMPLATES) {
    const content = consentTemplateContent(template);
    const cleaned = cleanClinicalDocumentContent("consentimiento", content);
    for (const key of ["procedimiento", "descripcion", "riesgos", "alternativas", "declaracion"]) {
      assert.ok(content[key].trim().length > (key === "procedimiento" ? 8 : 20), `${template.id}.${key} vacío`);
      assert.equal(cleaned[key], content[key].trim(), `${template.id}.${key} excede el límite y se truncaría`);
    }
  }
});

test("las plantillas no inventan cifras: riesgos cualitativos, sin porcentajes ni garantías de resultado", () => {
  for (const template of CONSENT_TEMPLATES) {
    const text = `${template.descripcion} ${template.riesgos} ${template.alternativas} ${template.declaracion}`;
    assert.doesNotMatch(text, /\d+\s?%/, `${template.id} trae un porcentaje`);
    assert.doesNotMatch(text, /garantiz(a|amos) (el|un) (éxito|resultado)(?! )/i, `${template.id} promete resultado`);
  }
  assert.match(consentTemplateById("implantologia-implante").riesgos, /no puede garantizarse/);
  assert.match(consentTemplateById("endodoncia-conductos").riesgos, /no puede garantizarse/);
});

test("odontopediatría exige al representante legal; las demás hablan en primera persona", () => {
  assert.match(consentTemplateById("odontopediatria-tratamiento").declaracion, /representante legal/);
  for (const template of CONSENT_TEMPLATES.filter(item => item.specialty !== "Odontopediatría")) assert.match(template.declaracion, /^El profesional me explicó/);
});

test("el selector rellena el formulario y pide confirmación antes de reemplazar lo escrito", () => {
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /<ConsentTemplatePicker onPick=/);
  assert.match(panel, /¿Desea reemplazar lo que ya escribiste por esta plantilla\?/);
  assert.match(read("components/consent-template-picker.tsx"), /data-testid=\{`consent-template-\$\{template\.id\}`\}/);
});

test("la imagen de la firma solo se acepta como PNG en base64 de tamaño razonable", () => {
  assert.equal(cleanSignatureImage(png()), png());
  assert.equal(cleanSignatureImage(png(10)), "", "demasiado chica: una firma vacía");
  assert.equal(cleanSignatureImage(png(300_000)), "", "demasiado grande");
  assert.equal(cleanSignatureImage(`data:image/svg+xml;base64,${"A".repeat(800)}`), "");
  assert.equal(cleanSignatureImage(`data:image/png;base64,${"A".repeat(800)}<script>`), "");
  assert.equal(cleanSignatureImage("javascript:alert(1)"), "");
  assert.equal(cleanSignatureImage(undefined), "");
});

test("la huella de la firma cambia si cambia el documento, la imagen, quién, cuándo o cómo", async () => {
  const hash = await signatureHash(base);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await signatureHash({ ...base }), hash);
  for (const change of [{ documentHash: "e".repeat(64) }, { image: png(801) }, { signedAt: "2026-11-21T17:00:01.000Z" }, { signerName: "Otra Persona" }, { signerRole: "representante" }, { signerRelation: "madre" }, { method: "enlace" }]) {
    assert.notEqual(await signatureHash({ ...base, ...change }), hash, JSON.stringify(Object.keys(change)));
  }
});

test("la huella también cubre el texto de la declaración que el firmante aceptó", async () => {
  assert.match(SIGN_ACCEPTANCE, /firma electrónica simple/);
  const source = read("lib/consent-signature.ts");
  assert.match(source, /SIGN_ACCEPTANCE\]\)\)/);
});

test("el enlace de firma sirve solo si está pendiente y no venció", () => {
  const now = new Date("2026-11-21T17:00:00.000Z");
  const expiry = signLinkExpiry(now);
  assert.equal(new Date(expiry).getTime() - now.getTime(), SIGN_LINK_HOURS * 3_600_000);
  assert.equal(isSignLinkActive({ status: "pendiente", tokenExpiresAt: expiry }, now), true);
  assert.equal(isSignLinkActive({ status: "pendiente", tokenExpiresAt: expiry }, new Date(now.getTime() + SIGN_LINK_HOURS * 3_600_000 + 1)), false);
  for (const status of ["firmado", "cancelado"]) assert.equal(isSignLinkActive({ status, tokenExpiresAt: expiry }, now), false);
  assert.equal(isSignLinkActive({ status: "pendiente", tokenExpiresAt: "" }, now), false);
  assert.equal(signUrl("https://speakdent.cl/", "TOKEN"), "https://speakdent.cl/api/firmar?t=TOKEN");
});

test("la identidad en el enlace compara los últimos 4 caracteres del documento, con RUT o documento extranjero", () => {
  assert.equal(identityRequired("123456785"), true);
  assert.equal(identityRequired(null), false);
  assert.equal(identityRequired("12"), false);
  assert.equal(identityMatches("6785", "123456785"), true);
  assert.equal(identityMatches("12.345.678-5", "123456785"), true, "con puntos y guion");
  assert.equal(identityMatches("6.785", "123456785"), true);
  assert.equal(identityMatches("0000", "123456785"), false);
  assert.equal(identityMatches("785", "123456785"), false, "faltan caracteres");
  assert.equal(identityMatches("", "123456785"), false);
  assert.equal(identityMatches("c789", "AB-C789"), true, "documento extranjero, sin distinguir mayúsculas");
  assert.equal(identityMatches("", null), true, "sin documento en la ficha no se puede exigir");
});

test("la página del enlace muestra un nombre abreviado, nunca el RUT, y el mensaje saluda por el nombre de pila", () => {
  assert.equal(shortPatientName("María José Pérez Soto"), "María S.");
  assert.equal(shortPatientName("Ana"), "Ana");
  assert.equal(shortPatientName(""), "");
  const message = signMessage("María José Pérez Soto", "Clínica Sonrisa", "https://speakdent.cl/api/firmar?t=X");
  assert.match(message, /^Hola María, /);
  assert.match(message, /Clínica Sonrisa/);
  assert.match(message, /72 horas/);
  assert.match(message, /https:\/\/speakdent\.cl\/api\/firmar\?t=X$/);
  const route = read("app/api/firmar/route.ts");
  assert.doesNotMatch(route, /patient\.rut\b[^)]*esc\(/, "no se imprime el RUT");
  assert.match(route, /shortPatientName\(patient\.name\)/);
});

test("WhatsApp: celular chileno de 9 dígitos, con código de país o inválido", () => {
  const link = whatsappSignLink("+56 9 8765 4321", "Hola mundo");
  assert.equal(link, "https://wa.me/56987654321?text=Hola%20mundo");
  assert.equal(whatsappSignLink("987654321", "x")?.startsWith("https://wa.me/56987654321"), true);
  assert.equal(whatsappSignLink("", "x"), null);
  assert.equal(whatsappSignLink("123", "x"), null);
});

test("el servidor: firmar exige documento emitido y vigente, guarda solo la huella del código y una firma por documento", () => {
  const route = read("app/api/documentos/firma/route.ts");
  assert.match(route, /doc\.kind !== "consentimiento"/);
  assert.match(route, /doc\.status !== "emitido" \|\| !doc\.contentHash \|\| doc\.revokedAt/);
  assert.match(route, /tokenHash: await sha256Hex\(token\)/);
  assert.doesNotMatch(route, /tokenHash: token\b/);
  assert.match(route, /documentHash: doc\.contentHash/);
  assert.match(route, /UNIQUE/);
  assert.match(route, /Origen no permitido/);
  assert.match(route, /ownerId, user\.userId|eq\(patientDocuments\.ownerId, user\.userId\)/);
  const db = read("app/consent-signature-db.ts");
  assert.match(db, /CREATE UNIQUE INDEX IF NOT EXISTS consent_signatures_one_signed_idx ON consent_signatures \(document_id\) WHERE status = 'firmado'/);
  assert.doesNotMatch(db, /tokenHash/, "la vista del clínico nunca incluye el código del enlace");
});

test("la página pública: enlace secreto de un solo uso, protegida por CSP con nonce y por el bypass del worker", () => {
  const route = read("app/api/firmar/route.ts");
  assert.match(route, /isSignLinkActive\(row\)/);
  assert.match(route, /doc\.status !== "emitido"/);
  assert.match(route, /tokenHash: null/, "el enlace se invalida al firmar");
  assert.match(route, /eq\(consentSignatures\.status, "pendiente"\)/, "no firma dos veces");
  assert.match(route, /script-src 'nonce-/);
  assert.match(route, /frame-ancestors 'none'/);
  assert.match(route, /identityMatches\(body\.identity, patient\.rut\)/);
  const worker = read("worker.ts");
  assert.match(worker, /path === "\/api\/firmar" && \(request\.method === "GET" \|\| request\.method === "HEAD" \|\| request\.method === "POST"\)/);
  assert.match(worker, /USER_ID_HEADER, USER_EMAIL_HEADER/, "se borran las cabeceras de identidad entrantes");
});

test("la verificación pública informa la firma sin mostrar al paciente ni su firma, y detecta alteraciones", () => {
  const route = read("app/api/verificar/route.ts");
  assert.match(route, /Sin firma del paciente registrada/);
  assert.match(route, /Registro de la firma alterado/);
  assert.match(route, /documentHash: doc\.contentHash/);
  assert.doesNotMatch(route, /signed\.image\)|signerName\)\}/, "no se muestra la imagen ni el nombre del firmante");
  assert.doesNotMatch(route, /import[^\n]*\bpatients\b/);
});

test("la firma aparece en el documento impreso y la ficha la lee junto a los documentos", () => {
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /doc\.signature\?\.status === "firmado" && <div[^>]*><PatientSignatureImage/);
  assert.match(panel, /Firma electrónica simple\./);
  assert.match(panel, /<ConsentSigningCard key=\{activeDocument\.id\} documentId=\{activeDocument\.id\}/);
  assert.equal((panel.match(/Firma del paciente/g) ?? []).length, 1);
  assert.match(read("app/api/documentos/route.ts"), /signature: signatures\.get\(row\.document\.id\) \?\? null/);
});

test("el respaldo y la descarga incluyen la firma; el código del enlace nunca sale de la base", () => {
  const backup = read("app/drive-backup.ts");
  assert.match(backup, /eq\(consentSignatures\.status, "firmado"\)/);
  assert.match(backup, /signatureHash/);
  assert.doesNotMatch(backup, /\.image/, "el respaldo de Drive lleva metadatos y huella, no la imagen (límite de tamaño)");
  assert.match(read("lib/backup-markdown.ts"), /\*\*Firma del paciente:\*\*/);
  const exportRoute = read("app/api/clinical/export/route.ts");
  assert.match(exportRoute, /tokenHash: _token/);
  assert.match(exportRoute, /consentSignatures: signatureRows/);
});

test("hay migración Drizzle con índice único parcial y es idempotente", () => {
  const sql = read("drizzle/0011_firma_consentimiento.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `consent_signatures`/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS `consent_signatures_one_signed_idx`[\s\S]*WHERE `status` = 'firmado'/);
  assert.match(read("drizzle/meta/_journal.json"), /0011_firma_consentimiento/);
  assert.match(read("db/schema.ts"), /export const consentSignatures = sqliteTable\("consent_signatures"/);
});

test("el hash SHA-256 auxiliar coincide con el valor conocido", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("la tarjeta de firma se reinicia al cambiar de documento (key por id)", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8"), /<ConsentSigningCard key=\{activeDocument\.id\}/);
});
