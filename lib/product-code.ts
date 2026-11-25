/**
 * Datos de trazabilidad leídos del QR (o código 2D) de la etiqueta de un producto biomédico. Lectura exacta, sin IA:
 * GS1 con paréntesis «(01)…(10)…(17)…(21)…», GS1 sin paréntesis (con separador FNC1), GS1 Digital Link (URL con /01/…/10/…/21/…)
 * y texto simple «LOT: … SN: … REF: … EXP: …». Si el código no trae nada reconocible, solo se devuelve el texto bruto.
 */
import { cleanCode, cleanExpiry } from "./biomedical-products.ts";

export type ProductCode = { lot: string; serial: string; expiry: string; manufactured: string; reference: string; gtin: string; raw: string };
/** Código tal como lo entrega el lector: `gs1` cuando el símbolo se declara GS1 (UDI); `format`, el tipo de símbolo. */
export type CodeRead = { text: string; gs1?: boolean; format?: string };

/** Dígito verificador GS1 (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function validGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/.test(value)) return false;
  const sum = [...value.slice(0, -1)].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(value.at(-1));
}

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

/**
 * Un número o texto cualquiera no se interpreta como trazabilidad: solo un código GS1 declarado, el texto con identificadores
 * explícitos, un enlace o cadena GS1 con un GTIN válido, o un código de barras de producto (EAN/UPC/ITF-14).
 */
export function parseProductCode(payload: unknown): ProductCode {
  const read: CodeRead = typeof payload === "string" ? { text: payload } : payload && typeof (payload as CodeRead).text === "string" ? payload as CodeRead : { text: "" };
  const raw = read.text.replace(/\x1d/g, "|").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 1500);
  const source = read.text.trim().slice(0, 1500);
  // Código de barras de producto: el número es el GTIN. Un Code128 interno de solo números no lo es.
  const retail = !read.format || /EAN|UPC/i.test(read.format) || (/ITF/i.test(read.format) && source.length === 14);
  const barcode = retail && validGtin(source) ? { gtin: source.replace(/^0+(?=\d{8})/, "") } as Partial<ProductCode> : null;
  const link = parseDigitalLink(source);
  const element = read.gs1 || (/^(?:\]d2|\]C1|\]Q3)?01\d{14}/.test(source) && validGtin(source.replace(/^\](?:d2|C1|Q3)/, "").slice(2, 16)));
  const found = (source && (barcode ?? parseParenthesised(source) ?? (link?.gtin && validGtin(link.gtin) ? link : null) ?? (element ? parseRawGs1(source) : null) ?? parseLabelled(source))) || {};
  const gtin = found.gtin ?? "";
  return {
    lot: cleanCode(found.lot ?? ""), serial: cleanCode(found.serial ?? ""), expiry: cleanExpiry(found.expiry ?? ""),
    manufactured: cleanExpiry(found.manufactured ?? ""), reference: cleanCode(found.reference ?? ""), gtin: /^\d{8,14}$/.test(gtin) ? gtin : "", raw,
  };
}

/** ¿El código aportó algún dato de trazabilidad que pueda completar el formulario? */
export const codeHasFields = (code: ProductCode) => !!(code.lot || code.serial || code.expiry || code.manufactured || code.reference || code.gtin);

/** ¿Dicen lo mismo? «2028-11» y «2028-11-25» no se contradicen: una etiqueta puede imprimir solo el mes. */
export function sameValue(key: string, a: string, b: string): boolean {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  return x === y || ((key === "expiry" || key === "manufactured") && (x.startsWith(y) || y.startsWith(x)));
}

/** Datos que identifican un envase concreto. */
const IDENTIFIERS = ["gtin", "lot", "serial", "expiry", "manufactured"] as const;
type Identified = Partial<Record<typeof IDENTIFIERS[number], string>>;

/**
 * ¿Son dos productos distintos? Entre lecturas exactas (códigos) basta un dato distinto. Frente al texto leído por la IA,
 * un solo lote o fecha distinto puede ser un error de lectura: se exige GTIN o serie distintos, o dos datos distintos.
 */
export function otherProduct(a: Identified, b: Identified, exact: boolean): boolean {
  const different = IDENTIFIERS.filter(key => a[key] && b[key] && !sameValue(key, a[key]!, b[key]!));
  return exact ? different.length > 0 : different.includes("gtin") || different.includes("serial") || different.length > 1;
}

/** Une varios códigos de una misma etiqueta (p. ej. Data Matrix y código de barras). Si son de productos distintos, no se usa ninguno. */
export function parseProductCodes(payloads: Array<string | CodeRead>): ProductCode & { mixed: boolean } {
  const all = payloads.map(parseProductCode);
  if (all.some((code, index) => all.slice(index + 1).some(next => otherProduct(code, next, true))))
    return { lot: "", serial: "", expiry: "", manufactured: "", reference: "", gtin: "", raw: "", mixed: true };
  const first = (key: keyof ProductCode) => all.find(code => code[key])?.[key] ?? "";
  return {
    lot: first("lot"), serial: first("serial"), expiry: first("expiry"), manufactured: first("manufactured"), reference: first("reference"), gtin: first("gtin"),
    raw: [...new Set(all.map(code => code.raw).filter(Boolean))].join(" | ").slice(0, 1500), mixed: false,
  };
}
