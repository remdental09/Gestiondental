import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { budgetItemTotal, budgetPhases, budgetTotals, itemWhereText, type BudgetItem } from "./budget-plans.ts";

/**
 * PDF del presupuesto / plan de tratamiento, con formato de presupuesto clínico: cabecera de la clínica, número y hora de emisión,
 * datos del paciente, detalle numerado con subtotales por fase, resumen, condiciones y firma.
 * Se genera sin pasar por la impresión del navegador (que dejaba páginas en blanco), así el mismo archivo sirve para descargar y enviar por correo.
 */
export type BudgetPdfMode = "detailed" | "total" | "no-prices";
export type BudgetPdfInput = {
  budget: { id?: number; title: string; date: string; isAlternative?: boolean; items: BudgetItem[] };
  patientName: string;
  /** RUT o documento de identidad del paciente (opcional). */
  patientDocument?: string;
  professionalName?: string;
  professionalSpecialty?: string;
  professionalDocument?: string;
  clinicName?: string;
  /** Correo de contacto de la clínica (opcional). */
  contactEmail?: string;
  mode?: BudgetPdfMode;
  /** Momento de emisión; por defecto, ahora. Se muestra en hora de Chile. */
  issuedAt?: Date;
};

const PAGE_W = 595.28, PAGE_H = 841.89, M = 40, R = PAGE_W - M, FOOT = 52, BAND = 84;
const INK = rgb(0.17, 0.16, 0.22), MUTED = rgb(0.4, 0.39, 0.47), PURPLE = rgb(0.28, 0.23, 0.43), DEEP = rgb(0.2, 0.16, 0.33);
const LILAC = rgb(0.84, 0.81, 0.93), PALE = rgb(0.96, 0.95, 0.98), LINE = rgb(0.87, 0.86, 0.91), CORAL = rgb(0.94, 0.54, 0.37), WHITE = rgb(1, 1, 1);

const money = (amount: number) => "$" + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const CP1252_EXTRA = new Set(["–", "—", "‘", "’", "“", "”", "•", "…", "€"]);

/** Fecha y hora de emisión en hora de Chile: «16/11/2026» y «14:07». */
export function issuedParts(date: Date): { day: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${parts.day}/${parts.month}/${parts.year}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}

/** Las fuentes estándar del PDF solo codifican Latin-1 (tildes y ñ sí); lo demás se reemplaza para no fallar. */
export function pdfSafe(text: string): string {
  return text.replace(/−/g, "-").replace(/[\r\n\t]+/g, " ").replace(/./gu, ch => {
    const code = ch.codePointAt(0)!;
    return (code >= 32 && code <= 255 && !(code >= 127 && code <= 159)) || CP1252_EXTRA.has(ch) ? ch : "?";
  });
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  const push = (word: string) => {
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
      out.push(rest.slice(0, cut)); rest = rest.slice(cut);
    }
    line = rest;
  };
  for (const word of pdfSafe(text).split(" ").filter(Boolean)) {
    const next = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) out.push(line);
    line = "";
    push(word);
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** Columna «Dónde se trabaja» del PDF: zona, piezas en FDI y chilena, y el detalle libre. */
export function itemZoneText(item: BudgetItem): string {
  return itemWhereText(item) || "—";
}

