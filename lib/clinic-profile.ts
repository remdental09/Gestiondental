/** Perfil de la clínica: nombre, contacto, horario e imagen. Lógica pura (sin acceso a la base). */
export type ClinicProfile = {
  clinicName: string; address: string; city: string; email: string;
  phone: string; phone2: string; openTime: string; closeTime: string;
  /** Imagen como data URL (png, jpeg o webp), de 200x200 px como máximo. */
  logo: string;
};
export const EMPTY_CLINIC: ClinicProfile = { clinicName: "", address: "", city: "", email: "", phone: "", phone2: "", openTime: "", closeTime: "", logo: "" };
export const LOGO_MAX_SIDE = 200;
export const LOGO_MAX_CHARS = 80_000;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Deja el teléfono como «+56 9 1234 5678»: solo dígitos tras el prefijo; sin prefijo se asume Chile. */
export function formatPhone(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const national = raw.startsWith("+") ? digits : digits.startsWith("56") && digits.length >= 11 ? digits : `56${digits}`;
  const rest = national.slice(2);
  if (national.startsWith("56") && rest.length === 9) return `+56 ${rest[0]} ${rest.slice(1, 5)} ${rest.slice(5)}`;
  return `+${national}`;
}
export const validPhone = (value: string) => /^\+\d{8,15}$/.test(value.replace(/\s/g, ""));
export const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
export const validLogo = (value: string) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= LOGO_MAX_CHARS;

export type ClinicCheck = { ok: true; clinic: ClinicProfile } | { ok: false; error: string };

export function checkClinic(input: unknown): ClinicCheck {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const clinic: ClinicProfile = {
    clinicName: text(b.clinicName, 60), address: text(b.address, 120), city: text(b.city, 60),
    email: text(b.email, 120).toLowerCase(), phone: formatPhone(text(b.phone, 30)), phone2: formatPhone(text(b.phone2, 30)),
    openTime: text(b.openTime, 5), closeTime: text(b.closeTime, 5),
    logo: typeof b.logo === "string" ? b.logo.trim() : "",
  };
  if (clinic.email && !validEmail(clinic.email)) return { ok: false, error: "El email de contacto no es válido." };
  if (clinic.phone && !validPhone(clinic.phone)) return { ok: false, error: "El teléfono principal no es válido." };
  if (clinic.phone2 && !validPhone(clinic.phone2)) return { ok: false, error: "El teléfono secundario no es válido." };
  if (clinic.openTime && !validTime(clinic.openTime)) return { ok: false, error: "La hora de apertura no es válida (HH:MM)." };
  if (clinic.closeTime && !validTime(clinic.closeTime)) return { ok: false, error: "La hora de cierre no es válida (HH:MM)." };
  if (!!clinic.openTime !== !!clinic.closeTime) return { ok: false, error: "Indica la hora de apertura y la de cierre, o deja ambas vacías." };
  if (clinic.openTime && clinic.closeTime && clinic.openTime >= clinic.closeTime) return { ok: false, error: "La hora de cierre debe ser posterior a la de apertura." };
  if (clinic.logo && !validLogo(clinic.logo)) return { ok: false, error: "La imagen no es válida o pesa demasiado (máximo 200x200 px)." };
  return { ok: true, clinic };
}
