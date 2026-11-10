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

type EndoCaseLike = {
  id: string; tooth: number; type: string; openedOn: string; pulpal: string; periapical: string; closedReason: string;
  sessions: Array<{ id: string; date: string; steps: string[]; medication: string }>;
  obturation: { date: string; technique: string };
  followUps: Array<{ id: string; date: string; outcome: string }>;
};

/**
 * Lo registrado en la pestaña Endodoncia, como hitos fechados de la pieza: apertura del caso (con diagnóstico),
 * sesiones, obturación y controles. Si la sesión o el control ya se envió a la historia clínica (evolución con el mismo
 * día y título «Endodoncia · FDI x» o «Control endodóntico · FDI x»), no se repite.
 */
export function endoMilestones(cases: EndoCaseLike[], notes: NoteLike[] = []): ToothHistoryEvent[] {
  const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
  const noted = (date: string, title: string) => notes.some(note => note.status !== "anulada" && note.clinicalDate === date && note.title === title);
  const at = (date: string) => `${date}T12:00:00.000Z`;
  const out: ToothHistoryEvent[] = [];
  for (const c of cases) {
    const base = { tooth: c.tooth, eventType: "evolution" as const, source: "evolution" as const };
    if (c.openedOn) out.push({ ...base, id: `endo:${c.id}:open`, recordedAt: at(c.openedOn), clinicalDate: c.openedOn,
      title: `Endodoncia iniciada · ${c.type}`, detail: [c.pulpal, c.periapical].filter(Boolean).join(" / ") });
    for (const s of c.sessions) {
      if (!s.date || noted(s.date, `Endodoncia · FDI ${fdi(c.tooth)}`)) continue;
      out.push({ ...base, id: `endo:${c.id}:session:${s.id}`, recordedAt: at(s.date), clinicalDate: s.date,
        title: `Sesión de endodoncia · ${c.type}`, detail: [s.steps.join(", "), s.medication ? `medicación: ${s.medication}` : ""].filter(Boolean).join(" · ") });
    }
    if (c.obturation.date) out.push({ ...base, id: `endo:${c.id}:obturation`, recordedAt: at(c.obturation.date), clinicalDate: c.obturation.date,
      title: "Endodoncia obturada", detail: c.obturation.technique });
    for (const f of c.followUps) {
      if (!f.date || noted(f.date, `Control endodóntico · FDI ${fdi(c.tooth)}`)) continue;
      out.push({ ...base, id: `endo:${c.id}:follow:${f.id}`, recordedAt: at(f.date), clinicalDate: f.date, title: "Control endodóntico", detail: f.outcome });
    }
  }
  return out;
}
