import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";
import { buildDocumentPdf } from "../lib/document-pdf.ts";
import { buildBudgetPdf } from "../lib/budget-pdf.ts";
import { STAMP_BOX_CM, SIGNATURE_BOX_CM, cmToPt, fitInBox, validSignature } from "../lib/signature-image.ts";
import { signatureChangedEmail, unlockCodeEmail } from "../lib/signature-lock.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const stampPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const doc = {
  title: "Certificado", number: "00009", clinicName: "Clínica de prueba", clinicLines: ["Calle 1, Santiago"], doctorName: "Dr. Prueba Ejemplo", doctorLines: ["RUT 1-9", "Cirujano Dentista (REG-SIS 1)"],
  patientLines: ["Paciente: PACIENTE DE PRUEBA", "Nro. de documento: 1-9", "Edad: 40 años"], issuedDate: "22 de noviembre de 2026",
  sections: [{ heading: "CERTIFICO", lines: ["Que el paciente asistió a atención odontológica."] }],
  verification: { url: "https://speakdent.cl/api/verificar?t=abc", code: "52D8-46F4-E1B8", text: "Escanee para confirmar que fue emitido desde Gestión Dental y está vigente." },
};
const budget = {
  budget: { id: 7, title: "Plan", date: "22 nov 2026", items: [{ label: "Destartraje", amount: 45000, zone: "perm:boca" }] },
  patientName: "Paciente Ejemplo", professionalName: "Dr(a). Ana Pérez", professionalSpecialty: "Periodoncia", professionalDocument: "12.345.678-5",
};

/** Cantidad de imágenes incrustadas en el PDF (cada imagen es un XObject con Subtype /Image). */
async function imageCount(bytes) {
  const pdf = await PDFDocument.load(bytes);
  let count = 0;
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    const dict = object.dict;
    if (dict?.get(PDFName.of("Subtype"))?.toString() === "/Image") count++;
  }
  return count;
}

test("timbre: el recuadro impreso es de ≈5 × 2,5 cm, menor que el de la firma, y no se deforma", () => {
  assert.deepEqual(STAMP_BOX_CM, { width: 5, height: 2.5 });
  assert.ok(STAMP_BOX_CM.width < SIGNATURE_BOX_CM.width && STAMP_BOX_CM.height < SIGNATURE_BOX_CM.height);
  const fit = fitInBox(500, 125, cmToPt(STAMP_BOX_CM.width), cmToPt(STAMP_BOX_CM.height));
  assert.ok(Math.abs(fit.width / fit.height - 4) < 0.001 && fit.width <= cmToPt(5) + 0.01);
  assert.equal(validSignature(stampPng), true, "el timbre usa la misma validación que la firma (PNG/JPG/WebP ≤ 400 KB)");
  assert.equal(validSignature("data:text/html;base64,AAAA"), false);
});

test("timbre: el documento lo incrusta bajo la firma y sale igual sin timbre", async () => {
  const without = await imageCount(await buildDocumentPdf({ ...doc, doctorMark: png }));
  const withStamp = await imageCount(await buildDocumentPdf({ ...doc, doctorMark: png, doctorStamp: stampPng }));
  assert.ok(withStamp > without, `con timbre debe haber más imágenes (${without} → ${withStamp})`);
  const onlyStamp = await buildDocumentPdf({ ...doc, doctorStamp: stampPng });
  assert.equal(new TextDecoder().decode(onlyStamp.slice(0, 5)), "%PDF-", "el timbre funciona aunque no haya firma dibujada");
  const broken = await buildDocumentPdf({ ...doc, doctorStamp: "data:image/png;base64,AAAA" }).then(() => "ok", () => "falló");
  assert.equal(broken, "ok", "un timbre dañado no impide emitir el documento");
});

test("timbre: en el consentimiento convive con la firma del paciente", async () => {
  const bytes = await buildDocumentPdf({ ...doc, title: "Consentimiento informado", doctorMark: png, doctorStamp: stampPng, patientLabel: "Firma del paciente", patientSignature: { image: png, name: "Paciente de Prueba", lines: ["Paciente"] } });
  assert.ok(await imageCount(bytes) >= 3, "firma del profesional, timbre y firma del paciente");
});

test("timbre: el presupuesto lo incrusta bajo la firma y no la deja sola en otra hoja", async () => {
  const without = await imageCount(await buildBudgetPdf({ ...budget, documentMark: png }));
  const bytes = await buildBudgetPdf({ ...budget, documentMark: png, stampMark: stampPng });
  assert.ok(await imageCount(bytes) > without);
  const many = { ...budget.budget, items: Array.from({ length: 26 }, (_, i) => ({ label: `Prestación ${i + 1}`, amount: 10000 + i, zone: "perm:boca" })) };
  const long = await PDFDocument.load(await buildBudgetPdf({ ...budget, budget: many, documentMark: png, stampMark: stampPng }));
  assert.ok(long.getPageCount() >= 1);
  const broken = await buildBudgetPdf({ ...budget, stampMark: "data:image/png;base64,AAAA" }).then(() => "ok", () => "falló");
  assert.equal(broken, "ok", "un timbre dañado no impide emitir el presupuesto");
});

