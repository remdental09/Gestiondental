export type PatientAddress = { street: string; commune: string; country: string };

export const DEFAULT_COUNTRY = "Chile";
export const ADDRESS_LIMITS = { street: 160, commune: 80, country: 60 } as const;

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Normaliza la dirección. Si no hay calle ni comuna, el país por sí solo no cuenta como dirección. */
export function normalizeAddress(input: unknown): PatientAddress {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const street = clean(raw.street, ADDRESS_LIMITS.street);
  const commune = clean(raw.commune, ADDRESS_LIMITS.commune);
  const country = clean(raw.country, ADDRESS_LIMITS.country) || DEFAULT_COUNTRY;
  return { street, commune, country };
}

export const emptyAddress = (): PatientAddress => ({ street: "", commune: "", country: DEFAULT_COUNTRY });

export const hasAddress = (a: PatientAddress | undefined | null) => Boolean(a && (a.street || a.commune));

/** "Av. Providencia 1234, Providencia, Chile" */
export const formatAddress = (a: PatientAddress | undefined | null) =>
  a && hasAddress(a) ? [a.street, a.commune, a.country].filter(Boolean).join(", ") : "";
