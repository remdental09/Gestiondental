// Verificación de documentos emitidos (receta, certificado, consentimiento).
// El QR lleva un código secreto largo; la página pública confirma origen, fecha y estado, sin datos clínicos ni del paciente.

export const VERIFY_PATH = "/api/verificar";
export type RevokedReason = "anulado" | "reemplazado";

export function newVerifyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const isVerifyToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);

export type HashedDocument = { ownerId: string; patientId: number; kind: string; title: string; content: string; createdBy: string; createdByName: string; issuedAt: string };

/** Huella SHA-256 del contenido emitido: si el registro cambia después de emitir, la verificación deja de coincidir. */
export async function documentHash(doc: HashedDocument): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([doc.ownerId, doc.patientId, doc.kind, doc.title, doc.content, doc.createdBy, doc.createdByName, doc.issuedAt]));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Código corto legible (p. ej. 3FA9-C21B-07D4) para dictarlo o compararlo a simple vista. */
export const shortCode = (hash: string) => (hash.slice(0, 12).toUpperCase().match(/.{1,4}/g) ?? []).join("-");

export const verificationUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${VERIFY_PATH}?t=${token}`;

export type VerificationState = "valido" | "anulado" | "reemplazado" | "alterado" | "no-emitido";

export function verificationState(row: { status: string; revokedAt: string; revokedReason: string; contentHash: string }, recomputedHash: string): VerificationState {
  if (row.status === "borrador" || !row.contentHash) return "no-emitido";
  if (row.contentHash !== recomputedHash) return "alterado";
  if (row.revokedAt) return row.revokedReason === "reemplazado" ? "reemplazado" : "anulado";
  return "valido";
}
