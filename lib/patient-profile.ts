/**
 * Datos adicionales de la ficha de ingreso (estilo DentalSoft): identificación ampliada, contactos,
 * dirección complementaria, datos de atención y personas vinculadas. Todo es opcional y se deja vacío
 * si no se informa; nada de esto es un dato clínico.
 */
export type PatientContact = { name: string; relationship: string; phone: string };

export type PatientProfile = {
  socialName: string;
  maritalStatus: string;
  education: string;
  taxId: string;
  gender: string;
  otherPhone: string;
  homePhone: string;
  officePhone: string;
  address2: string;
  city: string;
  holderType: "titular" | "carga";
  patientType: string;
  institution: string;
  agreement: string;
  insurance: string;
  insurer: string;
  branch: string;
  attendingDentist: string;
  referral: string;
  companions: PatientContact[];
  responsibles: PatientContact[];
};

export const MARITAL_STATUS = ["Soltero/a", "Casado/a", "Conviviente civil", "Separado/a", "Divorciado/a", "Viudo/a"] as const;
export const EDUCATION_LEVELS = ["Sin estudios", "Básica", "Media", "Técnica", "Universitaria", "Postgrado"] as const;
export const GENDERS = ["Femenino", "Masculino", "Otro", "Prefiere no decir"] as const;
export const PATIENT_TYPES = ["Particular", "Convenio", "Institución", "Pediátrico", "Adulto mayor"] as const;
export const INSURANCES = ["Fonasa", "Banmédica", "Colmena", "Consalud", "Cruz Blanca", "Esencial", "Nueva Masvida", "Vida Tres", "Capredena", "Dipreca", "Particular", "Otra"] as const;
export const REFERRALS = ["Internet", "Familiar", "Personal", "Otro paciente", "Prensa"] as const;
export const MAX_CONTACTS = 6;

const LIMITS = { short: 80, long: 160, phone: 24 } as const;
const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
const oneOf = (value: unknown, options: readonly string[]) => { const v = clean(value, LIMITS.short); return options.includes(v) ? v : ""; };

export const emptyProfile = (): PatientProfile => ({
  socialName: "", maritalStatus: "", education: "", taxId: "", gender: "", otherPhone: "", homePhone: "", officePhone: "",
  address2: "", city: "", holderType: "titular", patientType: "", institution: "", agreement: "", insurance: "", insurer: "",
  branch: "", attendingDentist: "", referral: "", companions: [], responsibles: [],
});

export function normalizeContacts(input: unknown): PatientContact[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_CONTACTS)
    .map(item => {
      const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return { name: clean(raw.name, LIMITS.long), relationship: clean(raw.relationship, LIMITS.short), phone: clean(raw.phone, LIMITS.phone) };
    })
    .filter(contact => contact.name || contact.phone);
}

/** Normaliza cualquier entrada: valores desconocidos de las listas quedan vacíos; textos libres se limpian y acotan. */
export function normalizeProfile(input: unknown): PatientProfile {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    socialName: clean(raw.socialName, LIMITS.long),
    maritalStatus: oneOf(raw.maritalStatus, MARITAL_STATUS),
    education: oneOf(raw.education, EDUCATION_LEVELS),
    taxId: clean(raw.taxId, 30),
    gender: oneOf(raw.gender, GENDERS),
    otherPhone: clean(raw.otherPhone, LIMITS.phone),
    homePhone: clean(raw.homePhone, LIMITS.phone),
    officePhone: clean(raw.officePhone, LIMITS.phone),
    address2: clean(raw.address2, LIMITS.long),
    city: clean(raw.city, LIMITS.short),
    holderType: raw.holderType === "carga" ? "carga" : "titular",
    patientType: oneOf(raw.patientType, PATIENT_TYPES),
    institution: clean(raw.institution, LIMITS.long),
    agreement: clean(raw.agreement, LIMITS.long),
    insurance: oneOf(raw.insurance, INSURANCES),
    insurer: clean(raw.insurer, LIMITS.long),
    branch: clean(raw.branch, LIMITS.long),
    attendingDentist: clean(raw.attendingDentist, LIMITS.long),
    referral: oneOf(raw.referral, REFERRALS),
    companions: normalizeContacts(raw.companions),
    responsibles: normalizeContacts(raw.responsibles),
  };
}

/** Un teléfono adicional es válido si está vacío o tiene entre 7 y 15 dígitos (mismo criterio laxo que el teléfono principal). */
export const validExtraPhone = (value: string) => !value.trim() || (/^[+\d\s().-]+$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15);

export function profileHasData(profile: PatientProfile): boolean {
  const base = emptyProfile();
  return (Object.keys(base) as (keyof PatientProfile)[]).some(key => JSON.stringify(profile[key]) !== JSON.stringify(base[key]));
}

export function profilePhonesValid(profile: PatientProfile): boolean {
  return [profile.otherPhone, profile.homePhone, profile.officePhone, ...profile.companions.map(c => c.phone), ...profile.responsibles.map(c => c.phone)].every(validExtraPhone);
}
