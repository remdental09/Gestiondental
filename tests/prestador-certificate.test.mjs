import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRun, parsePrestadorCertificate, registrationLine, sameRun } from "../lib/prestador-certificate.ts";

// Datos FICTICIOS: nunca poner datos reales de profesionales o pacientes en el repositorio.
const sample = ({ run = "11111111-1", reg = "12345", date = "19 de Noviembre de 2026", code = "AbC12xYz9" } = {}) => `SUPERINTENDENCIA DE SALUD
código validación:
${code}
CERTIFICADO DE INSCRIPCIÓN
EN EL REGISTRO NACIONAL
DE PRESTADORES INDIVIDUALES DE SALUD
Certifico que en el Registro Nacional de Prestadores Individuales de Salud que mantiene esta Superintendencia de Salud, figura, bajo el N° ${reg}, la siguiente inscripción:
Fecha de registro: 01/03/2010
RUN: ${run}
Nombre Completo: Paula Ejemplo Prueba
Sexo: Femenino
Nacionalidad: Chilena
Fecha nacimiento: 01/01/1980
Orden Profesional:
- Cirujano Dentista:
Posee título de Cirujano Dentista otorgado por la Universidad de Chile emitido el 09/11/2004
Especialidad Certificada:
- Implantología Buco Maxilofacial:
Posee título de especialista en Implantología Buco Maxilofacial otorgado por la Universidad de Chile.
Profesional se encuentra legalmente habilitado para emitir licencias médicas.
Otorgado en Santiago, con fecha ${date}`;
const today = new Date("2026-11-20T12:00:00Z");

test("lee solo los datos necesarios del certificado", () => {
  const result = parsePrestadorCertificate(sample(), today);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { regSis: "12345", run: "11111111-1", fullName: "Paula Ejemplo Prueba", profession: "Cirujano Dentista", specialties: ["Implantología Buco Maxilofacial"], issuedOn: "2026-11-19", validationCode: "AbC12xYz9" });
  const serialized = JSON.stringify(result.data);
  for (const forbidden of ["Femenino", "Chilena", "01/01/1980", "1980"]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(registrationLine(result.data), "REG-SIS Nº: 12345");
});

test("rechaza lo que no es un certificado, un RUN inválido, uno vencido o futuro", () => {
  assert.equal(parsePrestadorCertificate("Factura electrónica N° 12", today).ok, false);
  assert.match(parsePrestadorCertificate(sample({ run: "11111111-2" }), today).error, /RUN/);
  assert.match(parsePrestadorCertificate(sample({ date: "01 de Enero de 2026" }), today).error, /más de 180 días/);
  assert.match(parsePrestadorCertificate(sample({ date: "25 de Diciembre de 2026" }), today).error, /futura/);
  assert.equal(parsePrestadorCertificate(sample({ reg: "" }).replace(/bajo el N° /, "bajo el "), today).ok, false);
});

test("el texto copiado desde un visor (sin encabezado ni saltos de línea) también se lee; el código de validación es opcional", () => {
  const flat = sample().split("\n").slice(3).join(" ").replace(/\s+/g, " ");
  const result = parsePrestadorCertificate(flat, today);
  assert.equal(result.ok, true);
  assert.equal(result.data.regSis, "12345");
  assert.equal(result.data.validationCode, "");
  assert.equal(result.data.profession, "Cirujano Dentista");
});

test("el RUN se compara con guion, sin puntos y con DV en mayúscula", () => {
  assert.equal(normalizeRun("13.051.751-k"), "13051751-K");
  assert.equal(normalizeRun("13051751K"), "13051751-K");
  assert.equal(normalizeRun("abc"), "");
  assert.equal(sameRun("11.111.111-1", "11111111-1"), true);
  assert.equal(sameRun("", ""), false);
  assert.equal(sameRun("11111111-1", "22222222-2"), false);
});

