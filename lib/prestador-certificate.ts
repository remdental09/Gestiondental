// Certificado de inscripción en el Registro Nacional de Prestadores Individuales de Salud (Superintendencia de Salud).
// Se lee el texto del PDF y se conservan SOLO los datos necesarios para identificar al profesional en una receta.
// No se guardan fecha de nacimiento, sexo, nacionalidad ni el archivo.
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

const isoDate = (day: number, month: number, year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

export function parsePrestadorCertificate(rawText: string, today = new Date()): ParsedCertificate {
  const text = tidy(rawText);
  if (!/SUPERINTENDENCIA DE SALUD/i.test(text) || !/CERTIFICADO DE INSCRIPCI[ÓO]N/i.test(text) || !/PRESTADORES INDIVIDUALES DE SALUD/i.test(text)) {
    return { ok: false, error: "Este PDF no parece un Certificado de inscripción en el Registro Nacional de Prestadores Individuales de Salud." };
  }
  const regSis = /figura,?\s*bajo\s*el\s*N[°º.]?\s*(\d{3,8})\b/i.exec(text)?.[1] ?? "";
  const run = normalizeRun(/RUN:?\s*([\d.]{6,12}\s*-?\s*[\dkK])/i.exec(text)?.[1] ?? "");
  const fullName = tidy(/Nombre Completo:?\s*(.+?)\s+(?:Sexo|Nacionalidad|Fecha nacimiento)\s*:/i.exec(text)?.[1] ?? "").slice(0, 120);
  const validationCode = /c[oó]digo\s+validaci[oó]n:?\s*([A-Za-z0-9]{6,20})\b/i.exec(text)?.[1] ?? "";
  const issued = /Otorgado\s+en\s+[^,]{2,40},\s*con\s+fecha\s+(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})/i.exec(text);
  const month = issued ? MONTHS[issued[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")] : undefined;
  if (!regSis || !run || !fullName || !validationCode || !issued || !month) return { ok: false, error: "No se pudieron leer todos los datos del certificado. Descarga de nuevo el PDF original, sin editarlo ni escanearlo." };
  if (!isValidChileanRut(run)) return { ok: false, error: "El RUN del certificado no es válido." };
  const issuedOn = isoDate(Number(issued[1]), month, Number(issued[3]));
  const issuedAt = new Date(`${issuedOn}T12:00:00Z`);
  if (Number.isNaN(issuedAt.getTime())) return { ok: false, error: "La fecha del certificado no es válida." };
  const ageDays = (today.getTime() - issuedAt.getTime()) / 86_400_000;
  if (ageDays < -1) return { ok: false, error: "La fecha del certificado es futura. Revisa el PDF." };
  if (ageDays > MAX_CERTIFICATE_AGE_DAYS) return { ok: false, error: `El certificado tiene más de ${MAX_CERTIFICATE_AGE_DAYS} días. Descarga uno nuevo en ${RNPI_SITE}.` };

  const professionSection = /Orden Profesional:?\s*(.*?)(?=Especialidad(?:es)? Certificada|Profesional se encuentra|Otorgado en|$)/i.exec(text)?.[1] ?? "";
  const specialtySection = /Especialidad(?:es)? Certificadas?:?\s*(.*?)(?=Profesional se encuentra|Otorgado en|$)/i.exec(text)?.[1] ?? "";
  const titles = (section: string) => [...section.matchAll(/-\s*([^:]{3,100}?):\s*Posee/gi)].map(match => tidy(match[1]));
  const profession = titles(professionSection)[0] ?? "";
  if (!profession) return { ok: false, error: "El certificado no indica la profesión inscrita." };
  return { ok: true, data: { regSis, run, fullName, profession, specialties: titles(specialtySection).slice(0, 4), issuedOn, validationCode } };
}

export type PublicRegistration = { regSis: string; run: string; fullName: string; profession: string; specialties: string[]; issuedOn: string; validationCode: string };

/** Línea exigida por el reglamento de farmacias: «REG-SIS Nº: …» junto a profesión y RUN del profesional. */
export const registrationLine = (reg: Pick<PublicRegistration, "regSis">) => `REG-SIS Nº: ${reg.regSis}`;
