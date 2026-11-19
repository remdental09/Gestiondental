export const CLINICAL_DOCUMENT_KINDS = ["receta", "receta_magistral", "orden", "certificado", "consentimiento"] as const;
export type ClinicalDocumentKind = typeof CLINICAL_DOCUMENT_KINDS[number];
export type ClinicalDocumentContent = Record<string, string>;

const FIELDS: Record<ClinicalDocumentKind, Record<string, number>> = {
  receta: { indicacion: 800, prescripcion: 3000, instrucciones: 1800 },
  receta_magistral: { indicacion: 800, prescripcion: 3000, instrucciones: 1800 },
  orden: { diagnostico: 800, examenes: 3000, observaciones: 1800 },
  certificado: { motivo: 800, observaciones: 1800, vigencia: 300 },
  consentimiento: { procedimiento: 800, descripcion: 2500, riesgos: 3000, alternativas: 2000, declaracion: 1500 },
};

export const isClinicalDocumentKind = (value: unknown): value is ClinicalDocumentKind =>
  typeof value === "string" && CLINICAL_DOCUMENT_KINDS.includes(value as ClinicalDocumentKind);

export function cleanClinicalDocumentContent(kind: ClinicalDocumentKind, input: unknown): ClinicalDocumentContent {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(FIELDS[kind]).map(([key, max]) => [key,
    typeof source[key] === "string" ? source[key].normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "",
  ]));
}

export const CLINICAL_DOCUMENT_LABEL: Record<ClinicalDocumentKind, string> = {
  receta: "Receta médica", receta_magistral: "Receta magistral", orden: "Orden médica", certificado: "Certificado médico", consentimiento: "Consentimiento informado",
};

/** Las recetas (común y magistral) comparten diseño y exigen la habilitación del prestador para emitirse. */
export const isPrescriptionKind = (kind: string): boolean => kind === "receta" || kind === "receta_magistral";

export type PrescriptionLine = { name: string; detail: string };

/** Separa cada línea de la prescripción en medicamento (destacado) y pauta. No interpreta ni completa dosis. */
export function splitPrescriptionLines(text: string): PrescriptionLine[] {
  return text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map(line => {
    const cut = line.match(/\s[-–—·]\s|:\s|,\s/);
    if (!cut || cut.index === undefined || cut.index === 0) return { name: line, detail: "" };
    return { name: line.slice(0, cut.index).trim(), detail: line.slice(cut.index + cut[0].length).trim() };
  });
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate || "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
