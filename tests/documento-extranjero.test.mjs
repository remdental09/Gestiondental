import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asDocumentType, cleanForeignDocument, displayDocument, documentTypeOf, isValidChileanRut, isValidDocument, isValidForeignDocument, storedDocument } from "../lib/patient-document.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("el RUT chileno sigue exigiendo dígito verificador", () => {
  assert.equal(isValidChileanRut("12.345.678-5"), true);
  assert.equal(isValidChileanRut("12.345.678-9"), false);
  assert.equal(isValidDocument("12.345.678-9", "rut"), false);
  assert.equal(storedDocument("12.345.678-5", "rut"), "123456785");
});

test("documentos de otros países: Costa Rica, Guatemala, Panamá, Perú, Argentina, pasaportes", () => {
  for (const doc of ["1-0234-0567", "2547 69321 0101", "8-123-456", "PE-12345678", "30.123.456", "AB123456", "P1234567C", "N 123 456 789", "ÁÉ123456"]) {
    assert.equal(isValidForeignDocument(doc), true, doc);
    assert.equal(isValidDocument(doc, "extranjero"), true, doc);
  }
});

test("un documento extranjero no se limita a dígitos ni a la K", () => {
  assert.equal(cleanForeignDocument("ab-123.456 x"), "AB123456X");
  assert.equal(cleanForeignDocument("ÁÉ123"), "AE123");
  assert.equal(storedDocument("p1234567c", "extranjero"), "P1234567C");
  assert.equal(storedDocument("1-0234-0567", "extranjero"), "102340567");
});

test("rechaza documentos demasiado cortos, largos, sin números o vacíos", () => {
  for (const doc of ["", "12", "123", "ABCDEFG", "12345678901234567890123", "---"]) assert.equal(isValidForeignDocument(doc), false, doc);
  assert.equal(isValidForeignDocument("1234"), true);
  assert.equal(isValidForeignDocument("A".repeat(19) + "1"), true);
});

test("el tipo de documento por defecto es RUT y se reconoce el guardado", () => {
  assert.equal(asDocumentType(undefined), "rut");
  assert.equal(asDocumentType("otro"), "rut");
  assert.equal(asDocumentType("extranjero"), "extranjero");
  assert.equal(documentTypeOf("123456785"), "rut");
  assert.equal(documentTypeOf("AB123456"), "extranjero");
  assert.equal(documentTypeOf(""), "rut");
  assert.equal(documentTypeOf(null), "rut");
});

test("se muestra el RUT con formato y el documento extranjero limpio", () => {
  assert.equal(displayDocument("123456785"), "12.345.678-5");
  assert.equal(displayDocument("ab 123-456"), "AB123456");
  assert.equal(displayDocument("", "extranjero"), "");
});

test("el servidor valida y guarda según el tipo de documento (crear y editar paciente)", () => {
  const route = read("app/api/clinical/route.ts");
  assert.match(route, /asDocumentType\(input\.documentType\)/);
  assert.equal((route.match(/isValidDocument\(rutRaw, documentType\)/g) ?? []).length, 2);
  assert.equal((route.match(/storedDocument\(rutRaw, documentType\)/g) ?? []).length, 2);
});

test("el servidor MCP también acepta documentType al crear y actualizar", () => {
  const mcp = read("app/mcp/route.ts");
  assert.equal((mcp.match(/asDocumentType\(args\.documentType\)/g) ?? []).length, 2);
  assert.match(mcp, /storedDocument\(rutRaw, documentType\)/);
  assert.match(mcp, /enum: \["rut", "extranjero"\]/);
});

test("la inscripción, la edición y el dictado usan el selector de documento", () => {
  const page = read("app/page.tsx");
  assert.equal((page.match(/<PatientDocumentField/g) ?? []).length, 2);
  assert.match(page, /documentType:docType/);
  assert.match(read("components/global-dictation.tsx"), /<PatientDocumentField/);
  const field = read("components/patient-document-field.tsx");
  assert.match(field, /DOCUMENT_LABEL\.extranjero/);
  assert.match(field, /Costa Rica/);
  assert.match(read("lib/patient-document.ts"), /Documento extranjero \(DNI, cédula, DPI, pasaporte/);
});