export async function buildBudgetPdf(input: BudgetPdfInput): Promise<Uint8Array> {
  const mode = input.mode ?? "detailed";
  const priced = mode === "detailed";
  const issued = issuedParts(input.issuedAt ?? new Date());
  const number = input.budget.id ? `N° ${input.budget.id}` : "";
  const docTitle = input.budget.isAlternative ? "Alternativa de tratamiento" : "Presupuesto de tratamiento";
  const clinic = input.clinicName?.trim() || "Gestión Dental";

  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${docTitle}${number ? " " + number : ""}`));
  pdf.setProducer("Gestión Dental");
  pdf.setCreationDate(input.issuedAt ?? new Date());
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const totals = budgetTotals(input.budget.items);

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];
  const text = (value: string, x: number, size: number, font = regular, color = INK) => page.drawText(pdfSafe(value), { x, y, size, font, color });
  const right = (value: string, xRight: number, size: number, font = regular, color = INK) => {
    const safe = pdfSafe(value);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };
  const rule = (x1: number, x2: number, thickness = 0.5, color = LINE) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); pages.push(page); y = PAGE_H - M; };
  const ensure = (needed: number, onNewPage?: () => void) => { if (y - needed < FOOT + 16) { newPage(); onNewPage?.(); } };

  // ── Cabecera de la clínica (solo primera página)
  newPage();
  page.drawRectangle({ x: 0, y: PAGE_H - BAND, width: PAGE_W, height: BAND, color: PURPLE });
  page.drawRectangle({ x: 0, y: PAGE_H - BAND - 3, width: PAGE_W, height: 3, color: CORAL });
  y = PAGE_H - 36; text(clinic, M, 19, bold, WHITE);
  const sub = [input.professionalName, input.professionalDocument ? `RUT ${input.professionalDocument}` : "", input.professionalSpecialty].filter(Boolean).join(" · ");
  if (sub) { y -= 17; text(sub, M, 9.5, regular, LILAC); }
  if (input.contactEmail) { y -= 13; text(input.contactEmail, M, 8.5, regular, LILAC); }
  y = PAGE_H - 33; right(docTitle.toUpperCase(), R, 8, bold, LILAC);
  if (number) { y -= 19; right(number, R, 17, bold, WHITE); }
  y -= 14; right(`Emitido el ${issued.day} a las ${issued.time}`, R, 8.5, regular, LILAC);

  // ── Título y datos del paciente
  y = PAGE_H - BAND - 38; text(docTitle, M, 21, bold, DEEP);
  const titleLines = wrap(input.budget.title, regular, 10.5, R - M);
  for (const line of titleLines) { y -= 17; text(line, M, 10.5, regular, MUTED); }
  y -= 18;
  const boxTop = y, boxH = 52;
  page.drawRectangle({ x: M, y: boxTop - boxH, width: R - M, height: boxH, color: PALE, borderColor: LINE, borderWidth: 0.6 });
  const cell = (label: string, value: string | string[], x: number, width: number) => {
    y = boxTop - 17; text(label.toUpperCase(), x, 7, bold, MUTED);
    const lines = (Array.isArray(value) ? value : wrap(value || "—", bold, 10.5, width)).slice(0, 2);
    lines.forEach((line, i) => { y = boxTop - 32 - i * 12; text(line, x, 10.5, bold, INK); });
  };
  cell("Paciente", input.patientName, M + 14, 226);
  cell("Documento", input.patientDocument ?? "", M + 258, 96);
  cell("Fecha del plan", input.budget.date, M + 372, 62);
  cell("Emisión", [issued.day, `${issued.time} h`], M + 442, 70);
  y = boxTop - boxH - 6;

  if (mode === "total") {
    y -= 56; const label = "Total del presupuesto";
    page.drawText(label, { x: (PAGE_W - regular.widthOfTextAtSize(label, 11)) / 2, y, size: 11, font: regular, color: MUTED });
    y -= 38; const amount = money(totals.total);
    page.drawText(amount, { x: (PAGE_W - bold.widthOfTextAtSize(amount, 30)) / 2, y, size: 30, font: bold, color: PURPLE });
    y -= 12;
  } else {
    // columnas: # | tratamiento | zona | cant. | valor | dto. | total
    const cols = priced
      ? { num: M + 10, name: M + 30, nameW: 168, zone: M + 206, zoneW: 110, qty: M + 346, price: M + 410, disc: M + 454, total: R - 8 }
      : { num: M + 10, name: M + 30, nameW: 270, zone: M + 318, zoneW: R - 8 - (M + 318), qty: 0, price: 0, disc: 0, total: 0 };
    const header = () => {
      y -= 22; page.drawRectangle({ x: M, y: y - 7, width: R - M, height: 22, color: PURPLE });
      const h = (value: string, x: number) => text(value.toUpperCase(), x, 7.5, bold, WHITE);
      h("N°", cols.num); h("Tratamiento", cols.name); h("Dónde se trabaja", cols.zone);
      if (priced) { right("CANT.", cols.qty, 7.5, bold, WHITE); right("VALOR", cols.price, 7.5, bold, WHITE); right("DTO.", cols.disc, 7.5, bold, WHITE); right("TOTAL", cols.total, 7.5, bold, WHITE); }
      y -= 7;
    };
    y -= 8; header();
    const phases = budgetPhases(input.budget.items);
    let counter = 0;
    for (const phase of phases) {
      ensure(70, header);
      y -= 22;
      page.drawRectangle({ x: M, y: y - 6, width: R - M, height: 18, color: PALE });
      page.drawRectangle({ x: M, y: y - 6, width: 3, height: 18, color: CORAL });
      text(phase.name.toUpperCase(), M + 12, 8.5, bold, PURPLE);
      for (const item of phase.items) {
        counter++;
        const nameLines = wrap(item.label, regular, 10, cols.nameW);
        const zoneLines = wrap(itemZoneText(item), regular, 9, cols.zoneW);
        const rows = Math.max(nameLines.length, zoneLines.length);
        ensure(rows * 13 + 16, header);
        y -= 19;
        const top = y;
        text(String(counter), cols.num, 9, regular, MUTED);
        nameLines.forEach((line, i) => { y = top - i * 13; text(line, cols.name, 10); });
        zoneLines.forEach((line, i) => { y = top - i * 13; text(line, cols.zone, 9, regular, MUTED); });
        y = top;
        if (priced) {
          right("1", cols.qty, 9.5, regular, MUTED);
          right(money(item.amount), cols.price, 10);
          right(item.discountPercent ? `${item.discountPercent}%` : "—", cols.disc, 9, regular, MUTED);
          right(money(budgetItemTotal(item)), cols.total, 10, bold);
        }
        y = top - (rows - 1) * 13 - 8;
        rule(M, R);
      }
      if (priced && phases.length > 1) {
        ensure(24, header);
        y -= 16; right(`Subtotal ${phase.name}`, cols.price + 14, 8.5, regular, MUTED);
        right(money(phase.items.reduce((sum, item) => sum + budgetItemTotal(item), 0)), cols.total, 9.5, bold, PURPLE);
        y -= 4;
      }
    }
    if (priced) {
      ensure(96);
      const boxX = R - 236, boxW = 236;
      y -= 14;
      const hasDiscount = totals.discount > 0;
      const top = y, height = hasDiscount ? 78 : 56;
      page.drawRectangle({ x: boxX, y: top - height, width: boxW, height, color: PALE, borderColor: LINE, borderWidth: 0.6 });
      page.drawRectangle({ x: boxX, y: top - height, width: boxW, height: 3, color: CORAL });
      y = top - 20; text("Subtotal", boxX + 14, 10, regular, MUTED); right(money(totals.subtotal), boxX + boxW - 14, 10);
      if (hasDiscount) { y -= 16; text("Descuentos", boxX + 14, 10, regular, MUTED); right("-" + money(totals.discount), boxX + boxW - 14, 10, regular, MUTED); }
      y -= hasDiscount ? 24 : 22; text("TOTAL", boxX + 14, 11, bold, DEEP); right(money(totals.total), boxX + boxW - 14, 16, bold, PURPLE);
      y = top - height - 4;
    }
  }

  // ── Condiciones y observaciones
  const notes = [
    ...(priced || mode === "total" ? ["Valores expresados en pesos chilenos (CLP)."] : []),
    "Presupuesto informativo, sujeto a evaluación y confirmación del profesional tratante.",
    "El plan puede modificarse según la evolución clínica y la respuesta del paciente al tratamiento.",
  ];
  ensure(40 + notes.length * 13 + 100); // condiciones y firma siempre juntas, nunca la firma sola en otra hoja
  y -= 26; text("CONDICIONES Y OBSERVACIONES", M, 8, bold, PURPLE); y -= 5; rule(M, R, 0.8, LILAC);
  for (const note of notes) for (const [i, line] of wrap(note, regular, 8.5, R - M - 12).entries()) { y -= 12.5; if (i === 0) text("•", M + 2, 8.5, bold, CORAL); text(line, M + 12, 8.5, regular, MUTED); }

  // ── Firma del profesional
  ensure(125);
  y -= 40;
  const signTop = y;
  const colW = 224;
  const sx = R - colW + 16;
  y = signTop - 62; rule(sx, R);
  y -= 13; page.drawText(pdfSafe(input.professionalName || "Profesional tratante"), { x: sx + ((R - sx) - bold.widthOfTextAtSize(pdfSafe(input.professionalName || "Profesional tratante"), 9.5)) / 2, y, size: 9.5, font: bold, color: INK });
  const credentials = [input.professionalSpecialty, input.professionalDocument ? `RUT ${input.professionalDocument}` : ""].filter(Boolean).join(" · ");
  if (credentials) { y -= 12; const safe = pdfSafe(credentials); page.drawText(safe, { x: sx + ((R - sx) - regular.widthOfTextAtSize(safe, 8)) / 2, y, size: 8, font: regular, color: MUTED }); }
  y = signTop - 102;

  // ── Pie de cada página
  pages.forEach((p, index) => {
    p.drawLine({ start: { x: M, y: FOOT }, end: { x: R, y: FOOT }, thickness: 0.5, color: LINE });
    const foot = (value: string, x: number, size: number, font: PDFFont, color = MUTED, align: "left" | "right" = "left", yy = FOOT - 14) => {
      const safe = pdfSafe(value);
      p.drawText(safe, { x: align === "right" ? x - font.widthOfTextAtSize(safe, size) : x, y: yy, size, font, color });
    };
    foot(`${clinic}${input.professionalName ? " · " + input.professionalName : ""}`, M, 8, bold);
    foot(`Página ${index + 1} de ${pages.length}`, R, 8, regular, MUTED, "right");
    foot(`${docTitle}${number ? " " + number : ""} · Emitido el ${issued.day} a las ${issued.time}`, M, 7.5, regular, MUTED, "left", FOOT - 25);
  });
  return pdf.save();
}

export const budgetPdfFileName = (budget: { id?: number; isAlternative?: boolean }) =>
  `${budget.isAlternative ? "Alternativa-de-tratamiento" : "Presupuesto-de-tratamiento"}${budget.id ? "-" + budget.id : ""}.pdf`;
