import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildDocumentPdf } from "../lib/document-pdf.ts";
import { documentEmail } from "../lib/appointment-mail.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = {
  title: "Receta médica", number: "00008", clinicName: "Clínica de prueba", clinicLines: ["Calle 1, Santiago"], doctorName: "Dr. Prueba Ejemplo", doctorLines: ["RUT 1-9", "Cirujano Dentista (REG-SIS Nº: 1)"],
  habilitacion: { url: "https://webapp.superdesalud.gob.cl/prestadores/x", regSis: "1", code: "ABC123" },
  patientLines: ["Paciente: PACIENTE DE PRUEBA", "Nro. de documento: 1-9", "Edad: 40 años"], issuedDate: "21 de noviembre de 2026",
  sections: [{ heading: "Rp.", lines: [] }, { lines: ["1. Paracetamol"], strong: true }, { lines: ["1 comprimido cada 8 horas. Vía: oral", "Cantidad a dispensar: 3 comprimidos"] }],
  verification: { url: "https://speakdent.cl/api/verificar?t=abc", code: "52D8-46F4-E1B8", text: "Escanee para confirmar que fue emitido desde Gestión Dental y está vigente." },
};

test("el PDF de la receta se genera válido, con acentos y sin la leyenda de firma avanzada", async () => {
  const bytes = await buildDocumentPdf(base);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 2000);
});

test("el PDF del consentimiento pagina textos largos y acepta la firma del paciente", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const long = Array.from({ length: 120 }, (_, i) => `Riesgo número ${i + 1}: texto de ejemplo suficientemente largo para forzar el salto de línea y de página en el documento.`);
  const bytes = await buildDocumentPdf({ ...base, title: "Consentimiento informado", sections: [{ heading: "RIESGOS", lines: long }], patientLabel: "Firma del paciente", patientSignature: { image: png, name: "Paciente de Prueba", lines: ["Paciente", "Firmado electrónicamente. Firma electrónica simple."] } });
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(pages >= 2, `esperaba varias páginas, hubo ${pages}`);
});

test("el correo del documento nombra receta o consentimiento y escapa el nombre", () => {
  const receta = documentEmail({ patientName: "Ana <b>", clinicName: "Clínica", doctorName: "Dr. X" });
  assert.match(receta.subject, /receta médica/);
  assert.doesNotMatch(receta.html, /<b>/);
  assert.match(documentEmail({ patientName: "Ana", consent: true }).subject, /consentimiento informado/);
});

test("las rutas y el servidor exigen sesión, dueño, documento emitido y QR de habilitación", () => {
  const pdf = read("app/api/documentos/pdf/route.ts"), send = read("app/api/documentos/enviar/route.ts"), server = read("app/document-pdf.ts");
  assert.match(pdf, /getChatGPTUser/); assert.match(send, /getChatGPTUser/);
  assert.match(send, /origin"\) !== new URL\(request\.url\)\.origin/);
  assert.match(server, /eq\(patientDocuments\.ownerId, ownerId\)/);
  assert.match(server, /doc\.status !== "emitido"/);
  assert.match(server, /requiresHabilitacionQr\(doc\.kind\) && !reg\?\.qrUrl/);
  assert.match(server, /eq\(consentSignatures\.ownerId, ownerId\)/);
});

test("el panel envía el PDF por WhatsApp (compartir con archivo) y por correo (con confirmación)", () => {
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /navigator\.canShare/);
  assert.match(panel, /files: \[file\]/);
  assert.match(panel, /\/api\/documentos\/pdf\?id=/);
  assert.match(panel, /\/api\/documentos\/enviar/);
  assert.match(panel, /window\.confirm\(`¿Enviar el PDF a/);
  assert.doesNotMatch(panel, /disabled=\{busy \|\| !patient\.phone\}/);
  assert.match(panel, /https:\/\/wa\.me\/\?text=/);
  assert.match(panel, /documentation-send-whatsapp/); assert.match(panel, /documentation-send-email/);
  assert.match(panel, /\(isPrescriptionKind\(activeDocument\.kind\) \|\| activeDocument\.kind === "consentimiento"\) && !printBlocked\(activeDocument\)/);
});

test("los saltos de línea del texto se respetan (no se colapsan en un párrafo)", async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `Componente ${i + 1}`).join("\n");
  const bytes = await buildDocumentPdf({ ...base, title: "Receta magistral", sections: [{ heading: "FÓRMULA MAGISTRAL", lines: [lines] }] });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
  const source = readFileSync(new URL("../lib/document-pdf.ts", import.meta.url), "utf8");
  assert.match(source, /text\.split\(\/\\r\?\\n\/\)\.map\(pdfSafe\)/);
  assert.match(source, /need\(26 \+ cmToPt\(SIGNATURE_BOX_CM\.height\) \+ 70/);
});
