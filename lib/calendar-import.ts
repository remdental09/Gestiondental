/**
 * Citas creadas directo en Google Calendar → citas de la app. Lógica pura (probada sin red ni base de datos).
 * Se reconoce al paciente por el título (exacto o con una letra de diferencia, sin tildes); si no hay certeza, queda «Sin paciente – asignar».
 */
import { patientForEvent, type TodayPatient } from "./today-agenda.ts";

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Cumpleaños, feriados, vacaciones y similares no son citas clínicas. */
const NON_CLINICAL = /\b(cumpleanos|cumple|birthday|feriado|holiday|vacaciones|dia libre|aniversario|almuerzo|bloqueo|bloqueado|no agendar|reunion|recordatorio)\b/;

export type ImportCandidate = { status?: string; summary?: string; start?: { dateTime?: string; date?: string } };
/** Solo citas con hora (no «todo el día»), confirmadas y que no se ven personales. */
export function isClinicalCandidate(event: ImportCandidate): boolean {
  if (event.status === "cancelled" || !event.start?.dateTime) return false;
  const title = fold(event.summary ?? "");
  return !!title && !NON_CLINICAL.test(title);
}
/** Ventana de importación: desde ayer hasta un año adelante (lo antiguo no se convierte en citas). */
export function inImportWindow(startIso: string, now: Date): boolean {
  const t = Date.parse(startIso);
  return Number.isFinite(t) && t >= now.getTime() - 86400000 && t <= now.getTime() + 366 * 86400000;
}

const distanceAtMostOne = (a: string, b: string) => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

/** Paciente del título: primero exacto (nombre y apellido, celular o correo), luego con una letra de diferencia en palabras largas. Si es ambiguo, null. */
export function matchPatientByTitle<P extends TodayPatient>(title: string, patients: P[]): P | null {
  const exact = patientForEvent({ id: 0, title, startAt: "", endAt: "", status: "confirmed", allDay: false, patientId: null }, patients);
  if (exact) return exact;
  const words = fold(title).split(" ").filter(Boolean);
  const has = (part: string) => words.some(word => part.length >= 5 ? distanceAtMostOne(word, part) : word === part);
  const fuzzy = patients.filter(patient => {
    const parts = fold(patient.name).split(" ").filter(part => part.length > 1);
    return parts.length >= 2 && has(parts[0]) && parts.slice(1).some(has);
  });
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

/** Motivo de la cita a partir del título, sin el nombre del paciente («Ana Pérez · Control: limpieza» → «Control: limpieza»). */
export function reasonFromTitle(title: string, patientName = ""): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const nameParts = new Set(fold(patientName).split(" ").filter(part => part.length > 1));
  if (clean.includes(" · ")) {
    const [first, ...rest] = clean.split(" · ");
    const firstWords = fold(first).split(" ").filter(Boolean);
    if (rest.length && nameParts.size && firstWords.every(word => nameParts.has(word))) return rest.join(" · ").slice(0, 500);
  }
  if (!nameParts.size) return clean.slice(0, 500) || "Cita";
  const kept = clean.split(" ").filter(word => !nameParts.has(fold(word)));
  const reason = kept.join(" ").replace(/^[\s\-–—:·,|/]+|[\s\-–—:·,|/]+$/g, "").trim();
  return (reason || "Cita").slice(0, 500);
}

/** ¿El título habla de un control? («Control Ana Pérez», «Ana Pérez - control 6 meses») */
export const isControlTitle = (title: string) => /\bcontrol(es)?\b/.test(fold(title));
/** Motivo del próximo control: lo que sigue a «Control», o «Control». */
export function controlReasonFrom(reason: string): string {
  const rest = reason.replace(/^\s*control(es)?\s*[:\-–·]?\s*/i, "").trim();
  return (rest || "Control").slice(0, 140);
}
