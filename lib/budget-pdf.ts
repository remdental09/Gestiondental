import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { budgetItemTotal, budgetPhases, budgetTotals, itemTeeth, type BudgetItem } from "./budget-plans.ts";
import { zoneLabel } from "./treatment-zones.ts";

/**
 * PDF real del presupuesto / plan de tratamiento. Se genera sin pasar por la impresión del navegador
 * (que dejaba páginas en blanco o cortadas), así el mismo archivo sirve para descargar y para enviar por correo.
 */
export type BudgetPdfMode = "detailed" | "total" | "no-prices";
export type BudgetPdfInput = {
  budget: { id?: number; title: string; date: string; isAlternative?: boolean; items: BudgetItem[] };
  patientName: string;
  professionalName?: string;
  clinicName?: string;
  mode?: BudgetPdfMode;
};

const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 42, FOOT = 46;
const INK = rgb(0.21, 0.2, 0.25), MUTED = rgb(0.42, 0.41, 0.49), PURPLE = rgb(0.28, 0.23, 0.43), LIGHT = rgb(0.94, 0.93, 0.96), LINE = rgb(0.86, 0.86, 0.9), ACCENT = rgb(0.53, 0.45, 0.71);

const money = (amount: number) => "$" + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const CP1252_EXTRA = new Set(["–", "—", "‘", "’", "“", "”", "•", "…", "€"]);

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
    // palabra más larga que la línea: se corta por caracteres
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

export function itemZoneText(item: BudgetItem): string {
  if (item.zone) {
    const label = zoneLabel(item.zone);
    if (label) return label;
  }
  const teeth = itemTeeth(item);
  return teeth.length ? teeth.map(fdi).join(", ") : "—";
}

