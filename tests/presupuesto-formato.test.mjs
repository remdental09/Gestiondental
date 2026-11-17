import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_FORMAT, PALETTES, checkBudgetFormat, decodeBudgetFormat, luminance } from "../lib/budget-format.ts";
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
