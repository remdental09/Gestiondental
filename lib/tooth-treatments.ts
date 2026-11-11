/**
 * Tratamientos por pieza con estado. No se guardan aparte: se DERIVAN en cada lectura de lo que ya consta en la ficha
 * —prestaciones del presupuesto con pieza (plan) y procedimientos de las evoluciones que nombran la pieza (sesiones)—,
 * así una prestación sin código de arancel igual existe y avanza, y si se corrige la ficha el estado se corrige solo.
 *
 * Estados: planificado (está en el plan y no hay sesiones), en curso (hay sesiones y falta el cierre) y realizado.
 */
export type TreatmentFamily = "endodoncia" | "corona" | "implante" | "obturacion" | "provisorio" | "exodoncia" | "protesis" | "otro";
export type TreatmentStatus = "planificado" | "en curso" | "realizado";
export type TreatmentSession = { date: string; text: string; noteId?: number };
export type PlannedLink = { budgetId: number; index: number; label: string; budgetTitle?: string; doneOn?: string };
export type ToothTreatment = {
  key: string;
  tooth: number;
  family: TreatmentFamily;
  name: string;
  status: TreatmentStatus;
  sessions: TreatmentSession[];
  planned: PlannedLink[];
  /** Qué falta, cuando el tratamiento quedó a medias. */
  next?: string;
  /** Prestación del plan que la evolución ya da por terminada pero sigue «pendiente» en el presupuesto. */
  closable?: PlannedLink;
};

type SessionInput = { tooth: number; date?: string; text: string; noteId?: number };
type PlanInput = PlannedLink & { tooth: number };

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type FamilyRule = { family: TreatmentFamily; name: string; is: RegExp; closes?: RegExp; next?: string; single?: boolean };
/** El orden importa: lo más específico primero («corona sobre implante» es de implante; «corona provisoria» es de corona). */
const RULES: FamilyRule[] = [
  { family: "implante", name: "Implante", is: /implante|pilar de cicatrizacion|segunda (?:cirugia|fase)|oseointegra/, closes: /corona sobre implante|corona (?:atornillada|cementada) sobre|rehabilitacion sobre implante|se (?:instala|atornilla|cementa)\w* (?:la )?corona/, next: "Falta la rehabilitación sobre el implante." },
  { family: "endodoncia", name: "Endodoncia", is: /endodon|tratamiento de conductos?|pulpectom|trepanacion|apertura cameral|instrumentacion|conometr|conductometr|gutapercha|medicacion intraconducto|obturacion de (?:los )?conductos?/, closes: /gutapercha|obturacion de (?:los )?conductos?|(?:endodoncia|tratamiento de conductos?) (?:terminad|finalizad|completad)\w*|se obturan? (?:los )?conductos?/, next: "Falta obturar los conductos." },
  { family: "corona", name: "Corona", is: /corona|tallado|munon|perno|prueba de (?:metal|estructura|casquete|bizcocho)|incrustacion|onlay|inlay|carilla/, closes: /(?:se )?cementa\w* (?:la |una )?(?:corona|incrustacion|onlay|inlay|carilla)(?! provisori)|(?:corona|incrustacion|carilla) (?:definitiva )?cementada(?! provisori)|cementacion definitiva|instalacion de (?:la )?corona definitiva/, next: "Falta el cementado definitivo." },
  { family: "protesis", name: "Prótesis", is: /protesis|puente|rebasado/, closes: /se (?:instala|entrega)\w* (?:la )?protesis|instalacion de (?:la )?protesis|se cementa\w* (?:el )?puente/, next: "Falta la instalación." },
  { family: "exodoncia", name: "Exodoncia", is: /exodoncia|extraccion|se extrae/, single: true },
  { family: "provisorio", name: "Obturación provisoria", is: /provisori|cavit|\birm\b|eugenat|oxido de zinc|inactiva/, next: "Falta la restauración definitiva." },
  { family: "obturacion", name: "Obturación", is: /obtura|restaura|resina|composite|amalgama|ionomero|reconstru/, single: true },
];
const ruleFor = (text: string): FamilyRule | null => {
  const plain = fold(text);
  // «Corona provisoria» y «provisorio de la corona» pertenecen al tratamiento de corona, no a una obturación provisoria.
  return RULES.find((rule) => rule.is.test(plain)) ?? null;
};
const shortName = (text: string) => { const clean = text.replace(/\s+/g, " ").trim().replace(/[.;,]+$/, ""); return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean; };

