import type { OdontogramData } from "../../app/clinical-data.ts";
import type { BudgetItem } from "../budget-plans.ts";
import { auditChart } from "../chart-audit.ts";

/**
 * Auditoría posterior al llenado (capa 1: reglas fijas, sin IA).
 * Mira lo que quedó GUARDADO en la ficha de un paciente (odontograma, presupuestos, evoluciones) y marca combinaciones
 * imposibles o sospechosas. No corrige ni borra nada: cada observación dice qué revisar. Es una función pura, así que
 * se prueba con fichas sintéticas y da siempre el mismo resultado para los mismos datos.
 */
export type AuditSeverity = "alta" | "media";
export type AuditFinding = {
  /** Identificador estable: la misma observación sobre los mismos datos tiene siempre la misma clave (para «Real» / «Falsa alarma»). */
  key: string;
  rule: AuditRule;
  severity: AuditSeverity;
  patientId: number;
  tooth?: number;
  message: string;
  fix: string;
  budgetId?: number;
  noteId?: number;
};
export type AuditRule = "odontograma" | "pendiente-sin-pieza" | "cobro-duplicado" | "hecha-sin-registro" | "material-distinto" | "evolucion-pieza-inexistente";

export type AuditBudget = { id: number; title?: string; items: BudgetItem[] };
export type AuditNote = { id: number; clinicalDate: string; body: string; status?: string };
export type AuditInput = {
  patientId: number;
  chart: OdontogramData;
  budgets: AuditBudget[];
  notes: AuditNote[];
  /** Día actual (AAAA-MM-DD, Chile). Las reglas sobre trabajo «realizado» solo miran los últimos `recentDays`. */
  today: string;
  recentDays?: number;
};

const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const PERMANENT = new Set([11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48]);
const PRIMARY = new Set([51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]);

/** Prestaciones que restauran una pieza (obturaciones, composites, ionómeros, reconstrucciones). */
const RESTORATION = new Set(["5005001", "5005002", "5005004", "5005005", "5005006", "5005017", "5005018", "5005024", "5005025", "5005035", "5005036", "5005037", "5005040", "5005041"]);
const AMALGAM = new Set(["5005001", "5005002"]);
const NOT_AMALGAM = new Set(["5005004", "5005005", "5005006", "5005017", "5005018", "5005024", "5005025", "5005035", "5005040", "5005041"]);
const isEndodontic = (code: string) => code.startsWith("5006");
const NO_TOOTH_TO_RESTORE = new Set(["Ausente", "Implante", "Implante con pilar"]);
/** Estados en los que no se espera una obturación visible en las caras. */
const NO_FACE_FILLING = new Set(["Ausente", "Implante", "Implante con pilar", "Corona", "Resto radicular con endodoncia", "Indicación de exodoncia"]);

const daysBefore = (today: string, days: number) => {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
};
const sortedTeeth = (item: BudgetItem) => [...(item.teeth ?? [])].sort((a, b) => a - b);

