import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_FORMAT, PALETTES, checkBudgetFormat, decodeBudgetFormat, formatForPdf, luminance, previewActions } from "../lib/budget-format.ts";
import { buildBudgetPdf, itemZoneText } from "../lib/budget-pdf.ts";

const base = {
  budget: { id: 7, title: "Plan", date: "17 nov 2026", items: [{ label: "Destartraje", amount: 45000, zone: "perm:boca" }, { label: "Implante", amount: 790000, teeth: [36] }] },
  patientName: "Paciente Ejemplo", professionalName: "Dr(a). Ana Pérez", professionalSpecialty: "Periodoncia", professionalDocument: "12.345.678-5",
  clinicName: "Una clínica con un nombre bastante largo para la cabecera del documento",
};

test("formato: paletas listas, colores propios oscuros y valores por defecto", () => {
  assert.deepEqual(decodeBudgetFormat(null), DEFAULT_FORMAT);
  assert.deepEqual(decodeBudgetFormat("{dañado"), DEFAULT_FORMAT);
  const azul = checkBudgetFormat({ palette: "azul", primary: "#ffffff" });
  assert.ok(azul.ok && azul.format.primary === PALETTES.azul.primary, "una paleta lista ignora colores enviados");
  const claro = checkBudgetFormat({ palette: "propio", primary: "#ffee00", accent: "#000000" });
  assert.equal(claro.ok, false, "un principal claro dejaría ilegible el texto blanco");
  const propio = checkBudgetFormat({ palette: "propio", primary: "#123456", accent: "#ABCDEF" });
  assert.ok(propio.ok && propio.format.accent === "#abcdef");
  for (const p of Object.values(PALETTES)) assert.ok(luminance(p.primary) <= 0.2, p.label);
  const nota = checkBudgetFormat({ note: " Válido 30 días \n\n\nPago en cuotas ", namePosition: "raro" });
  assert.ok(nota.ok && nota.format.note === "Válido 30 días\nPago en cuotas" && nota.format.namePosition === "ambos");
});

test("PDF: se genera con cada posición del nombre, con o sin numeración chilena y con nota propia", async () => {
  for (const namePosition of ["ambos", "cabecera", "firma"]) {
    const checked = checkBudgetFormat({ palette: "verde", namePosition, note: "Válido por 30 días.", keepDefaultNotes: false, registry: "123456", showTitles: true });
    const bytes = await buildBudgetPdf({ ...base, format: checked.format, professionalTitles: "Magíster" });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1, namePosition);
  }
  const withLogo = await buildBudgetPdf({ ...base, logo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
  assert.ok((await PDFDocument.load(withLogo)).getPageCount() >= 1, "con logo PNG");
  const badLogo = await buildBudgetPdf({ ...base, logo: "data:image/png;base64,AAAA" });
  assert.ok(badLogo.length > 1000, "un logo dañado se omite sin romper el PDF");
  assert.equal(itemZoneText({ label: "x", amount: 1, teeth: [36] }, false), "Piezas 3.6".replace("Piezas", "Pieza"));
  assert.equal(itemZoneText({ label: "x", amount: 1, teeth: [36] }), "Pieza 3.6 · Chile 30");
});

test("el formato es del profesional que arma el presupuesto, y el logo es de la clínica", () => {
  const mail = readFileSync(new URL("../app/budget-mail.ts", import.meta.url), "utf8");
  assert.match(mail, /loadBudgetFormat\(professionalId\)/);
  assert.match(mail, /loadClinic\(ownerId\)/);
  const route = readFileSync(new URL("../app/api/presupuesto/formato/route.ts", import.meta.url), "utf8");
  assert.match(route, /saveBudgetFormat\(personalId, checked\.format\)/, "se guarda en el id personal, no en el de la clínica");
  assert.doesNotMatch(route, /patients|SELECT/, "la vista previa no lee pacientes reales");
});

test("formato: rechaza nombres heredados como paleta, acentos casi blancos y más de 8 líneas de notas", () => {
  assert.equal(checkBudgetFormat({ palette: "__proto__" }).format.palette, DEFAULT_FORMAT.palette);
  assert.equal(checkBudgetFormat({ palette: "toString" }).format.palette, DEFAULT_FORMAT.palette);
  assert.equal(checkBudgetFormat({ palette: "propio", primary: "#2a1f4d", accent: "#ffffff" }).ok, false);
  assert.equal(checkBudgetFormat({ note: Array.from({ length: 9 }, (_, i) => `n${i}`).join("\n") }).ok, false);
});

test("vista previa: el borrador solo se aplica a quien armó el presupuesto", () => {
  const saved = { ...DEFAULT_FORMAT, note: "guardado" }, draft = { ...DEFAULT_FORMAT, note: "borrador", palette: "azul" };
  assert.deepEqual(formatForPdf(saved, { viewerId: "ana", format: draft }, "ana"), { format: draft, editable: true });
  assert.deepEqual(formatForPdf(saved, { viewerId: "titular", format: draft }, "ana"), { format: saved, editable: false });
  assert.deepEqual(formatForPdf(saved, undefined, "ana"), { format: saved, editable: false });
});

test("el diálogo de vista previa muestra el PDF real, no una maqueta HTML", () => {
  const source = readFileSync(new URL("../components/budget-print-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/presupuesto\/pdf/);
  assert.match(source, /<iframe/);
  assert.doesNotMatch(source, /budget-print-document/);
  assert.match(source, /BudgetFormatEditor/);
});

test("el borrador del diseño se arma con el mismo PDF que se entrega: colores propios cambian la cabecera", async () => {
  const a = await buildBudgetPdf({ ...base, format: { ...DEFAULT_FORMAT } });
  const b = await buildBudgetPdf({ ...base, format: checkBudgetFormat({ palette: "verde" }).format });
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
});

test("vista previa: descargar y enviar solo con el PDF al día; enviar además sin cambios sin guardar ni diseño inválido", () => {
  const ok = { inSync: true, hasPdf: true, problem: false, canEdit: true, dirty: false, invalid: false };
  assert.deepEqual(previewActions(ok), { canDownload: true, canSend: true });
  assert.deepEqual(previewActions({ ...ok, dirty: true }), { canDownload: true, canSend: false }, "cambios sin guardar: se baja lo que se ve, no se envía");
  assert.deepEqual(previewActions({ ...ok, inSync: false }), { canDownload: false, canSend: false }, "mientras se rearma, nada");
  assert.deepEqual(previewActions({ ...ok, invalid: true, dirty: true }), { canDownload: false, canSend: false }, "diseño inválido: la vista quedó vieja");
  assert.deepEqual(previewActions({ ...ok, problem: true }), { canDownload: false, canSend: false });
  assert.deepEqual(previewActions({ ...ok, canEdit: false, dirty: true }), { canDownload: true, canSend: true }, "sin editor (otro autor) no hay borrador que guardar");
});
