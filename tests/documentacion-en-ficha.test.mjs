import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8");

test("la ficha tiene un botón Documentación junto a Anamnesis que despliega el panel del paciente", () => {
  assert.match(page, /data-testid="documentation-button"/);
  assert.match(page, /embeddedPatientId=\{patient\.id\}/);
  assert.ok(page.indexOf('data-testid="documentation-button"') < page.indexOf("<AnamnesisButton"));
});

test("Documentación también está en el menú lateral y busca al paciente por nombre o RUT", () => {
  assert.match(page, /\{name:"Documentación"/);
  assert.match(page, /section==="Documentación"&&<Suspense/);
  assert.match(panel, /data-testid="documentation-patient-search"/);
  assert.match(panel, /Buscar paciente por nombre o RUT/);
  assert.doesNotMatch(panel, /aria-label="Elegir paciente"/);
});

test("el panel embebido no muestra selector de paciente", () => {
  assert.match(panel, /embeddedPatientId/);
  assert.match(panel, /\{!embedded && <section className="surface">/);
});

test("el menú ofrece receta médica, receta magistral, orden médica, certificado y consentimiento", async () => {
  const lib = readFileSync(new URL("../lib/clinical-documents.ts", import.meta.url), "utf8");
  for (const kind of ["receta", "receta_magistral", "orden", "certificado", "consentimiento"]) assert.match(lib, new RegExp(`"${kind}"`));
  for (const label of ["Receta médica", "Receta magistral", "Orden médica", "Certificado médico"]) assert.match(lib, new RegExp(label));
  assert.match(panel, /data-testid="documentation-menu"/);
  assert.match(lib, /isPrescriptionKind[\s\S]*receta_magistral/);
});

test("la vista previa tiene Guardar en PDF e Imprimir, también para borradores, y aparece arriba", () => {
  assert.match(panel, /data-testid="documentation-save-pdf"/);
  assert.match(panel, /data-testid="documentation-print-button"/);
  assert.match(panel, /const printDocument/);
  assert.ok(panel.indexOf('aria-label="Vista previa del documento"') < panel.indexOf('className="grid items-start gap-6 xl:grid-cols-'));
});

test("solo el consentimiento informado lleva firma del paciente", () => {
  assert.match(panel, /activeDocument\.kind === "consentimiento" && <div className="flex min-h-28 flex-col justify-end">/);
  assert.doesNotMatch(panel, /activeDocument\.kind !== "receta" && <div/);
});

test("los borradores se pueden borrar y los emitidos no", () => {
  const route = readFileSync(new URL("../app/api/documentos/borrar/route.ts", import.meta.url), "utf8");
  assert.match(route, /doc\.status !== "borrador"[\s\S]*409/);
  assert.match(route, /eq\(patientDocuments\.status, "borrador"\)/);
  assert.match(panel, /data-testid="documentation-delete-draft"/);
});
