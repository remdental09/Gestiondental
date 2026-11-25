/**
 * Cómo se arma el borrador de un producto con lo que se lee de la foto (IA) y del código (QR, Data Matrix o barras). Puro.
 * Reglas: nunca se mezclan datos de dos productos; lo escrito por el profesional no se pisa; entre lo leído, el código
 * (lectura exacta) manda sobre la IA; lo que se leyó de una foto se descarta cuando esa foto se reemplaza.
 */
import type { LabelReading, ProductDetail } from "./biomedical-products.ts";
import { codeHasFields, otherProduct, sameValue, type ProductCode } from "./product-code.ts";

const READ_KEYS = ["brand", "model", "diameter", "length", "reference", "lot", "serial", "manufactured", "expiry", "manufacturer", "registration", "gtin"] as const;
const CODE_KEYS = ["lot", "serial", "expiry", "manufactured", "reference", "gtin"] as const;
export const CODE_KEY_LABEL: Record<string, string> = { lot: "lote", serial: "serie", expiry: "vencimiento", manufactured: "fabricación", reference: "referencia", gtin: "GTIN" };

export type ReadableDraft = Record<typeof READ_KEYS[number], string> & {
  details: ProductDetail[]; code: string; category: string;
  /** Quién puso el tipo de producto: nadie (valor inicial), la lectura o el profesional. */
  categoryBy: "" | "read" | "user";
  /** Propuesto por la IA / leído de un código. Lo que no está en ninguno lo escribió el profesional. */
  suggested: Set<string>; fromCode: Set<string>;
  /** Código leído con la cámara en vivo (no depende de la foto). */
  scan: ProductCode | null;
};

const copy = <T extends ReadableDraft>(draft: T): T => ({ ...draft, suggested: new Set(draft.suggested), fromCode: new Set(draft.fromCode) });
/** Solo los datos del borrador que vienen de una lectura. */
const picked = (draft: ReadableDraft, keys: Set<string>): Record<string, string> =>
  Object.fromEntries(READ_KEYS.filter(key => keys.has(key)).map(key => [key, draft[key]]));

/** Quita todo lo leído (IA y códigos); queda lo escrito a mano. */
export function clearRead<T extends ReadableDraft>(draft: T): T {
  const next = { ...draft, suggested: new Set<string>(), fromCode: new Set<string>(), code: "", scan: null };
  for (const key of new Set([...draft.suggested, ...draft.fromCode])) {
    if (key === "details") next.details = [];
    else if ((READ_KEYS as readonly string[]).includes(key)) (next as Record<string, unknown>)[key] = "";
  }
  if (draft.categoryBy === "read") { next.category = "implante"; next.categoryBy = ""; }
  return next;
}

export function applyLabel<T extends ReadableDraft>(draft: T, reading: LabelReading): { draft: T; mismatch: boolean } {
  const next = copy(draft);
  let mismatch = false;
  for (const key of READ_KEYS) {
    const value = reading[key];
    if (!value) continue;
    if (next.fromCode.has(key) || (next[key] && !next.suggested.has(key))) { if (!sameValue(key, next[key], value) && (CODE_KEYS as readonly string[]).includes(key)) mismatch = true; continue; }
    (next as Record<string, unknown>)[key] = value; next.suggested.add(key);
  }
  if (reading.other?.length && (!next.details.length || next.suggested.has("details"))) { next.details = reading.other; next.suggested.add("details"); }
  if (reading.category && next.categoryBy !== "user") { next.category = reading.category; next.categoryBy = "read"; }
  return { draft: next, mismatch };
}

/** `kept`: datos escritos a mano que el código contradice (se mantienen y se avisa). */
export function applyCode<T extends ReadableDraft>(draft: T, code: ProductCode): { draft: T; mismatch: boolean; filled: string[]; kept: string[] } {
  const next = copy(draft);
  next.code = [...new Set([...(next.code ? next.code.split(" | ") : []), ...(code.raw ? code.raw.split(" | ") : [])])].join(" | ").slice(0, 1500);
  let mismatch = false;
  const filled: string[] = [], kept: string[] = [];
  if (codeHasFields(code)) for (const key of CODE_KEYS) {
    const value = code[key];
    if (!value) continue;
    const read = next.suggested.has(key) || next.fromCode.has(key);
    if (next[key] && !read) { if (!sameValue(key, next[key], value)) kept.push(CODE_KEY_LABEL[key]!); continue; }
    if (next[key] && !sameValue(key, next[key], value)) mismatch = true;
    (next as Record<string, unknown>)[key] = value; next.suggested.delete(key); next.fromCode.add(key); filled.push(CODE_KEY_LABEL[key]!);
  }
  return { draft: next, mismatch, filled, kept };
}

/** Foto nueva (reemplaza a la anterior). El código escaneado antes se conserva solo si es del mismo producto. */
export function applyPhoto<T extends ReadableDraft>(draft: T, code: ProductCode | null, reading: LabelReading | null): { draft: T; mismatch: boolean; filled: string[]; kept: string[]; droppedScan: boolean } {
  let next = clearRead(draft), mismatch = false, droppedScan = false;
  const filled: string[] = [], kept: string[] = [];
  const add = (result: ReturnType<typeof applyCode<T>>) => { next = result.draft; mismatch ||= result.mismatch; filled.push(...result.filled); kept.push(...result.kept); };
  const scan = draft.scan;
  if (scan) {
    // Si el código de la foto trae el mismo lote o serie, es el mismo envase aunque la IA lea mal el texto.
    const confirmed = !!code && !!(code.lot || code.serial) && !otherProduct(scan, code, true);
    droppedScan = !confirmed && ((!!code && otherProduct(scan, code, true)) || (!!reading && otherProduct(scan, reading, false)));
  }
  if (scan && !droppedScan) { add(applyCode(next, scan)); next.scan = scan; }
  if (code) add(applyCode(next, code));
  if (reading) { const result = applyLabel(next, reading); next = result.draft; mismatch ||= result.mismatch; }
  return { draft: next, mismatch, filled: [...new Set(filled)], kept: [...new Set(kept)], droppedScan };
}

/**
 * Código leído con la cámara. Sin foto, reemplaza al escaneo anterior. Con foto, solo se agrega si es del mismo producto:
 * si no, se rechaza (`rejected`) y el borrador no cambia.
 */
export function applyScan<T extends ReadableDraft>(draft: T, scan: ProductCode, hasPhoto: boolean): { draft: T; mismatch: boolean; filled: string[]; kept: string[]; rejected: boolean } {
  if (hasPhoto && (otherProduct(scan, picked(draft, draft.fromCode), true) || otherProduct(scan, picked(draft, draft.suggested), false)))
    return { draft, mismatch: false, filled: [], kept: [], rejected: true };
  const result = applyCode(hasPhoto ? draft : clearRead(draft), scan);
  result.draft.scan = scan;
  return { ...result, rejected: false };
}
