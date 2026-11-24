/**
 * Entrada con correo: la persona escribe su correo y recibe un código de 6 dígitos (sin pasar por Google,
 * así no queda ninguna cuenta de Google abierta en el navegador). Sin dependencias del runtime.
 */
export const EMAIL_MAX_LENGTH = 254;
/** Por correo: 5 códigos cada 10 minutos y 15 al día (impide llenar la bandeja de otra persona). */
export const EMAIL_LIMIT_SHORT = { limit: 5, windowMs: 10 * 60_000 };
export const EMAIL_LIMIT_DAY = { limit: 15, windowMs: 86_400_000 };

/** Correo normalizado (minúsculas, sin espacios) o null si no parece un correo. No acepta varios destinatarios ni saltos de línea. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH) return null;
  if (!/^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]{2,}$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || domain.startsWith(".") || domain.includes("..") || domain.startsWith("-")) return null;
  return email;
}
