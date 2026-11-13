/** Registro mínimo del profesional: nombre, apellido, RUT (o documento extranjero) y especialidad. Lógica pura (sin acceso a la base). */
export const SPECIALTIES = [
  "Odontología general",
  "Implantología oral",
  "Endodoncia",
  "Periodoncia",
  "Rehabilitación oral",
  "Ortodoncia y ortopedia dentomaxilar",
  "Cirugía y traumatología bucal y maxilofacial",
  "Odontopediatría",
  "Imagenología oral y maxilofacial",
  "Trastornos temporomandibulares y dolor orofacial",
  "Patología oral",
  "Salud pública",
  "Otra",
] as const;

export type ProfessionalDocumentType = "rut" | "extranjero";
export type ClinicianProfile = { firstName: string; lastName: string; rut: string; specialty: string; /** Otros títulos o especialidades (texto libre, opcional). */ extraTitles?: string; /** Nombre de la clínica o consulta que se muestra arriba (opcional, hasta 60 caracteres). */ clinicName?: string };
export type ProfileCheck = { ok: true; profile: ClinicianProfile } | { ok: false; error: string };

const clean = (value: string) => value.toUpperCase().replace(/[^0-9K]/g, "");

export function validRut(value: string): boolean {
  const v = clean(value), body = v.slice(0, -1), digit = v.slice(-1);
  if (!/^\d{6,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0, factor = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const expected = 11 - (sum % 11);
  return (expected === 11 ? "0" : expected === 10 ? "K" : String(expected)) === digit;
}

/** 12.345.678-5 */
export function formatRut(value: string): string {
  const v = clean(value);
  if (v.length < 2) return v;
  return `${v.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${v.slice(-1)}`;
}

/** Documento extranjero (DNI, cédula, DPI, pasaporte…): de 4 a 20 letras o números, con al menos un número. Sin dígito verificador. */
export const cleanForeignDocument = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export function validForeignDocument(value: string): boolean {
  const v = cleanForeignDocument(value);
  return v.length >= 4 && v.length <= 20 && /\d/.test(v);
}
/** Un documento guardado que no es un RUT válido es un documento extranjero. */
export const professionalDocumentTypeOf = (stored: string | null | undefined): ProfessionalDocumentType => (stored && !validRut(stored) ? "extranjero" : "rut");
export const asProfessionalDocumentType = (value: unknown): ProfessionalDocumentType => (value === "extranjero" ? "extranjero" : "rut");
export const formatDocument = (value: string, type: ProfessionalDocumentType) => (type === "extranjero" ? cleanForeignDocument(value) : formatRut(value));
export const DOCUMENT_ERROR = { rut: "El RUT no es válido. Revisa el número y el dígito verificador.", extranjero: "El documento debe tener entre 4 y 20 letras o números, con al menos un número." } as const;

const NAME = /^[\p{L}][\p{L}' .-]{0,59}$/u;
const tidy = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export function checkProfile(input: unknown): ProfileCheck {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const firstName = tidy(raw.firstName), lastName = tidy(raw.lastName), rut = tidy(raw.rut), specialty = tidy(raw.specialty);
  if (!NAME.test(firstName)) return { ok: false, error: "Escribe tu nombre." };
  if (!NAME.test(lastName)) return { ok: false, error: "Escribe tu apellido." };
  const documentType = asProfessionalDocumentType(raw.documentType);
  if (documentType === "extranjero" ? !validForeignDocument(rut) : !validRut(rut)) return { ok: false, error: DOCUMENT_ERROR[documentType] };
  if (!(SPECIALTIES as readonly string[]).includes(specialty)) return { ok: false, error: "Elige tu especialidad." };
  const extraTitles = tidy(raw.extraTitles).slice(0, 300);
  const clinicName = tidy(raw.clinicName).slice(0, 60);
  return { ok: true, profile: { firstName, lastName, rut: formatDocument(rut, documentType), specialty, extraTitles, clinicName } };
}

export const displayName = (profile: Pick<ClinicianProfile, "firstName" | "lastName">) => `Dr(a). ${profile.firstName} ${profile.lastName}`;