export function toothTreatments(sessions: SessionInput[], planned: PlanInput[]): Record<number, ToothTreatment[]> {
  const byKey = new Map<string, ToothTreatment>();
  const rules = new Map<string, FamilyRule | null>();
  const entry = (tooth: number, rule: FamilyRule | null, label: string): ToothTreatment => {
    const key = rule ? `${tooth}:${rule.family}` : `${tooth}:otro:${fold(label).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 48)}`;
    let found = byKey.get(key);
    if (!found) { found = { key, tooth, family: rule?.family ?? "otro", name: rule?.name ?? shortName(label), status: "planificado", sessions: [], planned: [] }; byKey.set(key, found); rules.set(key, rule); }
    return found;
  };
  for (const item of planned) {
    const { tooth, ...link } = item;
    entry(tooth, ruleFor(item.label), item.label).planned.push(link);
  }
  for (const session of [...sessions].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
    entry(session.tooth, ruleFor(session.text), session.text).sessions.push({ date: session.date ?? "", text: session.text, ...(session.noteId ? { noteId: session.noteId } : {}) });
  }
  // Una obturación definitiva posterior cierra la provisoria de esa pieza.
  for (const treatment of byKey.values()) {
    if (treatment.family !== "provisorio" || !treatment.sessions.length) continue;
    const definitive = byKey.get(`${treatment.tooth}:obturacion`);
    const lastProvisional = treatment.sessions[treatment.sessions.length - 1].date;
    if (definitive?.sessions.some((session) => session.date >= lastProvisional)) treatment.status = "realizado";
  }
  for (const treatment of byKey.values()) {
    const rule = rules.get(treatment.key) ?? null;
    const pending = treatment.planned.filter((link) => !link.doneOn);
    const closedByNote = treatment.sessions.length > 0 && (!rule || rule.single || (rule.closes ? treatment.sessions.some((session) => rule.closes!.test(fold(session.text))) : false));
    const closedByPlan = treatment.planned.length > 0 && pending.length === 0;
    if (treatment.status === "realizado" || closedByNote || closedByPlan) {
      treatment.status = "realizado";
      if (closedByNote && pending.length === 1) treatment.closable = pending[0];
    } else if (treatment.sessions.length > 0) {
      treatment.status = "en curso";
      if (rule?.next) treatment.next = rule.next;
    } else treatment.status = "planificado";
  }
  const out: Record<number, ToothTreatment[]> = {};
  const order: Record<TreatmentStatus, number> = { "en curso": 0, planificado: 1, realizado: 2 };
  for (const treatment of byKey.values()) (out[treatment.tooth] ??= []).push(treatment);
  for (const list of Object.values(out)) list.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return out;
}

/** Tratamientos que quedaron a medias en toda la boca (para avisar pendientes). */
export function openTreatments(all: Record<number, ToothTreatment[]>): ToothTreatment[] {
  return Object.values(all).flat().filter((treatment) => treatment.status === "en curso").sort((a, b) => a.tooth - b.tooth);
}

export type TreatmentAdvance = { key: string; tooth: number; name: string; from: TreatmentStatus | "nuevo"; to: TreatmentStatus; next?: string; closable?: PlannedLink };

/**
 * Qué tratamientos avanza una evolución nueva: compara el estado de cada pieza antes y después de sumar sus sesiones.
 * Sirve para mostrarlo al revisar el dictado y ofrecer cerrar en el presupuesto lo que la evolución da por terminado.
 */
export function treatmentAdvances(before: SessionInput[], planned: PlanInput[], added: SessionInput[]): TreatmentAdvance[] {
  if (!added.length) return [];
  const prior = toothTreatments(before, planned);
  const after = toothTreatments([...before, ...added], planned);
  const touched = new Set(added.map((session) => session.tooth));
  const out: TreatmentAdvance[] = [];
  for (const tooth of touched) for (const treatment of after[tooth] ?? []) {
    const was = (prior[tooth] ?? []).find((item) => item.key === treatment.key);
    if (was && was.sessions.length === treatment.sessions.length) continue;
    out.push({ key: treatment.key, tooth, name: treatment.name, from: was?.status ?? "nuevo", to: treatment.status, ...(treatment.next ? { next: treatment.next } : {}), ...(treatment.closable ? { closable: treatment.closable } : {}) });
  }
  return out.sort((a, b) => a.tooth - b.tooth || a.name.localeCompare(b.name));
}
