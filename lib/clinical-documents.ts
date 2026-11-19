export const CLINICAL_DOCUMENT_KINDS = ["receta", "certificado", "consentimiento"] as const;
export type ClinicalDocumentKind = typeof CLINICAL_DOCUMENT_KINDS[number];
export type ClinicalDocumentContent = Record<string, string>;

const FIELDS: Record<ClinicalDocumentKind, Record<string, number>> = {
  receta: { indicacion: 800, prescripcion: 3000, instrucciones: 1800 },
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
  receta: "Receta", certificado: "Certificado", consentimiento: "Consentimiento informado",
};
