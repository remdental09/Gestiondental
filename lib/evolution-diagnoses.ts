/**
 * Etiquetas de diagnóstico confirmadas para una evolución (validación compartida por API y pruebas).
 * El servidor no confía en el título enviado para los códigos: lo toma del catálogo CIE-11 verificado.
 */
import { icd11Title, isStorableIcd11 } from "./icd11.ts";
import { isValidFdi } from "./dictation/proposal.ts";

export type DiagnosisOrigin = "reglas" | "ia" | "ia+reglas" | "manual";
export type EvolutionDiagnosisTag = {
  code: string;
  title: string;
  tooth: number | null;
  findings: string;
  evidence: string;
  origin: DiagnosisOrigin;
  suggestedFrom: "AAE" | "caries-pulpar" | "aproximado" | null;
};

export const MAX_DIAGNOSIS_TAGS = 30;
const ORIGINS: DiagnosisOrigin[] = ["reglas", "ia", "ia+reglas", "manual"];
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function sanitizeDiagnosisTags(value: unknown): { tags: EvolutionDiagnosisTag[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "Faltan las etiquetas de diagnóstico." };
  if (value.length > MAX_DIAGNOSIS_TAGS) return { error: `Máximo ${MAX_DIAGNOSIS_TAGS} diagnósticos por evolución.` };
  const tags: EvolutionDiagnosisTag[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Etiqueta de diagnóstico inválida." };
    const item = raw as Record<string, unknown>;
    const code = text(item.code, 40);
    if (code && !isStorableIcd11(code)) return { error: `El código ${code} no es un código CIE-11 guardable del catálogo.` };
    const title = code ? icd11Title(code) : text(item.title, 160);
    if (!title) return { error: "Un diagnóstico sin código necesita un nombre." };
    const toothValue = item.tooth === null || item.tooth === undefined || item.tooth === "" ? null : Number(item.tooth);
    if (toothValue !== null && !isValidFdi(toothValue)) return { error: "Pieza FDI inválida en un diagnóstico." };
    const origin = ORIGINS.includes(item.origin as DiagnosisOrigin) ? (item.origin as DiagnosisOrigin) : "manual";
    const suggestedFrom: EvolutionDiagnosisTag["suggestedFrom"] = item.suggestedFrom === "AAE" || item.suggestedFrom === "caries-pulpar" || item.suggestedFrom === "aproximado" ? item.suggestedFrom : null;
    const tag: EvolutionDiagnosisTag = { code, title, tooth: toothValue, findings: text(item.findings, 300), evidence: text(item.evidence, 400), origin, suggestedFrom };
    if (tags.some((done) => done.code === tag.code && done.title === tag.title && done.tooth === tag.tooth)) continue;
    tags.push(tag);
  }
  return { tags };
}

/** ¿Lo guardado coincide con lo enviado? (para verificar después de releer la ficha). */
export function sameDiagnosisTags(sent: EvolutionDiagnosisTag[], saved: Array<Partial<EvolutionDiagnosisTag>>): boolean {
  const key = (tag: Partial<EvolutionDiagnosisTag>) => `${tag.code ?? ""}|${tag.title ?? ""}|${tag.tooth ?? ""}|${tag.findings ?? ""}`;
  const a = sent.map(key).sort(), b = saved.map(key).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
