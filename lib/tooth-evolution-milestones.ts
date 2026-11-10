import type { ToothHistoryEvent } from "../app/clinical-data.ts";

type NoteLike = { id: number; title: string; body: string; clinicalDate?: string; recordedAt?: string; status?: string };

const VALID = (tooth: number) => [1, 2, 3, 4, 5, 6, 7, 8].includes(Math.floor(tooth / 10)) && tooth % 10 >= 1 && tooth % 10 <= (Math.floor(tooth / 10) >= 5 ? 5 : 8);
const dotted = (text: string) => [...text.matchAll(/(?<![\d.,])([1-8])\.([1-8])(?![\d])(?!\s*(?:mm|cm|ml|mg|%))/g)].map(m => Number(m[1]) * 10 + Number(m[2])).filter(VALID);

/**
 * Piezas que trata una evolución. Se toma el título («Endodoncia · FDI 4.5»); si el título no nombra pieza,
 * el cuerpo solo cuenta cuando nombra una única pieza FDI (así no se le atribuye la evolución a la pieza vecina).
 */
export function teethOfNote(note: Pick<NoteLike, "title" | "body">): number[] {
  const fromTitle = [...new Set(dotted(note.title))];
  if (fromTitle.length) return fromTitle;
  const fromBody = [...new Set(dotted(note.body))];
  return fromBody.length === 1 ? fromBody : [];
}

const firstLine = (body: string) => {
  const line = body.split("\n").map(part => part.trim()).find(part => part && !/^(?:motivo de consulta|anamnesis|examen|diagn[oó]stico|procedimientos?|plan)\b/i.test(part)) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
};

/** Cada evolución vigente aparece como hito fechado en la línea de tiempo de las piezas que trata, sea de la especialidad que sea. */
export function evolutionMilestones(notes: NoteLike[]): ToothHistoryEvent[] {
  return notes.filter(note => note.status !== "anulada").flatMap(note => teethOfNote(note).map(tooth => ({
    id: `evolution:${note.id}:${tooth}`,
    tooth,
    recordedAt: note.recordedAt ?? (note.clinicalDate ? `${note.clinicalDate}T12:00:00.000Z` : ""),
    clinicalDate: note.clinicalDate,
    eventType: "evolution" as const,
    source: "evolution" as const,
    sourceEvolutionId: note.id,
    title: note.title,
    detail: firstLine(note.body),
  })));
}
