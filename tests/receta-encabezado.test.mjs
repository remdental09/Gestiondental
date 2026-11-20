import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanClinicalDocumentContent, cleanMedications, parseMedications } from "../lib/clinical-documents.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const panel = read("components/documentation-panel.tsx");
const header = panel.slice(panel.indexOf('data-testid="document-header"'), panel.indexOf("</header>", panel.indexOf('data-testid="document-header"')));

test("receta: el encabezado parte con la clínica y el dentista; «Receta médica» va abajo como subtítulo", () => {
  assert.ok(header.indexOf('data-testid="document-clinic"') < header.indexOf('data-testid="document-doctor"'));
  assert.match(header, /clinic\?\.clinicName/);
  assert.match(header, /\{doctorName\}/);
  assert.match(header, /RUT \{doctorRut\}/);
  assert.match(header, /\{professionLine\}/);
  assert.doesNotMatch(header, /doc\.title|activeDocument\.title/, "el título no está en el encabezado");
  assert.ok(panel.indexOf('data-testid="document-title"') > panel.indexOf("</header>", panel.indexOf('data-testid="document-header"')));
  assert.match(panel, /text-\[15px\][^"]*" data-testid="document-title"/, "subtítulo chico, no titular");
  assert.match(panel, /const professionLine = reg \? `\$\{reg\.profession\} \(\$\{registrationLine\(reg\)\}\)`/);
});

test("receta: el QR de la Superintendencia es obligatorio, sin opción para ocultarlo", () => {
  assert.match(panel, /const missingQr = prescription && !reg\?\.qrUrl;/);
  assert.match(panel, /missingQr \? <div[^>]*data-testid="receta-sin-qr"/);
  assert.match(panel, /const printBlocked = \(doc: SavedDocument\) => isPrescriptionKind\(doc\.kind\) && \(doc\.status === "borrador" \? !canIssueReceta : !doc\.registration\?\.qrUrl\)/);
  assert.equal((panel.match(/disabled=\{busy \|\| printBlocked\(activeDocument\)\}/g) ?? []).length, 2, "Imprimir y Guardar en PDF");
  assert.doesNotMatch(panel, /mostrarQr|showQr|ocultarQr|hideQr|includeQr/i);
  const emitir = read("app/api/documentos/emitir/route.ts");
  assert.match(emitir, /if \(!publicRegistration\(reg\)\.qrUrl\) return fail\(/);
  assert.match(emitir, /document: await withRegistration\(issued\)/, "la respuesta trae la habilitación (antes la receta recién emitida salía sin QR)");
  assert.match(read("app/api/documentos/route.ts"), /document: \{ \.\.\.document, documentMark, registration, authorTitle: profile\?\.title \?\? null \}/);
});

test("receta: paciente con Nro. de documento, edad, dirección y fecha; firma con nombre, RUT y REG-SIS", () => {
  for (const label of ["Paciente:", "Nro. de documento:", "Edad:", "Dirección:", "Fecha emisión:"]) assert.ok(panel.includes(label), label);
  const signature = panel.slice(panel.indexOf('data-testid="signature-block"'), panel.indexOf('data-testid="signature-name"') + 200);
  assert.match(signature, /\{doctorName\}/);
  assert.match(panel, /data-testid="signature-name"><p className="font-semibold">\{doctorName\}<\/p>\{doctorRut && <p>RUT \{doctorRut\}<\/p>\}\{reg && <p>\{professionLine\}<\/p>\}/);
});

test("medicamentos estructurados: nombre, dosis, vía y cantidad; se limpia y descarta lo vacío", () => {
  const raw = JSON.stringify([{ nombre: " Ibuprofeno 400 mg ", dosis: "1 comprimido cada 8 horas por 3 días", via: "oral", cantidad: "9 comprimidos", extra: "x" }, { nombre: "", dosis: "nada" }]);
  assert.deepEqual(parseMedications(raw), [{ nombre: "Ibuprofeno 400 mg", dosis: "1 comprimido cada 8 horas por 3 días", via: "oral", cantidad: "9 comprimidos" }]);
  assert.equal(cleanMedications("no es json"), "");
  assert.equal(cleanMedications(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ nombre: `M${i}` })))).match(/nombre/g).length, 15);
  const content = cleanClinicalDocumentContent("receta", { medicamentos: raw, prescripcion: "Paracetamol 500 mg — si hay dolor" });
  assert.equal(JSON.parse(content.medicamentos).length, 1);
  assert.equal(content.prescripcion, "Paracetamol 500 mg — si hay dolor", "el texto libre sigue funcionando");
  assert.equal(cleanClinicalDocumentContent("receta_magistral", { medicamentos: raw }).medicamentos, undefined);
  assert.match(panel, /Cantidad a dispensar: \{item\.cantidad\}/);
  assert.match(panel, /\{medicationLine\(item\)\}/, "pauta + «Vía: …» generadas por medicationLine");
  assert.match(panel, /<MedicationEditor value=\{content\.medicamentos/);
});
