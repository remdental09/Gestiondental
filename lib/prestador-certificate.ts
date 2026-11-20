// Certificado de inscripción en el Registro Nacional de Prestadores Individuales de Salud (Superintendencia de Salud).
// Se lee el texto del PDF para obtener los datos que van en la receta (registro, profesión, código de validación).
// El PDF original se guarda de forma segura (R2, carpeta del profesional) y su QR se imprime en recetas y certificados.
import { isValidChileanRut } from "./patient-document.ts";

export type PrestadorCertificate = {
  regSis: string;
  run: string; // con guion, sin puntos: 12345678-5
  fullName: string;
  profession: string;
  specialties: string[];
  issuedOn: string; // AAAA-MM-DD
  validationCode: string;
};
export type ParsedCertificate = { ok: true; data: PrestadorCertificate } | { ok: false; error: string };

export const MAX_CERTIFICATE_AGE_DAYS = 180;
export const VALIDATION_SITE = "emisorcertificados.superdesalud.gob.cl/ValidacionCertificados";
export const RNPI_SITE = "rnpi.superdesalud.gob.cl";

const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const tidy = (value: string) => value.replace(/\s+/g, " ").trim();

/** 13.051.751-K → 13051751-K (con guion, sin puntos, DV en mayúscula). Devuelve "" si no tiene forma de RUN. */
export function normalizeRun(value: string): string {
  const compact = value.replace(/[.\s]/g, "").toUpperCase();
  const match = /^(\d{6,9})-?([0-9K])$/.exec(compact);
  return match ? `${match[1]}-${match[2]}` : "";
}

export const sameRun = (a: string, b: string) => { const x = normalizeRun(a), y = normalizeRun(b); return Boolean(x) && x === y; };

/** Un nombre: al menos dos palabras con letras, sin «:» (una etiqueta como «Sexo:» no es un nombre). */
function plausibleName(value: string): string {
  const name = tidy(value).slice(0, 120);
  return !name.includes(":") && name.split(" ").filter(word => /\p{L}/u.test(word)).length >= 2 ? name : "";
}

