/**
 * A clinical write requires a patient name with at least two given-name and
 * two surname tokens. This deliberately checks only completeness; it does not
 * guess where compound names or surnames begin and end.
 */
export function hasFourNameParts(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 4 && parts.every(part => /[\p{L}]/u.test(part));
}

export function fullNameRequiredMessage() {
  return "Completa los dos nombres y los dos apellidos del paciente antes de guardar.";
}

export function normalizePatientName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Score a stored name against the name supplied by the clinician.
 * A shorter stored name matches when all its tokens appear, in order, in the
 * supplied name. This supports legacy records without guessing missing names.
 */
export function storedNameMatchScore(supplied: unknown, stored: unknown): number {
  if (typeof supplied !== "string" || typeof stored !== "string") return 0;
  const suppliedParts = normalizePatientName(supplied).split(/\s+/).filter(Boolean);
  const storedParts = normalizePatientName(stored).split(/\s+/).filter(Boolean);
  if (suppliedParts.length < 2 || storedParts.length < 2 || storedParts.length > suppliedParts.length) return 0;
  let next = 0;
  for (const part of suppliedParts) {
    if (part === storedParts[next]) next++;
    if (next === storedParts.length) return storedParts.length;
  }
  return 0;
}

export function bestStoredNameMatches<T extends { name: string }>(supplied: string, candidates: T[]): T[] {
  const scored = candidates.map(candidate => ({ candidate, score: storedNameMatchScore(supplied, candidate.name) }));
  const bestScore = Math.max(0, ...scored.map(item => item.score));
  return bestScore ? scored.filter(item => item.score === bestScore).map(item => item.candidate) : [];
}
