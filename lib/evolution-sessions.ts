export type EvolutionDayNote = {
  id: number;
  date: string;
  clinicalDate?: string | null;
};

export type EvolutionDayGroup<T extends EvolutionDayNote> = {
  key: string;
  date: string;
  notes: T[];
};

const MONTHS: Record<string, string> = {
  ene: "01", enero: "01",
  feb: "02", febrero: "02",
  mar: "03", marzo: "03",
  abr: "04", abril: "04",
  may: "05", mayo: "05",
  jun: "06", junio: "06",
  jul: "07", julio: "07",
  ago: "08", agosto: "08",
  sep: "09", sept: "09", set: "09", septiembre: "09", setiembre: "09",
  oct: "10", octubre: "10",
  nov: "11", noviembre: "11",
  dic: "12", diciembre: "12",
};

function canonicalDay(note: EvolutionDayNote): string | null {
  const clinicalDate = note.clinicalDate?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(clinicalDate)) return clinicalDate;

  const label = note.date.trim();
  if (!label || /fecha de atenci[oó]n no consignada/iu.test(label)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(label)) return label;

  const match = label.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-CL")
    .match(/^(\d{1,2})\s+([\p{L}.]+)\s+(\d{4})$/u);
  if (match) {
    const month = MONTHS[match[2].replace(/\.$/u, "")];
    if (month) return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
  }

  return label.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-CL").replace(/\s+/gu, " ");
}

/** Agrupa visualmente por día clínico; los registros sin fecha conservan grupos individuales. */
export function groupEvolutionsByDay<T extends EvolutionDayNote>(notes: readonly T[]): EvolutionDayGroup<T>[] {
  const groups = new Map<string, EvolutionDayGroup<T>>();
  for (const note of notes) {
    const day = canonicalDay(note);
    const key = day ? `day:${day}` : `note:${note.id}`;
    const group = groups.get(key);
    if (group) group.notes.push(note);
    else groups.set(key, { key, date: note.date || note.clinicalDate || "Fecha de atención no consignada", notes: [note] });
  }
  return [...groups.values()];
}
