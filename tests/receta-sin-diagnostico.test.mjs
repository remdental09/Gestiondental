import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanClinicalDocumentContent } from "../lib/clinical-documents.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("la receta no guarda diagnóstico ni motivo: es información de la ficha", () => {
  for (const kind of ["receta", "receta_magistral"]) {
    const content = cleanClinicalDocumentContent(kind, { indicacion: "Pérdida de dientes (pieza 2.7)", diagnostico: "X", prescripcion: "Amoxicilina 500 mg", instrucciones: "Con comida" });
    assert.equal("indicacion" in content, false, kind);
    assert.equal("diagnostico" in content, false, kind);
    assert.equal(content.instrucciones, "Con comida");
  }
});

test("la orden médica conserva su justificación clínica", () => {
  assert.equal(cleanClinicalDocumentContent("orden", { diagnostico: "Control radiográfico" }).diagnostico, "Control radiográfico");
});

test("ni el formulario, ni la vista impresa, ni el PDF, ni el prellenado desde la evolución usan el diagnóstico en recetas", () => {
  const panel = read("components/documentation-panel.tsx"), pdf = read("app/document-pdf.ts"), page = read("app/page.tsx");
  assert.doesNotMatch(panel, /key: "indicacion"/);
  assert.doesNotMatch(panel, /Diagnóstico \/ indicación/);
  assert.doesNotMatch(pdf, /Diagnóstico \/ indicación/);
  assert.doesNotMatch(page, /\{indicacion:text\}/);
  assert.match(page, /kind==="orden"\?\{diagnostico:text\}/, "la orden sigue prellenándose");
});
