import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import qrcode from "qrcode-generator";
import { pdfSafe, issuedParts } from "./budget-pdf.ts";
import { SIGNATURE_BOX_CM, STAMP_BOX_CM, cmToPt, fitInBox } from "./signature-image.ts";
import { isStampMoved, movedSignatureCenter, placeMerged, placeSignature, placeStamp, stampOpacity, type PrintableStampLayout } from "./stamp-layout.ts";

/**
 * PDF de un documento clínico ya emitido (receta, receta magistral, consentimiento) con la misma información que la vista de impresión:
 * cabecera del profesional y QR de habilitación de la Superintendencia de Salud, datos del paciente, contenido, firmas y QR de verificación.
 * Se genera en el servidor para poder enviarlo por correo y compartirlo por WhatsApp sin pasar por el diálogo de impresión.
 */
export type DocumentPdfInput = {
  title: string;
  /** Número del documento; sin número (registros que no se emiten con QR) no se imprime «N°». */
  number?: string;
  clinicName: string;
  clinicLines: string[];
  logo?: string;
  doctorName: string;
  doctorLines: string[];
  habilitacion?: { url: string; regSis: string; code?: string };
  patientLines: string[];
  issuedDate: string;
  /** Bloques de texto: título opcional + párrafos (una línea por elemento; las que empiezan con «#» van en negrita). */
  sections: { heading?: string; lines: string[]; strong?: boolean }[];
  note?: string;
  /** Fichas con foto (p. ej. etiquetas de productos biomédicos): foto a la izquierda, título y líneas a la derecha. */
  figures?: { title: string; lines: string[]; image?: string }[];
  verification?: { url: string; code: string; text: string };
  doctorMark?: string;
  /** Timbre del profesional: se imprime bajo su nombre y datos, debajo de la firma. */
  doctorStamp?: string;
  /** Posición y tamaño del timbre (medidos desde su lugar de siempre); sin esto queda bajo la firma. */
  stampLayout?: PrintableStampLayout | null;
  patientSignature?: { image: string; name: string; lines: string[] };
  patientLabel?: string;
};

const PAGE_W = 595.28, PAGE_H = 841.89, M = 44, R = PAGE_W - M, BOTTOM = 56;
const INK = rgb(0.12, 0.11, 0.17), MUTED = rgb(0.4, 0.39, 0.47), LINE = rgb(0.81, 0.8, 0.88), PURPLE = rgb(0.28, 0.23, 0.43);

const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/).map(pdfSafe)) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
};

async function embed(pdf: PDFDocument, dataUrl: string | undefined): Promise<PDFImage | null> {
  const match = dataUrl ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[2]!), char => char.charCodeAt(0));
    return match[1] === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch { return null; }
}

/** Dibuja un QR (módulos negros) en un cuadrado de `size` puntos con su esquina inferior izquierda en (x, y). */
export function drawQr(page: PDFPage, url: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount(), cell = size / count;
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
    if (qr.isDark(row, col)) page.drawRectangle({ x: x + col * cell, y: y + size - (row + 1) * cell, width: cell + 0.2, height: cell + 0.2, color: rgb(0, 0, 0) });
  }
}