import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("solo un prestador aprobado emite recetas, y el panel de revisión es solo del desarrollador", () => {
  const emitir = read("app/api/documentos/emitir/route.ts");
  assert.match(emitir, /requiresHabilitacionQr\(doc\.kind\)[\s\S]*loadRegistration\(doc\.createdBy\)[\s\S]*!== "aprobado"/);
  assert.match(emitir, /403/);
  const review = read("app/api/desarrollador/prestadores/route.ts");
  assert.match(review, /isDeveloperEmail/);
  assert.match(review, /Indica el motivo del rechazo/);
  const upload = read("app/api/prestador/route.ts");
  assert.match(upload, /sameRun\(parsed\.data\.run, profile\.rut\)/);
  assert.match(upload, /store\.put\(key, pdf\.bytes/); // el PDF original se GUARDA (R2), no se descarta
  assert.doesNotMatch(upload, /descarta el archivo/);
  assert.match(upload, /application\/json/); // también acepta el texto pegado
});

test("los respaldos y la exportación aseguran las columnas antes de leer los documentos", () => {
  assert.match(read("app/drive-backup.ts"), /ensureDocumentIssuanceColumns\(\)\.then/);
  assert.match(read("app/api/clinical/export/route.ts"), /ensureDocumentIssuanceColumns\(\)\.then/);
});

test("tolera variantes de copiado: número, R.U.N., fecha de nacimiento y fecha con «del»", () => {
  const variant = sample({ date: "19 de noviembre del 2026" })
    .replace("bajo el N° 12345", "bajo el número 12345").replace("RUN:", "R.U.N.:").replace("Fecha nacimiento:", "Fecha de nacimiento:");
  const result = parsePrestadorCertificate(variant, today);
  assert.equal(result.ok, true);
  assert.equal(result.data.regSis, "12345");
  assert.equal(result.data.issuedOn, "2026-11-19");
  assert.equal(parsePrestadorCertificate(sample({ date: "19/11/2026" }), today).data.issuedOn, "2026-11-19");
});

test("el error dice qué datos no se pudieron leer", () => {
  const broken = sample().replace(/Nombre Completo:[^\n]*\n/, "").replace(/Otorgado en[^\n]*/, "");
  const result = parsePrestadorCertificate(broken, today);
  assert.equal(result.ok, false);
  assert.match(result.error, /nombre, fecha de otorgamiento/);
  assert.doesNotMatch(result.error, /RUN|registro/);
});

// Orden que entrega el extractor de PDF del servidor: primero los valores y al final la lista de etiquetas. Datos FICTICIOS.
const VALORES_PRIMERO = `CERTIFICADO DE INSCRIPCIÓN
EN EL REGISTRO NACIONAL
DE PRESTADORES INDIVIDUALES DE SALUD
código validación:
AbC12xYz9
Otorgado en Santiago, con fecha 19 de Noviembre de 2026
- Implantología Buco Maxilofacial:
Posee título de especialista en Implantología Buco Maxilofacial otorgado por la Universidad de Chile,
emitido con fecha 01/01/2012.
Especialidad Certificada:
- Cirujano Dentista:
Posee título de Cirujano Dentista otorgado por la Universidad de Chile emitido el 09/11/2004
Orden Profesional:
01/03/2010
11111111-1
Paula Ejemplo Prueba
Femenino
Chilena
01/01/1980
Fecha de registro:
RUN:
Nombre Completo:
Sexo:
Nacionalidad:
Fecha nacimiento:
Certifico que en el Registro Nacional de Prestadores Individuales de Salud que mantiene esta
Superintendencia de Salud, en la forma prevista, figura, bajo el N° 12345, la siguiente inscripción:`;

test("lee el certificado cuando el PDF entrega los valores antes que las etiquetas", () => {
  const result = parsePrestadorCertificate(`SUPERINTENDENCIA DE SALUD\n${VALORES_PRIMERO}`, today);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.data, { regSis: "12345", run: "11111111-1", fullName: "Paula Ejemplo Prueba", profession: "Cirujano Dentista", specialties: ["Implantología Buco Maxilofacial"], issuedOn: "2026-11-19", validationCode: "AbC12xYz9" });
  assert.equal(JSON.stringify(result.data).includes("Femenino"), false);
});
