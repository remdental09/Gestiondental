/** Aranceles: precio propio de cada profesional por prestación del catálogo (CLP enteros). */
export const MAX_PRICE = 100_000_000;

export type PriceMap = Record<string, number>;

/** Precio válido: entero entre 1 y MAX_PRICE. Devuelve null si no lo es. */
export function normalizePrice(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[.\s$]/g, "").replace(",", ".")) : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_PRICE) return null;
  return n;
}

/** Deja solo códigos de 7 dígitos con precio válido. */
export function normalizePriceMap(input: unknown): PriceMap {
  const out: PriceMap = {};
  if (!input || typeof input !== "object") return out;
  for (const [code, value] of Object.entries(input as Record<string, unknown>)) {
    const price = normalizePrice(value);
    if (/^\d{7}$/.test(code) && price !== null) out[code] = price;
  }
  return out;
}