export async function buildDocumentPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(input.title));
  pdf.setProducer("Gestión Dental");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [logo, mark, patientImage, stampImage, mergedImage] = await Promise.all([embed(pdf, input.logo), embed(pdf, input.doctorMark), embed(pdf, input.patientSignature?.image), embed(pdf, input.doctorStamp), embed(pdf, input.stampLayout?.mergedMark)]);
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; };
  const need = (height: number) => { if (y - height < BOTTOM) newPage(); };
  const text = (value: string, x: number, size: number, font: PDFFont = regular, color = INK) => page.drawText(pdfSafe(value), { x, y, size, font, color });
  const paragraph = (value: string, size: number, font: PDFFont = regular, width = R - M, color = INK, lead = 1.38) => {
    for (const line of wrap(value, font, size, width)) { need(size * lead); y -= size * lead; text(line, M, size, font, color); }
  };

  // Cabecera: izquierda el profesional; derecha, el QR de habilitación de la Superintendencia de Salud.
  const boxW = input.habilitacion ? 196 : 0, headTop = y;
  const leftW = R - M - boxW - (boxW ? 14 : 0);
  let textX = M;
  if (logo) {
    const fit = fitInBox(logo.width, logo.height, 48, 40);
    page.drawImage(logo, { x: M, y: y - fit.height, width: fit.width, height: fit.height });
    textX = M + 56;
  }
  y -= 16; text(input.clinicName || "Consulta odontológica", textX, 15, bold, PURPLE);
  y -= 6;
  const left = [{ value: input.doctorName, size: 13, font: bold }, ...input.doctorLines.concat(input.clinicLines).map(value => ({ value, size: 9.5, font: regular }))];
  for (const item of left) for (const line of wrap(item.value, item.font, item.size, leftW)) { y -= item.size * 1.4; text(line, M, item.size, item.font, item.font === bold ? INK : MUTED); }
  if (input.habilitacion) {
    const hx = R - boxW, size = 62, boxH = size + 14;
    page.drawRectangle({ x: hx, y: headTop - boxH, width: boxW, height: boxH, borderColor: LINE, borderWidth: 0.8 });
    drawQr(page, input.habilitacion.url, hx + 7, headTop - boxH + 7, size);
    let ty = headTop - 17;
    const label = (value: string, font: PDFFont, color = INK) => { for (const line of wrap(value, font, 8, boxW - size - 22)) { page.drawText(line, { x: hx + size + 14, y: ty, size: 8, font, color }); ty -= 10.5; } };
    label("Verifique la habilitación del profesional", bold); label("Superintendencia de Salud", regular, MUTED); ty -= 2;
    label(`REG-SIS N° ${input.habilitacion.regSis}`, bold); if (input.habilitacion.code) label(`Código ${input.habilitacion.code}`, regular, MUTED);
    y = Math.min(y, headTop - boxH);
  }
  y -= 8; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 1.6, color: PURPLE });

  y -= 24; const title = pdfSafe(input.title.toUpperCase());
  text(title, (PAGE_W - bold.widthOfTextAtSize(title, 13)) / 2, 13, bold, PURPLE);
  if (input.number) { const number = `N° ${input.number}`; text(number, R - regular.widthOfTextAtSize(number, 9), 9, regular, MUTED); }

  y -= 10;
  const dateText = `Fecha emisión: ${input.issuedDate}`;
  const dateW = bold.widthOfTextAtSize(pdfSafe(dateText), 10);
  const patientTop = y;
  for (const line of input.patientLines) paragraph(line, 10.5, regular, R - M - dateW - 20);
  const afterPatient = y;
  y = patientTop - 14; text(dateText, R - dateW, 10, bold);
  y = Math.min(afterPatient, y) - 8; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.7, color: LINE });

  for (const section of input.sections) {
    y -= 6;
    if (section.heading) { need(30); y -= 12; text(pdfSafe(section.heading), M, 9, bold, PURPLE); y -= 2; }
    for (const line of section.lines) paragraph(line, section.strong ? 11 : 10.5, section.strong ? bold : regular);
    y -= 4;
  }
  if (input.note) { y -= 6; paragraph(input.note, 8.5, regular, R - M, MUTED); }

  // Fichas con foto (etiquetas de productos): cada una en su recuadro, sin partirse entre páginas.
  const figureImages = await Promise.all((input.figures ?? []).map(figure => embed(pdf, figure.image)));
  for (const [index, figure] of (input.figures ?? []).entries()) {
    const image = figureImages[index] ?? null, textX = M + 148, textW = R - M - 156;
    const rows = figure.lines.flatMap(line => wrap(line, regular, 9.5, textW));
    const titleRows = wrap(figure.title, bold, 10.5, textW);
    const textH = titleRows.length * 14 + rows.length * 12 + 6, boxH = Math.max(98, textH) + 12;
    need(boxH + 10);
    const top = y - 8;
    page.drawRectangle({ x: M, y: top - boxH, width: R - M, height: boxH, borderColor: LINE, borderWidth: 0.8 });
    if (image) { const fit = fitInBox(image.width, image.height, 132, 98); page.drawImage(image, { x: M + 8 + (132 - fit.width) / 2, y: top - 6 - fit.height - (98 - fit.height) / 2, width: fit.width, height: fit.height }); }
    let ty = top - 16;
    for (const row of titleRows) { page.drawText(row, { x: textX, y: ty, size: 10.5, font: bold, color: INK }); ty -= 14; }
    for (const row of rows) { page.drawText(row, { x: textX, y: ty, size: 9.5, font: regular, color: MUTED }); ty -= 12; }
    y = top - boxH - 2;
  }

  // Firmas: el profesional (timbre o firma dibujada) y, en consentimientos, la del paciente.
  const stampBoxWidth = cmToPt(STAMP_BOX_CM.width), stampBoxHeight = cmToPt(STAMP_BOX_CM.height), stampSpace = stampImage ? (isStampMoved(input.stampLayout) ? 0 : stampBoxHeight * Math.max(input.stampLayout?.scale ?? 1, 0.5) + 8) : 0;
  const sigBlock = (cx: number, lines: string[], image: PDFImage | null, stamp: PDFImage | null = null, doctor = false) => {
    const boxWidth = cmToPt(SIGNATURE_BOX_CM.width), boxHeight = cmToPt(SIGNATURE_BOX_CM.height);
    const layout = doctor ? input.stampLayout : null, center = { x: cx, y: y - boxHeight / 2 };
    // Firma y timbre unidos en una sola pieza (si el profesional lo pidió y la imagen existe): se dibuja ella sola, ya con las posiciones elegidas.
    const mergedBox = layout?.merged && mergedImage ? layout.mergedBox : null;
    if (mergedBox && mergedImage) page.drawImage(mergedImage, placeMerged(mergedBox, center, page.getSize(), cmToPt));
    else if (image) {
      const moved = placeSignature(image, { width: boxWidth, height: boxHeight }, center, layout, page.getSize(), cmToPt);
      if (moved) page.drawImage(image, moved);
      else { const fit = fitInBox(image.width, image.height, boxWidth, boxHeight); page.drawImage(image, { x: cx - fit.width / 2, y: y - boxHeight + (boxHeight - fit.height) / 2, width: fit.width, height: fit.height }); }
    }
    let ly = y - boxHeight - 4;
    page.drawLine({ start: { x: cx - 105, y: ly + 8 }, end: { x: cx + 105, y: ly + 8 }, thickness: 0.7, color: MUTED });
    lines.forEach((line, index) => { for (const part of wrap(line, index === 0 ? bold : regular, 9, 210)) { const font = index === 0 ? bold : regular; page.drawText(part, { x: cx - font.widthOfTextAtSize(part, 9) / 2, y: ly - 3, size: 9, font }); ly -= 11; } });
    // El timbre va bajo la firma y los datos del profesional.
    if (stamp && !mergedBox) { const at = placeStamp(stamp, { x: cx - stampBoxWidth / 2, y: ly - 4 - stampBoxHeight, width: stampBoxWidth, height: stampBoxHeight }, input.stampLayout, page.getSize(), cmToPt, movedSignatureCenter(center, input.stampLayout, cmToPt)); page.drawImage(stamp, { ...at, opacity: stampOpacity(input.stampLayout) }); }
  };
  const doctorLines = [input.doctorName, ...input.doctorLines.slice(0, 2)];
  const withPatient = Boolean(input.patientLabel);
  const verificationHeight = input.verification ? 12 + 46 + 4 : 0;
  need(26 + cmToPt(SIGNATURE_BOX_CM.height) + 70 + (withPatient ? 24 : 0) + stampSpace + verificationHeight);
  y -= 26;
  const signTop = y;
  if (withPatient) {
    sigBlock(M + 105, doctorLines, mark, stampImage, true);
    y = signTop;
    sigBlock(R - 105, [input.patientSignature?.name || "", input.patientLabel!, ...(input.patientSignature?.lines ?? [])], patientImage);
  } else sigBlock(R - 105, doctorLines, mark, stampImage, true);
  y = signTop - cmToPt(SIGNATURE_BOX_CM.height) - 70 - (withPatient ? 24 : 0) - stampSpace;

  if (input.verification) {
    const size = 46; y -= 12;
    drawQr(page, input.verification.url, M, y - size, size);
    let ty = y - 10;
    page.drawText("VERIFICACIÓN DE DOCUMENTO", { x: M + size + 10, y: ty, size: 8, font: bold, color: PURPLE }); ty -= 11;
    for (const line of wrap(`${input.verification.text} Código ${input.verification.code}.`, regular, 8, R - M - size - 10)) { page.drawText(line, { x: M + size + 10, y: ty, size: 8, font: regular, color: MUTED }); ty -= 10; }
  }
  const stamp = issuedParts(new Date());
  pdf.getPages().forEach((p, index, all) => p.drawText(pdfSafe(`Gestión Dental · ${stamp.day} ${stamp.time} · Página ${index + 1} de ${all.length}`), { x: M, y: 26, size: 7.5, font: regular, color: MUTED }));
  return pdf.save();
}