const isoDate = (day: number, month: number, year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function parsePrestadorCertificate(rawText: string, today = new Date()): ParsedCertificate {
  const text = tidy(rawText);
  if (!/SUPERINTENDENCIA DE SALUD/i.test(text) || !/CERTIFICADO DE INSCRIPCI[ÓO]N/i.test(text) || !/PRESTADORES INDIVIDUALES DE SALUD/i.test(text)) {
    return { ok: false, error: "Este PDF no parece un Certificado de inscripción en el Registro Nacional de Prestadores Individuales de Salud." };
  }
  // Tolerante a cómo cada visor de PDF copia el texto: «N°», «Nº», «No.» o «número»; «RUN» o «R.U.N.»; saltos de línea y espacios variables.
  const regSis = /figura,?\s*bajo\s*el\s*(?:N[°º.o]{0,2}|n[úu]mero)\s*:?\s*(\d{3,8})\b/i.exec(text)?.[1] ?? "";
  // Algunos PDF entregan primero los valores y después la lista de etiquetas («RUN:», «Nombre Completo:»…): se prueba «etiqueta: valor» y, si no, el valor suelto.
  let run = normalizeRun(/R\.?\s*U\.?\s*[NT]\.?\s*:?\s*([\d.]{6,12}\s*-?\s*[\dkK])/i.exec(text)?.[1] ?? "");
  if (!run) for (const match of text.matchAll(/\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g)) { const candidate = normalizeRun(match[0]); if (candidate && isValidChileanRut(candidate)) { run = candidate; break; } }
  let fullName = plausibleName(/Nombre\s+Completo\s*:?\s*(.+?)\s+(?:Sexo|Nacionalidad|Fecha\s+(?:de\s+)?nacimiento|Orden\s+Profesional)\b/i.exec(text)?.[1] ?? "");
  if (!fullName) {
    // Valores sueltos: el nombre es la línea que antecede al sexo.
    const lines = rawText.split(/\r?\n/).map(tidy).filter(Boolean);
    const at = lines.findIndex(line => /^(masculino|femenino|otro)$/i.test(line));
    if (at > 0) fullName = plausibleName(lines[at - 1]);
  }
  const validationCode = /c[oó]digo\s+validaci[oó]n:?\s*([A-Za-z0-9]{6,20})\b/i.exec(text)?.[1] ?? ""; // opcional: al copiar el texto desde un visor puede faltar el encabezado
  // «Otorgado en Santiago, con fecha 19 de noviembre de 2026» (también «del 2026» o 19/11/2026).
  const wordDate = /Otorgado\s*en\s+[^,]{2,60},\s*con\s*fecha\s*:?\s*(\d{1,2})\s*de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s*de(?:l)?\s*(\d{4})/i.exec(text);
  const numericDate = /Otorgado\s*en\s+[^,]{2,60},\s*con\s*fecha\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i.exec(text);
  const issued = wordDate ?? numericDate;
  const month = wordDate ? MONTHS[wordDate[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] : numericDate ? Number(numericDate[2]) : undefined;
  const missing = [!regSis && "N° de registro", !run && "RUN", !fullName && "nombre", !(issued && month && month >= 1 && month <= 12) && "fecha de otorgamiento"].filter(Boolean) as string[];
  if (missing.length || !issued || !month) return { ok: false, error: `No se pudieron leer estos datos del certificado: ${missing.join(", ")}. Copia todo el texto de la primera página (Seleccionar todo) o sube el PDF original, sin editarlo ni escanearlo.` };
  if (!isValidChileanRut(run)) return { ok: false, error: "El RUN del certificado no es válido." };
  const issuedOn = isoDate(Number(issued[1]), month, Number(issued[3]));
  const issuedAt = new Date(`${issuedOn}T12:00:00Z`);
  if (Number.isNaN(issuedAt.getTime())) return { ok: false, error: "La fecha del certificado no es válida." };
  const ageDays = (today.getTime() - issuedAt.getTime()) / 86_400_000;
  if (ageDays < -1) return { ok: false, error: "La fecha del certificado es futura. Revisa el PDF." };
  if (ageDays > MAX_CERTIFICATE_AGE_DAYS) return { ok: false, error: `El certificado tiene más de ${MAX_CERTIFICATE_AGE_DAYS} días. Descarga uno nuevo en ${RNPI_SITE}.` };

  // Cada título figura como «- Nombre: Posee título de …». La especialidad dice «título de especialista»; lo demás es la profesión.
  // Se clasifica por ese texto y no por la etiqueta cercana, porque el orden de bloques cambia según el PDF.
  const entries = [...text.matchAll(/-\s*([^:]{3,100}?):\s*(Posee\s+[^.]{0,60})/gi)].map(match => ({ title: tidy(match[1]), specialty: /^Posee\s+(?:t[ií]tulo\s+de\s+)?(?:especialista|especialidad|certificaci[oó]n)/i.test(match[2]) }));
  const profession = entries.find(entry => !entry.specialty)?.title ?? "";
  const specialties = entries.filter(entry => entry.specialty).map(entry => entry.title);
  if (!profession) return { ok: false, error: "El certificado no indica la profesión inscrita." };
  return { ok: true, data: { regSis, run, fullName, profession, specialties: specialties.slice(0, 4), issuedOn, validationCode } };
}

export type PublicRegistration = { regSis: string; run: string; fullName: string; profession: string; specialties: string[]; issuedOn: string; validationCode: string; qrUrl?: string };

/** Línea exigida por el reglamento de farmacias: «REG-SIS Nº: …» junto a profesión y RUN del profesional. */
export const registrationLine = (reg: Pick<PublicRegistration, "regSis">) => `REG-SIS Nº: ${reg.regSis}`;