export function auditRecord(input: AuditInput): AuditFinding[] {
  const { patientId, chart, budgets, notes, today } = input;
  const since = daysBefore(today, input.recentDays ?? 30);
  const out: AuditFinding[] = [];
  const add = (finding: Omit<AuditFinding, "patientId">) => out.push({ patientId, ...finding });
  const statusOf = (tooth: number) => chart.teeth[tooth] ?? "Sin hallazgos";

  // 1. Combinaciones imposibles en el odontograma (reutiliza la auditoría que ya ve el profesional en el odontograma).
  for (const issue of auditChart(chart))
    add({ key: `odontograma|${patientId}|${issue.tooth}|${issue.problem}`, rule: "odontograma", severity: "media", tooth: issue.tooth, message: `FDI ${fdi(issue.tooth)}: ${issue.problem}`, fix: issue.fix });

  for (const budget of budgets) {
    // 3. Mismo cobro dos veces en el mismo presupuesto (misma prestación y mismas piezas).
    const seen = new Map<string, number>();
    budget.items.forEach((item, index) => {
      if (!item.code || !item.teeth?.length) return;
      const signature = `${item.code}|${sortedTeeth(item).join(",")}`;
      const first = seen.get(signature);
      if (first === undefined) { seen.set(signature, index); return; }
      add({
        key: `cobro-duplicado|${patientId}|${budget.id}|${signature}`, rule: "cobro-duplicado", severity: "media", tooth: item.teeth[0], budgetId: budget.id,
        message: `«${item.label}» figura dos veces para ${sortedTeeth(item).map(fdi).join(", ")} en el mismo presupuesto.`,
        fix: "Si no son dos sesiones distintas, deja solo una.",
      });
    });

    budget.items.forEach((item) => {
      const code = item.code ?? "";
      const teeth = item.teeth ?? [];
      if (!code || !teeth.length) return;
      const pending = !item.doneOn;

      // 2. Trabajo pendiente sobre una pieza que no existe (ausente o implante): obturación o endodoncia.
      if (pending && (RESTORATION.has(code) || isEndodontic(code)))
        for (const tooth of teeth) if (NO_TOOTH_TO_RESTORE.has(statusOf(tooth)))
          add({
            key: `pendiente-sin-pieza|${patientId}|${budget.id}|${code}|${tooth}`, rule: "pendiente-sin-pieza", severity: "alta", tooth, budgetId: budget.id,
            message: `«${item.label}» está pendiente en FDI ${fdi(tooth)}, pero esa pieza figura como ${statusOf(tooth).toLowerCase()}.`,
            fix: "Revisa si la pieza es la correcta o si el estado del odontograma está mal.",
          });

      // 4. Obturación realizada hace poco sin ninguna obturación registrada en la pieza.
      if (item.doneOn && item.doneOn >= since && RESTORATION.has(code))
        for (const tooth of teeth) {
          const faces = Object.values(chart.surfaces[tooth] ?? {});
          const filled = faces.some((face) => face?.condition === "restored" || face?.condition === "other_restoration");
          if (filled || NO_FACE_FILLING.has(statusOf(tooth)) || chart.crowns?.[tooth]) continue;
          const caries = faces.some((face) => face?.condition === "caries");
          add({
            key: `hecha-sin-registro|${patientId}|${budget.id}|${code}|${tooth}`, rule: "hecha-sin-registro", severity: "media", tooth, budgetId: budget.id,
            message: `«${item.label}» figura realizada en FDI ${fdi(tooth)}, pero el odontograma ${caries ? "todavía muestra caries" : "no muestra ninguna obturación"} en esa pieza.`,
            fix: caries ? "Si la caries se obturó, actualiza las caras; si solo se inactivó, el cobro debería ser otro." : "Registra la obturación en las caras tratadas o revisa el cobro.",
          });
        }

      // 5. Material cobrado distinto del material registrado en las caras de la pieza (solo si se dictó el material).
      if (item.doneOn && item.doneOn >= since && (AMALGAM.has(code) || NOT_AMALGAM.has(code)))
        for (const tooth of teeth) {
          const materials = Object.values(chart.surfaces[tooth] ?? {}).filter((face) => face?.condition === "restored" && face.restorationMaterial).map((face) => face!.restorationMaterial);
          if (!materials.length) continue;
          const hasAmalgam = materials.includes("Amalgama");
          if ((AMALGAM.has(code) && !hasAmalgam) || (NOT_AMALGAM.has(code) && materials.every((material) => material === "Amalgama")))
            add({
              key: `material-distinto|${patientId}|${budget.id}|${code}|${tooth}`, rule: "material-distinto", severity: "media", tooth, budgetId: budget.id,
              message: `En FDI ${fdi(tooth)} se cobró «${item.label}», pero el odontograma registra ${[...new Set(materials)].join(" / ").toLowerCase()}.`,
              fix: "Revisa cuál es el material real y corrige el cobro o el odontograma.",
            });
        }
    });
  }

  // 7. Evoluciones recientes que nombran una pieza FDI inexistente (p. ej. «pieza 1.9»).
  for (const note of notes) {
    if (note.status === "anulada" || note.clinicalDate < since) continue;
    const bad = new Set<number>();
    for (const match of note.body.matchAll(/\b(?:piezas?|dientes?|molar(?:es)?|premolar(?:es)?|incisivos?|caninos?)\s+([1-8])\.(\d)\b/gi)) {
      const tooth = Number(match[1]) * 10 + Number(match[2]);
      if (!PERMANENT.has(tooth) && !PRIMARY.has(tooth)) bad.add(tooth);
    }
    for (const tooth of bad)
      add({
        key: `evolucion-pieza-inexistente|${patientId}|${note.id}|${tooth}`, rule: "evolucion-pieza-inexistente", severity: "alta", tooth: undefined, noteId: note.id,
        message: `La evolución del ${note.clinicalDate} nombra la pieza ${fdi(tooth)}, que no existe en la numeración FDI.`,
        fix: "Corrige el número de la pieza en la evolución.",
      });
  }

  return out;
}
