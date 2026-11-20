import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VALIDATOR_URL, certificateKey, cleanQrPayload, isOfficialQr, ownsKey, printableQr, qrCaption, validatorUrlFromCode } from "../lib/prestador-qr.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("QR: solo se imprime si lleva a un sitio de la Superintendencia de Salud (https)", () => {
  assert.equal(isOfficialQr("https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/?id=AbC12xYz9"), true);
  assert.equal(isOfficialQr("https://rnpi.superdesalud.gob.cl/"), true);
  assert.equal(isOfficialQr("https://supersalud.gob.cl/x"), true);
  assert.equal(isOfficialQr("http://emisorcertificados.superdesalud.gob.cl/"), false, "sin https no");
  assert.equal(isOfficialQr("https://superdesalud.gob.cl.evil.com/"), false);
  assert.equal(isOfficialQr("https://evilsuperdesalud.gob.cl/"), false);
  assert.equal(isOfficialQr("AbC12xYz9"), false);
  assert.equal(isOfficialQr("javascript:alert(1)"), false);
});

test("QR: limpia el contenido leído", () => {
  assert.equal(cleanQrPayload("  https://rnpi.superdesalud.gob.cl/\n"), "https://rnpi.superdesalud.gob.cl/");
  assert.equal(cleanQrPayload("a\u0000b"), "ab");
  assert.equal(cleanQrPayload(42), "");
  assert.equal(cleanQrPayload("x".repeat(1001)), "");
});

test("QR: respaldo = validador oficial con el código de validación (la página lee ?id=)", () => {
  assert.equal(VALIDATOR_URL, "https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/");
  assert.equal(validatorUrlFromCode("AbC12xYz9"), `${VALIDATOR_URL}?id=AbC12xYz9`);
  assert.equal(validatorUrlFromCode(""), "");
  assert.equal(validatorUrlFromCode("abc"), "", "muy corto");
  assert.equal(validatorUrlFromCode("ABCDEFGHIJK"), "", "el validador acepta hasta 10 caracteres");
  assert.equal(validatorUrlFromCode("ab-12 34"), "");
});

test("QR impreso: primero el QR oficial leído; si no, el validador; si no hay código, nada", () => {
  const official = "https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/?id=ZZ12345678";
  assert.deepEqual(printableQr({ qrPayload: official, validationCode: "AbC12xYz9" }), { url: official, from: "qr" });
  assert.deepEqual(printableQr({ qrPayload: "https://otro-sitio.cl/x", validationCode: "AbC12xYz9" }), { url: `${VALIDATOR_URL}?id=AbC12xYz9`, from: "codigo" });
  assert.deepEqual(printableQr({ qrPayload: "", validationCode: "" }), { url: "", from: "" });
  assert.equal(qrCaption("12345"), "Verifique la habilitación del profesional – Superintendencia de Salud, REG-SIS N° 12345");
});

test("archivos en R2: siempre bajo la carpeta del propio profesional", () => {
  assert.equal(certificateKey("p1", "u", "pdf"), "prestador/p1/u.pdf");
  assert.equal(certificateKey("p1", "u", "qr"), "prestador/p1/u-qr.png");
  assert.equal(ownsKey("p1", "prestador/p1/u.pdf"), true);
  assert.equal(ownsKey("p1", "prestador/p10/u.pdf"), false);
  assert.equal(ownsKey("p1", "prestador/p2/u.pdf"), false);
  assert.equal(ownsKey("p1", "prestador/p1/../p2/u.pdf"), false);
  assert.equal(ownsKey("p1", ""), false);
});

test("el certificado PDF se guarda (R2), se ve, descarga y reemplaza; migración aditiva", () => {
  const route = read("app/api/prestador/route.ts");
  assert.match(route, /store\.put\(key, pdf\.bytes, \{ httpMetadata: \{ contentType: "application\/pdf" \}/);
  assert.match(route, /certificateKey\(personalId, id, "pdf"\)/);
  assert.match(route, /ownsKey\(personalId, old\)/, "al reemplazar solo borra archivos propios");
  assert.match(route, /for \(const key of written\) await bucket\(\)\?\.delete\(key\)/, "si falla la base, no deja archivos huérfanos");
  assert.doesNotMatch(route, /descarta/);
  const db = read("app/prestador-db.ts");
  assert.match(db, /ALTER TABLE professional_registrations ADD COLUMN \$\{column\}/);
  assert.doesNotMatch(db, /DROP |RENAME /i);
  for (const column of ["cert_key", "cert_name", "cert_size", "cert_uploaded_at", "qr_key", "qr_payload", "qr_source"]) assert.match(db, new RegExp(`"${column} `));
  assert.match(db, /WHERE professional_id = \?"\)\s*\.bind\(qr\.key, qr\.payload, qr\.source, new Date\(\)\.toISOString\(\), professionalId\)/);
  const file = read("app/api/prestador/certificado/route.ts");
  assert.match(file, /loadRegistration\(personalId\)/);
  assert.match(file, /ownsKey\(personalId, key\)/);
  assert.match(file, /descargar/);
  assert.match(file, /private, no-store/);
  const qr = read("app/api/prestador/qr/route.ts");
  assert.match(qr, /request\.headers\.get\("origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(qr, /source: "imagen"/);
});

test("el QR se lee del PDF en el teléfono (pdf.js + jsQR) y la tarjeta ya no dice que se descarta", () => {
  const reader = read("components/certificate-qr.ts");
  assert.match(reader, /import\("unpdf"\)/);
  assert.match(reader, /import\("jsqr"\)/);
  assert.match(reader, /page\.render/);
  const card = read("components/prestador-card.tsx");
  assert.doesNotMatch(card, /descarta|no se guarda/i);
  assert.match(card, /se guarda de forma segura/);
  assert.match(card, /código QR se imprime en tus recetas y certificados/);
  assert.match(card, /\/api\/prestador\/certificado\?descargar=1/);
  assert.match(card, /Reemplazar certificado/);
  assert.match(card, /Subir foto del QR/);
  assert.match(card, /Pega su texto/, "el texto pegado sigue como respaldo");
  assert.match(read("components/profile-dialog.tsx"), /<PrestadorPanel\/>/);
  assert.match(read("components/professionals-panel.tsx"), /<PrestadorPanel\/>/);
  assert.match(JSON.parse(read("package.json")).dependencies.jsqr, /^\^1\./);
});

test("recetas y certificados: QR de habilitación arriba a la derecha (encabezado), con REG-SIS, sin romper la hoja Carta", () => {
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /size-\[2\.2cm\][^>]*data-testid="habilitacion-qr"/);
  assert.match(panel, /const reg: PublicRegistration \| null = doc\.registration \?\?/);
  assert.match(panel, /qrSvg\(reg\.qrUrl\)/);
  assert.match(panel, /title=\{qrCaption\(reg\.regSis\)\}/);
  assert.match(panel, /REG-SIS N° \{reg\.regSis\}/);
  const header = panel.slice(panel.indexOf('data-testid="document-header"'), panel.indexOf("</header>", panel.indexOf('data-testid="document-header"')));
  assert.match(header, /data-testid="habilitacion-row"/, "el QR va en el encabezado");
  assert.match(read("app/prestador-db.ts"), /qrUrl: printableQr\(/);
  assert.match(read("app/globals.css"), /@page\{size:letter;margin:10mm 12mm\}/);
});