export async function buildBudgetPdf(input: BudgetPdfInput): Promise<Uint8Array> {
  const mode = input.mode ?? "detailed";
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(input.budget.isAlternative ? "Alternativa de tratamiento" : "Presupuesto de tratamiento"));
  pdf.setProducer("Gestión Dental");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const totals = budgetTotals(input.budget.items);
  const innerW = PAGE_W - MARGIN * 2;

  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];
  const text = (value: string, x: number, size: number, font = regular, color = INK) => page.drawText(pdfSafe(value), { x, y, size, font, color });
  const right = (value: string, xRight: number, size: number, font = regular, color = INK) => {
    const safe = pdfSafe(value);
    page.drawText(safe, { x: xRight - font.widthOfTextAtSize(safe, size), y, size, font, color });
  };
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); pages.push(page); y = PAGE_H - MARGIN; };
  const ensure = (needed: number, onNewPage?: () => void) => { if (y - needed < FOOT + 20) { newPage(); onNewPage?.(); } };

  newPage();
  const headLine = [input.clinicName || "Gestión Dental", input.professionalName].filter(Boolean).join(" · ");
  y -= 10; text(headLine.toUpperCase(), MARGIN, 8.5, bold, ACCENT);
  y -= 26; text(input.budget.isAlternative ? "Alternativa de tratamiento" : "Presupuesto de tratamiento", MARGIN, 21, bold, INK);
  for (const line of wrap(input.budget.title, regular, 10.5, innerW)) { y -= 17; text(line, MARGIN, 10.5, regular, MUTED); }
  y -= 24; text("Paciente:", MARGIN, 10, regular, MUTED);
  const patientLines = wrap(input.patientName, bold, 11, innerW * 0.6 - 56);
  patientLines.forEach((line, i) => { if (i) y -= 14; text(line, MARGIN + 52, 11, bold); });
  const patientBottom = y;
  y = patientBottom + (patientLines.length - 1) * 14;
  text("Fecha:", MARGIN + innerW * 0.68, 10, regular, MUTED); text(input.budget.date, MARGIN + innerW * 0.68 + 36, 10.5, regular);
  y = patientBottom - 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE });
  y -= 8;

  if (mode === "total") {
    y -= 46; const label = "Total del presupuesto";
    page.drawText(label, { x: (PAGE_W - regular.widthOfTextAtSize(label, 11)) / 2, y, size: 11, font: regular, color: MUTED });
    y -= 34; const amount = money(totals.total);
    page.drawText(amount, { x: (PAGE_W - bold.widthOfTextAtSize(amount, 28)) / 2, y, size: 28, font: bold, color: PURPLE });
    y -= 20;
  } else {
    const priced = mode === "detailed";
    // columnas: tratamiento | zona | (valor | dto | total)
    const cols = priced
      ? { name: MARGIN + 8, nameW: 214, zone: MARGIN + 232, zoneW: 108, price: PAGE_W - MARGIN - 8 - 138, disc: PAGE_W - MARGIN - 8 - 66, total: PAGE_W - MARGIN - 8 }
      : { name: MARGIN + 8, nameW: 290, zone: MARGIN + 312, zoneW: innerW - 312 - 8, price: 0, disc: 0, total: 0 };
    const header = () => {
      y -= 18; page.drawRectangle({ x: MARGIN, y: y - 6, width: innerW, height: 20, color: LIGHT });
      text("Tratamiento", cols.name, 8.5, bold, MUTED); text("Zona / piezas", cols.zone, 8.5, bold, MUTED);
      if (priced) { right("Valor", cols.price, 8.5, bold, MUTED); right("Dto.", cols.disc, 8.5, bold, MUTED); right("Total", cols.total, 8.5, bold, MUTED); }
      y -= 8;
    };
    header();
    for (const phase of budgetPhases(input.budget.items)) {
      ensure(60, header);
      y -= 20; text(phase.name.toUpperCase(), MARGIN + 8, 8.5, bold, ACCENT);
      for (const item of phase.items) {
        const nameLines = wrap(item.label, regular, 10, cols.nameW);
        const zoneLines = wrap(itemZoneText(item), regular, 9, cols.zoneW);
        const rows = Math.max(nameLines.length, zoneLines.length);
        ensure(rows * 13 + 14, header);
        y -= 17;
        const top = y;
        nameLines.forEach((line, i) => { y = top - i * 13; text(line, cols.name, 10); });
        zoneLines.forEach((line, i) => { y = top - i * 13; text(line, cols.zone, 9, regular, MUTED); });
        y = top;
        if (priced) {
          right(money(item.amount), cols.price, 10);
          right(item.discountPercent ? `${item.discountPercent}%` : "—", cols.disc, 9, regular, MUTED);
          right(money(budgetItemTotal(item)), cols.total, 10, bold);
        }
        y = top - (rows - 1) * 13 - 7;
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.4, color: LINE });
      }
    }
    if (priced) {
      ensure(88);
      const boxX = PAGE_W - MARGIN - 220;
      y -= 22; text("Subtotal", boxX, 10); right(money(totals.subtotal), PAGE_W - MARGIN - 8, 10);
      y -= 16; text("Descuentos", boxX, 10, regular, MUTED); right("-" + money(totals.discount), PAGE_W - MARGIN - 8, 10, regular, MUTED);
      y -= 10; page.drawLine({ start: { x: boxX, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE });
      y -= 20; text("Total", boxX, 13, bold); right(money(totals.total), PAGE_W - MARGIN - 8, 14, bold, PURPLE);
    }
  }

  ensure(40);
  y -= 30;
  for (const line of wrap("Presupuesto informativo sujeto a evaluación y confirmación del profesional tratante.", regular, 8.5, innerW)) { text(line, MARGIN, 8.5, regular, MUTED); y -= 11; }

  pages.forEach((p, index) => {
    p.drawLine({ start: { x: MARGIN, y: FOOT }, end: { x: PAGE_W - MARGIN, y: FOOT }, thickness: 0.5, color: LINE });
    p.drawText(pdfSafe(`${input.clinicName || "Gestión Dental"}`), { x: MARGIN, y: FOOT - 14, size: 8, font: regular, color: MUTED });
    const label = `Página ${index + 1} de ${pages.length}`;
    p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8), y: FOOT - 14, size: 8, font: regular, color: MUTED });
  });
  return pdf.save();
}

export const budgetPdfFileName = (budget: { id?: number; isAlternative?: boolean }) =>
  `${budget.isAlternative ? "Alternativa-de-tratamiento" : "Presupuesto-de-tratamiento"}${budget.id ? "-" + budget.id : ""}.pdf`;
