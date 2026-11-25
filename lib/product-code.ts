/**
 * Datos de trazabilidad leídos del QR (o código 2D) de la etiqueta de un producto biomédico. Lectura exacta, sin IA:
 * GS1 con paréntesis «(01)…(10)…(17)…(21)…», GS1 sin paréntesis (con separador FNC1), GS1 Digital Link (URL con /01/…/10/…/21/…)
 * y texto simple «LOT: … SN: … REF: … EXP: …». Si el código no trae nada reconocible, solo se devuelve el texto bruto.
 */
import { cleanCode, cleanExpiry } from "./biomedical-products.ts";

export type ProductCode = { lot: string; serial: string; expiry: string; manufactured: string; reference: string; gtin: string; raw: string };

const FIXED: Record<string, number> = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
const VARIABLE = new Set(["10", "21", "22", "240", "241", "30", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"]);

/** AAMMDD de GS1 → AAAA-MM-DD, o AAAA-MM cuando el día viene en 00. */
export function gs1Date(value: string): string {
  if (!/^\d{6}$/.test(value)) return "";
  const month = Number(value.slice(2, 4)), day = Number(value.slice(4, 6));
  if (month < 1 || month > 12 || day > 31) return "";
  const year = 2000 + Number(value.slice(0, 2));
  return day === 0 ? `${year}-${String(month).padStart(2, "0")}` : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromElements(pairs: Array<[string, string]>): Partial<ProductCode> {
  const out: Partial<ProductCode> = {};
  for (const [ai, value] of pairs) {
    if (ai === "10") out.lot = value;
    else if (ai === "21") out.serial = value;
    else if (ai === "17") out.expiry = gs1Date(value);
    else if (ai === "11") out.manufactured = gs1Date(value);
    else if (ai === "01" || ai === "02") out.gtin = value.replace(/^0+(?=\d{8})/, "");
  }
  return out;
}

function parseParenthesised(text: string): Partial<ProductCode> | null {
  const pairs = [...text.matchAll(/\((\d{2,4})\)([^(]*)/g)].map(match => [match[1], match[2].replace(/[\x1d\s]+$/g, "")] as [string, string]);
  return pairs.length ? fromElements(pairs) : null;
}

function parseRawGs1(text: string): Partial<ProductCode> | null {
  const s = text.replace(/^\]d2|^\]C1|^\]Q3/, "");
  if (!/^\d{2}/.test(s)) return null;
  const pairs: Array<[string, string]> = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\x1d") { i++; continue; }
    const ai2 = s.slice(i, i + 2), ai3 = s.slice(i, i + 3);
    if (FIXED[ai2]) {
      const value = s.slice(i + 2, i + 2 + FIXED[ai2]);
      if (value.length < FIXED[ai2] || !/^\d+$/.test(value)) return pairs.length ? fromElements(pairs) : null;
      pairs.push([ai2, value]); i += 2 + FIXED[ai2];
    } else if (VARIABLE.has(ai2) || VARIABLE.has(ai3)) {
      const ai = VARIABLE.has(ai2) ? ai2 : ai3;
      let end = s.indexOf("\x1d", i + ai.length); if (end < 0) end = s.length;
      const value = s.slice(i + ai.length, end);
      if (!value) return pairs.length ? fromElements(pairs) : null;
      pairs.push([ai, value]); i = end;
    } else return pairs.length ? fromElements(pairs) : null;
  }
  return pairs.length ? fromElements(pairs) : null;
}

function parseDigitalLink(text: string): Partial<ProductCode> | null {
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  const parts = url.pathname.split("/").filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return part; } });
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < parts.length; i++) if (/^\d{2,4}$/.test(parts[i])) { pairs.push([parts[i], parts[i + 1]]); i++; }
  for (const [key, value] of url.searchParams) if (/^\d{2,4}$/.test(key)) pairs.push([key, value]);
  return pairs.length ? fromElements(pairs) : null;
}

function parseLabelled(text: string): Partial<ProductCode> | null {
  const grab = (names: string) => text.match(new RegExp(`(?:^|[\\s,;|])(?:${names})\\s*[:=#]?\\s*([A-Za-z0-9][A-Za-z0-9\\-_./]*)`, "i"))?.[1] ?? "";
  const lot = grab("LOT|LOTE|BATCH"), serial = grab("SN|S/N|SERIE|SERIAL"), reference = grab("REF|CAT|CODIGO|CÓDIGO");
  const exp = text.match(/(?:EXP|VENC|VENCE|USE BY)\w*\s*[:=]?\s*([0-9]{4}[-/][0-9]{2}(?:[-/][0-9]{2})?|[0-9]{2}[-/][0-9]{4})/i)?.[1] ?? "";
  return lot || serial || reference || exp ? { lot, serial, reference, expiry: exp.replace(/\//g, "-") } : null;
}

export function parseProductCode(payload: unknown): ProductCode {
  const raw = typeof payload === "string" ? payload.replace(/[\u0000-\u001C\u007F]/g, " ").trim().slice(0, 1500) : "";
  const source = typeof payload === "string" ? payload.trim().slice(0, 1500) : "";
  // Código de barras simple (EAN/UPC/ITF-14): el número es el GTIN.
  const barcode = /^(?:\d{8}|\d{12,14})$/.test(source) ? { gtin: source.replace(/^0+(?=\d{8})/, "") } as Partial<ProductCode> : null;
  const found = (source && (barcode ?? parseParenthesised(source) ?? parseDigitalLink(source) ?? parseRawGs1(source) ?? parseLabelled(source))) || {};
  const gtin = found.gtin ?? "";
  return {
    lot: cleanCode(found.lot ?? ""), serial: cleanCode(found.serial ?? ""), expiry: cleanExpiry(found.expiry ?? ""),
    manufactured: cleanExpiry(found.manufactured ?? ""), reference: cleanCode(found.reference ?? ""), gtin: /^\d{8,14}$/.test(gtin) ? gtin : "", raw,
  };
}

/** ¿El código aportó algún dato de trazabilidad que pueda completar el formulario? */
export const codeHasFields = (code: ProductCode) => !!(code.lot || code.serial || code.expiry || code.manufactured || code.reference || code.gtin);

/** Une varios códigos de una misma etiqueta (p. ej. Data Matrix y código de barras): vale el primer dato de cada tipo. */
export function parseProductCodes(payloads: string[]): ProductCode {
  const all = [...new Set(payloads)].map(parseProductCode);
  const first = (key: keyof ProductCode) => all.find(code => code[key])?.[key] ?? "";
  return {
    lot: first("lot"), serial: first("serial"), expiry: first("expiry"), manufactured: first("manufactured"), reference: first("reference"), gtin: first("gtin"),
    raw: all.map(code => code.raw.replace(/\x1d/g, "|")).filter(Boolean).join(" | ").slice(0, 1500),
  };
}
