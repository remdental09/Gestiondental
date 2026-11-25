/**
 * Cómo se arma el borrador de un producto con lo que se lee de la foto (IA) y del código (QR, Data Matrix o barras). Puro.
 * El código es una lectura exacta y manda; la IA solo propone; lo escrito por el profesional no se pisa con la IA.
 */
import type { LabelReading, ProductDetail } from "./biomedical-products.ts";
import { codeHasFields, type ProductCode } from "./product-code.ts";

const READ_KEYS = ["brand", "model", "diameter", "length", "reference", "lot", "serial", "manufactured", "expiry", "manufacturer", "registration", "gtin"] as const;
const CODE_KEYS = ["lot", "serial", "expiry", "manufactured", "reference", "gtin"] as const;
export const CODE_KEY_LABEL: Record<string, string> = { lot: "lote", serial: "serie", expiry: "vencimiento", manufactured: "fabricación", reference: "referencia", gtin: "GTIN" };

export type ReadableDraft = Record<typeof READ_KEYS[number], string> & {
  details: ProductDetail[]; code: string; category: string; suggested: Set<string>; fromCode: Set<string>;
};

const same = (key: string, a: string, b: string) => {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  // «2028-11» y «2028-11-25» no se contradicen: una etiqueta puede imprimir solo el mes.
  return x === y || ((key === "expiry" || key === "manufactured") && (x.startsWith(y) || y.startsWith(x)));
};

/** Quita lo que había propuesto la IA de una foto anterior (al repetir la foto). */
export function clearSuggested<T extends ReadableDraft>(draft: T): T {
  const next = { ...draft, suggested: new Set<string>(), fromCode: new Set(draft.fromCode) };
  for (const key of draft.suggested) {
    if (key === "details") next.details = [];
    else if ((READ_KEYS as readonly string[]).includes(key)) (next as Record<string, unknown>)[key] = "";
  }
  return next;
}

export function applyLabel<T extends ReadableDraft>(draft: T, reading: LabelReading): { draft: T; mismatch: boolean } {
  const next = { ...draft, suggested: new Set(draft.suggested), fromCode: new Set(draft.fromCode) } as T;
  let mismatch = false;
  for (const key of READ_KEYS) {
    const value = reading[key];
    if (!value) continue;
    if (next.fromCode.has(key)) { if (!same(key, next[key], value)) mismatch = true; continue; }
    if (next[key] && !next.suggested.has(key)) continue;
    (next as Record<string, unknown>)[key] = value; next.suggested.add(key);
  }
  if (reading.other?.length && (!next.details.length || next.suggested.has("details"))) { next.details = reading.other; next.suggested.add("details"); }
  if (reading.category) next.category = reading.category;
  return { draft: next, mismatch };
}

export function applyCode<T extends ReadableDraft>(draft: T, code: ProductCode): { draft: T; mismatch: boolean; filled: string[] } {
  const next = { ...draft, suggested: new Set(draft.suggested), fromCode: new Set(draft.fromCode), code: code.raw } as T;
  let mismatch = false;
  const filled: string[] = [];
  if (codeHasFields(code)) for (const key of CODE_KEYS) {
    const value = code[key];
    if (!value) continue;
    if (next[key] && !same(key, next[key], value)) mismatch = true;
    (next as Record<string, unknown>)[key] = value; next.suggested.delete(key); next.fromCode.add(key); filled.push(CODE_KEY_LABEL[key]!);
  }
  return { draft: next, mismatch, filled };
}
