/**
 * Documento de identidad del paciente. Chile usa RUN/RUT con dígito verificador; los pacientes extranjeros se
 * inscriben con el documento de su país (DNI, cédula, DPI, pasaporte…), que no tiene un formato común.
 * Se guarda en la misma columna `rut`: el RUT sin puntos ni guion, el documento extranjero en mayúsculas y solo
 * con letras y números (sin tildes, espacios ni guiones).
 */
export type DocumentType = "rut" | "extranjero";

export const FOREIGN_DOCUMENT_MIN = 4;
export const FOREIGN_DOCUMENT_MAX = 20;

export const cleanRutValue = (value: string) => value.toUpperCase().replace(/[^0-9K]/g, "");

export function isValidChileanRut(value: string): boolean {
  const clean = cleanRutValue(value), body = clean.slice(0, -1), digit = clean.slice(-1);
  if (!/^\d{1,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0, factor = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) { sum += Number(body[index]) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const expected = 11 - (sum % 11);
  return (expected === 11 ? "0" : expected === 10 ? "K" : String(expected)) === digit;
}

export function formatChileanRut(value: string): string {
  const clean = cleanRutValue(value), body = clean.slice(0, -1), digit = clean.slice(-1);
  return body ? `${Number(body).toLocaleString("es-CL")}-${digit}` : value;
}

export const cleanForeignDocument = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Cualquier documento del mundo: de 4 a 20 letras o números y al menos un dígito. */
export function isValidForeignDocument(value: string): boolean {
  const clean = cleanForeignDocument(value);
  return clean.length >= FOREIGN_DOCUMENT_MIN && clean.length <= FOREIGN_DOCUMENT_MAX && /\d/.test(clean);
}

export const asDocumentType = (value: unknown): DocumentType => (value === "extranjero" ? "extranjero" : "rut");

/** Tipo de un documento ya guardado: un RUT válido es chileno; cualquier otra cosa es un documento extranjero. */
export const documentTypeOf = (stored: string | null | undefined): DocumentType => (stored && !isValidChileanRut(stored) ? "extranjero" : "rut");

export const isValidDocument = (value: string, type: DocumentType) => (type === "extranjero" ? isValidForeignDocument(value) : isValidChileanRut(value));

/** Valor que se guarda en la columna `rut`. */
export const storedDocument = (value: string, type: DocumentType) => (type === "extranjero" ? cleanForeignDocument(value) : cleanRutValue(value));

/** Valor que se muestra y se envía al servidor: el RUT con puntos y guion, el documento extranjero limpio. */
export const displayDocument = (value: string, type: DocumentType = documentTypeOf(value)) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return type === "extranjero" ? cleanForeignDocument(trimmed) : isValidChileanRut(trimmed) ? formatChileanRut(trimmed) : trimmed;
};

export const DOCUMENT_LABEL: Record<DocumentType, string> = { rut: "RUN / RUT chileno", extranjero: "Documento extranjero (DNI, cédula, DPI, pasaporte…)" };
export const documentInvalidMessage = (type: DocumentType) => (type === "extranjero" ? "El documento debe tener entre 4 y 20 letras o números, con al menos un número." : "RUT o dígito verificador no válido.");
