/**
 * Tratamientos por pieza con estado. No se guardan aparte: se DERIVAN en cada lectura de lo que ya consta en la ficha
 * —prestaciones del presupuesto con pieza (plan) y procedimientos de las evoluciones que nombran la pieza (sesiones)—,
 * así una prestación sin código de arancel igual existe y avanza, y si se corrige la ficha el estado se corrige solo.
 *
 * Estados: planificado (está en el plan y no hay sesiones), en curso (hay sesiones y falta el cierre) y realizado.
 */
export type TreatmentFamily = "endodoncia" | "corona" | "implante" | "obturacion" | "provisorio" | "exodoncia" | "protesis" | "ortodoncia" | "otro";
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
  /** Última etapa alcanzada en tratamientos de varias sesiones (p. ej. «instrumentación»). */
  stage?: string;
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
  { family: "ortodoncia", name: "Ortodoncia", is: /bracket|ortodon|boton (?:para|de) traccion|tubo ortod|retenedor/, closes: /retiro de (?:brackets?|aparatologia|aparatos)|se retiran? (?:los )?brackets?|entrega de retenedor/, next: "Aparatología en boca." },
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
      const stage = stageOf(treatment.family, treatment.sessions);
      if (stage) treatment.stage = stage;
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

/** Etapas clínicas habituales por tratamiento, en orden; sirven para decir en qué va uno que quedó a medias. */
const STAGES: Partial<Record<TreatmentFamily, Array<[string, RegExp]>>> = {
  endodoncia: [["apertura y medicación", /apertura|trepanacion|pulpectom|medicacion|urgencia/], ["instrumentación", /instrumentacion|conductometr|preparacion (?:biomecanica|de conductos)/], ["conometría", /conometr|prueba de conos?/]],
  corona: [["perno o muñón", /perno|munon|poste/], ["tallado e impresión", /tallado|preparacion|impresion|escaneo/], ["provisorio", /provisori/], ["prueba", /prueba de/]],
  implante: [["instalación del implante", /instal\w* (?:el |un )?implante|se coloca\w* (?:el |un )?implante|cirugia de implante/], ["pilar de cicatrización", /pilar de cicatrizacion|segunda (?:cirugia|fase)/], ["impresión", /impresion|escaneo|transfer/]],
  protesis: [["impresión", /impresion/], ["prueba", /prueba de|rodetes|enfilado/]],
};
function stageOf(family: TreatmentFamily, sessions: TreatmentSession[]): string | null {
  const stages = STAGES[family];
  if (!stages) return null;
  let reached = -1;
  for (const session of sessions) { const plain = fold(session.text); stages.forEach(([, test], index) => { if (test.test(plain) && index > reached) reached = index; }); }
  return reached >= 0 ? stages[reached][0] : null;
}

/** Días sin avance a partir de los cuales un tratamiento a medias se avisa. */
const STALE_DAYS: Partial<Record<TreatmentFamily, number>> = { provisorio: 30, endodoncia: 21, corona: 30, protesis: 45, implante: 150 };
export type TreatmentAlert = { key: string; tooth: number; name: string; days: number; message: string };
const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * Pendientes por tiempo: tratamientos en curso sin sesiones hace más de lo razonable (provisorio sin definitiva,
 * endodoncia sin terminar…) y endodoncias terminadas sin rehabilitación posterior en la pieza.
 */
export function treatmentAlerts(all: Record<number, ToothTreatment[]>, today: string): TreatmentAlert[] {
  const out: TreatmentAlert[] = [];
  for (const list of Object.values(all)) for (const treatment of list) {
    const last = treatment.sessions[treatment.sessions.length - 1]?.date;
    if (!last) continue;
    const days = daysBetween(last, today);
    if (!Number.isFinite(days)) continue;
    const limit = STALE_DAYS[treatment.family];
    if (treatment.status === "en curso" && limit && days >= limit) {
      out.push({ key: treatment.key, tooth: treatment.tooth, name: treatment.name, days, message: `${treatment.name} sin avance hace ${days} días${treatment.stage ? ` (quedó en ${treatment.stage})` : ""}. ${treatment.next ?? ""}`.trim() });
    }
    if (treatment.family === "endodoncia" && treatment.status === "realizado" && days >= 30) {
      const rehabilitated = list.some((other) => (other.family === "corona" || other.family === "obturacion") && other.sessions.some((session) => session.date >= last));
      if (!rehabilitated) out.push({ key: `${treatment.key}:rehab`, tooth: treatment.tooth, name: "Endodoncia sin rehabilitar", days, message: `Endodoncia terminada hace ${days} días sin restauración definitiva ni corona registrada.` });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}

/** Lo que se dibuja en la pieza además de caras, estado y corona. */
export type ToothMarkKind = "endodoncia" | "perno" | "carilla" | "onlay" | "protesis" | "ortodoncia";
export type ToothMark = { kind: ToothMarkKind; status: TreatmentStatus; label: string };
export const MARK_LABEL: Record<ToothMarkKind, string> = { endodoncia: "Endodoncia", perno: "Perno / muñón", carilla: "Carilla", onlay: "Incrustación (onlay/inlay)", protesis: "Prótesis fija", ortodoncia: "Ortodoncia" };
export const MARK_SHORT: Record<ToothMarkKind, string> = { endodoncia: "E", perno: "P", carilla: "Ca", onlay: "On", protesis: "Pr", ortodoncia: "Or" };
const MARK_TEST: Array<[ToothMarkKind, RegExp, TreatmentFamily[]]> = [
  ["endodoncia", /./, ["endodoncia"]],
  ["perno", /perno|poste|munon/, ["corona", "endodoncia", "otro"]],
  ["carilla", /carilla/, ["corona", "obturacion", "otro"]],
  ["onlay", /onlay|inlay|incrustacion/, ["corona", "otro"]],
  ["protesis", /puente|pontico|protesis fija|pilar de puente/, ["protesis", "corona", "otro"]],
  ["ortodoncia", /./, ["ortodoncia"]],
];
const RANK: Record<TreatmentStatus, number> = { planificado: 0, "en curso": 1, realizado: 2 };

/** Marcas por pieza derivadas de sus tratamientos (plan y evoluciones); no se guardan aparte. */
export function toothMarks(all: Record<number, ToothTreatment[]>): Record<number, ToothMark[]> {
  const out: Record<number, ToothMark[]> = {};
  for (const [tooth, list] of Object.entries(all)) {
    const marks = new Map<ToothMarkKind, ToothMark>();
    for (const treatment of list) {
      const texts = [...treatment.sessions.map((session) => session.text), ...treatment.planned.map((link) => link.label)].map(fold);
      for (const [kind, test, families] of MARK_TEST) {
        if (!families.includes(treatment.family) || !texts.some((text) => test.test(text))) continue;
        // El perno o la carilla ya están puestos si alguna sesión los nombra, aunque la corona siga en curso.
        const placed = kind !== "endodoncia" && kind !== "ortodoncia" && treatment.sessions.some((session) => test.test(fold(session.text)));
        const status: TreatmentStatus = kind === "ortodoncia" ? (treatment.status === "realizado" ? "realizado" : treatment.sessions.length ? "en curso" : "planificado") : placed && treatment.status !== "planificado" ? (kind === "perno" ? "realizado" : treatment.status) : treatment.status;
        const prior = marks.get(kind);
        if (!prior || RANK[status] > RANK[prior.status]) marks.set(kind, { kind, status, label: MARK_LABEL[kind] });
      }
    }
    if (marks.size) out[Number(tooth)] = [...marks.values()];
  }
  return out;
}