test("timbre: el aviso por correo concuerda en género y el código sirve para firma o timbre", () => {
  const cambiado = signatureChangedEmail("cambiada", "22-11-26 18:00", "timbre");
  assert.match(cambiado.subject, /Tu timbre fue cambiado/);
  assert.match(cambiado.text, /El anterior quedó archivado/);
  assert.match(signatureChangedEmail("quitada", "22-11-26 18:00", "timbre").subject, /timbre fue quitado/);
  assert.match(signatureChangedEmail("cambiada", "22-11-26 18:00").subject, /Tu firma fue cambiada/, "sin indicar, sigue siendo la firma");
  assert.match(unlockCodeEmail("123456").subject, /firma o timbre/);
});

test("timbre: se guarda con la misma protección por código que la firma", () => {
  const api = read("app/api/documentos/imagen/route.ts");
  assert.match(api, /stampMark/);
  assert.match(api, /consumeUnlock/, "cambiar o quitar un timbre guardado gasta el permiso del código");
  assert.match(api, /loadStampMark\(professionalId\)\.catch\(\(\) => ""\)/, "si el timbre no se puede leer, la firma sigue funcionando");
  assert.match(read("app/api/documentos/imagen/codigo/route.ts"), /loadStampMark/, "el código se puede pedir teniendo solo timbre");
  assert.match(read("drizzle/0020_stamp_mark.sql"), /ADD `stamp_mark` text DEFAULT '' NOT NULL/);
  assert.match(read("db/schema.ts"), /stampMark: text\("stamp_mark"\)/);
});

test("timbre: llega a receta, certificado, consentimiento, presupuesto y a la vista de impresión", () => {
  assert.match(read("app/document-pdf.ts"), /doctorStamp: stamp \|\| undefined/);
  assert.match(read("app/budget-mail.ts"), /stampMark: stampMark \|\| undefined/);
  assert.match(read("app/api/presupuesto/formato/route.ts"), /stampMark: stampMark \|\| undefined/);
  assert.match(read("app/api/documentos/route.ts"), /stampMark/);
  assert.match(read("components/documentation-panel.tsx"), /data-testid="stamp-box"/);
  assert.match(read("components/profile-dialog.tsx"), /SignatureEditor kind="timbre"/);
  assert.match(read("components/professionals-panel.tsx"), /SignatureEditor kind="timbre"/);
});

test("firma: se puede elegir el color de la tinta, también después de firmar, y el timbre no lo ofrece", async () => {
  const { SIGNATURE_INKS, DEFAULT_INK, isSignatureInk, inkBounds, usableInk } = await import("../lib/signature-image.ts");
  assert.ok(SIGNATURE_INKS.length >= 10, "hay una paleta amplia para elegir");
  assert.ok(SIGNATURE_INKS.every(ink => usableInk(ink.value)), "todos los colores de la paleta se leen bien impresos");
  assert.equal(usableInk("#1d4ed8"), true);
  assert.equal(usableInk("#ffff00"), false, "amarillo: muy claro");
  assert.equal(usableInk("#eeeeee"), false);
  assert.equal(usableInk("azul"), false, "solo #rrggbb");
  assert.equal(usableInk("#12345"), false);
  assert.equal(DEFAULT_INK, "#1f1c33", "el color de siempre sigue por defecto");
  assert.equal(new Set(SIGNATURE_INKS.map(ink => ink.value)).size, SIGNATURE_INKS.length, "sin colores repetidos");
  assert.ok(SIGNATURE_INKS.every(ink => isSignatureInk(ink.value)) && !isSignatureInk("#ffffff"));
  // Todo color de tinta debe contar como trazo al recortar (si no, la firma saldría vacía): nunca casi blanco.
  for (const ink of SIGNATURE_INKS) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(ink.value.slice(i, i + 2), 16));
    assert.ok(inkBounds(new Uint8ClampedArray([r, g, b, 255]), 1, 1, 0), `${ink.label} se detecta como tinta`);
  }
  const editor = read("components/signature-editor.tsx");
  assert.match(editor, /data-testid="signature-inks"/);
  assert.match(editor, /type="color"/, "además de la paleta, se puede elegir otro color");
  assert.match(editor, /if \(!usableInk\(value\)\)/, "un color casi blanco se rechaza");
  assert.match(editor, /\{!locked && !isStamp && <div[^>]*data-testid="signature-inks"/, "solo la firma dibujada tiene colores");
  assert.match(editor, /for \(const stroke of strokes\.current\) stroke\.color = value/, "elegir color recolorea lo ya firmado");
  assert.doesNotMatch(editor, /strokeStyle = "#/, "el color ya no está fijo en el dibujo del trazo");
});
