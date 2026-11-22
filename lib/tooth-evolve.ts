/**
 * «Evolucionar la pieza» a mano: el clínico registra qué se hizo en una pieza ya diagnosticada (obturación, corona, implante,
 * extracción, lesión o solo una nota), con su fecha. Aquí se traduce ese gesto a los guardados que el odontograma ya conoce,
 * para que cada paso deje su hito fechado y la película de la pieza gane una etapa. Lógica pura.
 */
import { faceName } from "./tooth-story.ts";
import type { OdontogramSurface } from "../app/clinical-data.ts";

export const EVOLVE_MATERIALS = ["Resina compuesta", "Vidrio ionómero", "Amalgama", "Cavit", "IRM", "Eugenato", "Otro"] as const;
export const CROWN_MATERIALS = ["Zirconio", "Disilicato", "Metal cerámica", "Resina", "Otro"] as const;
const PROVISIONAL = new Set(["Cavit", "IRM", "Eugenato"]);

export type EvolveInput =
  | { kind: "obturacion"; surfaces: OdontogramSurface[]; material: string }
  | { kind: "corona"; material: string }
  | { kind: "implante"; status: "Implante" | "Implante con pilar"; crownMaterial?: string }
  | { kind: "extraccion"; reason: "caries" | "other" | "unknown" }
  | { kind: "lesion"; status: string }
  | { kind: "nota" };

export type EvolveStep = { action: string; [key: string]: unknown };

export const KIND_LABEL: Record<EvolveInput["kind"], string> = { obturacion: "Obturación", corona: "Corona", implante: "Implante", extraccion: "Extracción (pieza ausente)", lesion: "Lesión apical o fractura", nota: "Solo una nota" };

/** Valida el formulario; devuelve el mensaje para el clínico o null si está listo para guardar. */
export function evolveProblem(input: EvolveInput, note: string, date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Elige la fecha en que se hizo.";
  if (date > today) return "La fecha no puede ser futura.";
  if (input.kind === "obturacion" && !input.surfaces.length) return "Marca al menos una cara obturada.";
  if (input.kind === "obturacion" && !input.material) return "Elige el material de la obturación.";
  if (input.kind === "corona" && !input.material) return "Elige el material de la corona.";
  if (input.kind === "lesion" && !input.status) return "Elige la lesión.";
  if (input.kind === "nota" && !note.trim()) return "Escribe la evolución de la pieza.";
  return null;
}

/** Los guardados, en orden, que aplica el gesto. Todos llevan la fecha clínica elegida. */
export function evolveSteps(tooth: number, input: EvolveInput, date: string, note: string): EvolveStep[] {
  const detail = note.trim().slice(0, 300);
  const meta = (title?: string) => ({ clinicalDate: date, ...(title ? { historyTitle: title } : {}), ...(detail ? { historyDetail: detail } : {}) });
  switch (input.kind) {
    case "obturacion":
      return input.surfaces.map(surface => ({
        action: "setToothSurface", tooth, surface,
        finding: { condition: "restored", depth: null, icdas: null, activity: null, restorationMaterial: input.material, restorationStage: PROVISIONAL.has(input.material) ? "provisional" : "definitive" },
        ...meta(`Obturación en ${faceName(surface, tooth)}`),
      }));
    case "corona":
      return [
        { action: "setToothStatus", tooth, status: "Corona", ...meta("Corona colocada") },
        { action: "setCrownDetails", tooth, material: input.material, shade: "", foundation: "tooth", clinicalDate: date, historyTitle: `Corona de ${input.material}` },
      ];
    case "implante": {
      const steps: EvolveStep[] = [{ action: "setToothStatus", tooth, status: input.status, ...meta(input.status === "Implante" ? "Implante colocado" : "Implante con pilar") }];
      if (input.crownMaterial) steps.push({ action: "setCrownDetails", tooth, material: input.crownMaterial, shade: "", foundation: "implant", clinicalDate: date, historyTitle: `Corona sobre implante (${input.crownMaterial})` });
      return steps;
    }
    case "extraccion": {
      const steps: EvolveStep[] = [{ action: "setToothStatus", tooth, status: "Ausente", ...meta("Extracción: pieza ausente") }];
      if (input.reason !== "unknown") steps.push({ action: "setToothMissingReason", tooth, reason: input.reason, clinicalDate: date });
      return steps;
    }
    case "lesion":
      return [{ action: "setToothStatus", tooth, status: input.status, ...meta(`Diagnóstico: ${input.status}`) }];
    case "nota":
      return [{ action: "addToothNote", tooth, text: note.trim().slice(0, 400), clinicalDate: date }];
  }
}

/** Resumen para la confirmación antes de guardar. */
export function evolveSummary(tooth: number, input: EvolveInput, date: string): string {
  const day = date.split("-").reverse().join("-");
  switch (input.kind) {
    case "obturacion": return `obturación en ${input.surfaces.map(surface => faceName(surface, tooth)).join(", ")} (${input.material}), fechada ${day}`;
    case "corona": return `corona de ${input.material}, fechada ${day}`;
    case "implante": return `${input.status.toLowerCase()}${input.crownMaterial ? ` con corona de ${input.crownMaterial}` : ""}, fechado ${day}`;
    case "extraccion": return `extracción (pieza ausente), fechada ${day}`;
    case "lesion": return `${input.status}, fechada ${day}`;
    case "nota": return `nota de evolución, fechada ${day}`;
  }
}
