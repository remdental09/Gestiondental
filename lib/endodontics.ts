/** Endograma: ficha endodóntica por pieza (al estilo de los programas de especialidad como TDO). Sin datos de pacientes. */

export const CASE_TYPES = ["Tratamiento de conducto", "Retratamiento", "Pulpotomía", "Pulpectomía", "Recubrimiento pulpar directo", "Apexificación", "Endodoncia regenerativa", "Cirugía apical (apicectomía)", "Urgencia endodóntica"] as const;

/** Diagnósticos AAE (consenso 2009, terminología usada en Chile). */
export const PULPAL_DX = ["Pulpa normal", "Pulpitis reversible", "Pulpitis irreversible sintomática", "Pulpitis irreversible asintomática", "Necrosis pulpar", "Previamente tratado", "Previamente iniciado"] as const;
export const PERIAPICAL_DX = ["Tejidos apicales normales", "Periodontitis apical sintomática", "Periodontitis apical asintomática", "Absceso apical agudo", "Absceso apical crónico", "Osteítis condensante"] as const;
export const DIFFICULTY = ["Mínima", "Moderada", "Alta"] as const;

export const TESTS = [
  { key: "frio", label: "Frío", options: ["Normal", "Sin respuesta", "Aumentada", "Prolongada (>10 s)", "Retardada", "No realizada"] },
  { key: "calor", label: "Calor", options: ["Normal", "Sin respuesta", "Aumentada", "Prolongada", "Alivia con frío", "No realizada"] },
  { key: "electrico", label: "Test eléctrico", options: ["Responde", "Sin respuesta", "No realizado"] },
  { key: "percusion", label: "Percusión", options: ["Negativa", "Leve", "Moderada", "Intensa"] },
  { key: "palpacion", label: "Palpación apical", options: ["Negativa", "Sensible", "Aumento de volumen"] },
  { key: "mordida", label: "Test de mordida", options: ["Negativo", "Positivo", "Positivo al soltar", "No realizado"] },
  { key: "movilidad", label: "Movilidad", options: ["0", "1", "2", "3"] },
  { key: "sondaje", label: "Sondaje periodontal", options: ["Normal (≤3 mm)", "Bolsa localizada", "Bolsa estrecha y profunda", "Fístula trazable"] },
] as const;
export type TestKey = typeof TESTS[number]["key"];

export const CANAL_NAMES = ["Único", "V", "P", "MV", "MV2", "DV", "M", "D", "ML", "MB", "DL", "DB", "L", "Mesial medio"] as const;
export const REFERENCE_POINTS = ["Cúspide vestibular", "Cúspide palatina", "Cúspide lingual", "Cúspide MV", "Cúspide DV", "Cúspide MB", "Cúspide DB", "Borde incisal", "Reborde marginal"] as const;
export const SESSION_STEPS = ["Anestesia", "Aislamiento absoluto", "Acceso cameral", "Localización de conductos", "Permeabilización", "Conductometría", "Preparación químico-mecánica", "Medicación intraconducto", "Obturación", "Sellado coronario"] as const;
export const IRRIGANTS = ["NaOCl 2,5 %", "NaOCl 5,25 %", "EDTA 17 %", "Clorhexidina 2 %", "Suero fisiológico", "Activación ultrasónica"] as const;
export const MEDICATIONS = ["Ninguna", "Hidróxido de calcio", "Hidróxido de calcio + CHX", "Pasta triantibiótica", "Ledermix"] as const;
export const OBTURATION_TECHNIQUES = ["Condensación lateral", "Onda continua de calor", "Cono único", "Termoplástica inyectada", "Gutapercha con portador (Thermafil)"] as const;
export const SEALERS = ["AH Plus", "Biocerámico (BC Sealer / Bio-C)", "Sealapex", "Grossman", "Top Seal", "Otro"] as const;
export const CORONAL_SEALS = ["Ionómero de vidrio", "Resina compuesta", "Cavit / IRM", "Restauración definitiva", "Corona provisoria"] as const;
export const RX_STAGES = ["Diagnóstica", "Conductometría", "Cono maestro", "Obturación", "Control", "CBCT"] as const;
export const OUTCOMES = ["Sanado", "En cicatrización", "No sanado", "Incierto"] as const;
/** Índice periapical de Ørstavik. */
export const PAI = [
  { value: 1, label: "1 · Estructura periapical normal" },
  { value: 2, label: "2 · Pequeños cambios óseos" },
  { value: 3, label: "3 · Cambios con pérdida mineral" },
  { value: 4, label: "4 · Periodontitis con radiolucidez definida" },
  { value: 5, label: "5 · Periodontitis severa con exacerbación" },
] as const;

export type EndoCanal = {
  id: string;
  name: string;
  /** Longitud aparente o tentativa en la RX diagnóstica (mm). */
  apparentLength: number;
  /** Lectura del localizador apical (mm). */
  apexLocator: number;
  /** Longitud de trabajo definitiva (mm). */
  workingLength: number;
  reference: string;
  /** Distancia de la LT al ápice radiográfico (mm). */
  apexDistance: number;
  /** Lima apical maestra: calibre/conicidad, p. ej. 40/.04. */
  masterFile: string;
  /** Cono maestro (calibre/conicidad). */
  masterCone: string;
  notes: string;
};
export type EndoSession = { id: string; date: string; steps: string[]; irrigants: string[]; medication: string; temporary: string; notes: string };
export type EndoRx = { imageId: number; stage: string; date: string };
export type EndoFollowUp = { id: string; date: string; pai: number; symptoms: string; outcome: string; notes: string };
export type EndoCase = {
  id: string;
  tooth: number;
  type: string;
  openedOn: string;
  complaint: string;
  pain: string;
  tests: Record<TestKey, string>;
  pulpal: string;
  periapical: string;
  difficulty: string;
  diagnosisNotes: string;
  canals: EndoCanal[];
  sessions: EndoSession[];
  obturation: { date: string; technique: string; sealer: string; coronalSeal: string; notes: string };
  rx: EndoRx[];
  followUps: EndoFollowUp[];
  nextControlDate: string;
  /** Derivado, extraído o abandonado: cierra el caso sin obturación. */
  closedReason: string;
  /** Endodoncia ya tratada antes de la consulta (sin ficha técnica): marca la pieza como obturada. */
  prior?: boolean;
  /** Año aproximado del tratamiento previo (opcional). */
  priorYear?: string;
};
export type EndoData = { version: 1; cases: EndoCase[] };

export const emptyEndo = (): EndoData => ({ version: 1, cases: [] });
export const emptyTests = () => Object.fromEntries(TESTS.map(test => [test.key, ""])) as Record<TestKey, string>;
/** Caso mínimo para una pieza que ya llegó endodonciada. */
export const priorCase = (id: string, tooth: number, openedOn: string, year = ""): EndoCase => ({ ...newCase(id, tooth, openedOn), pulpal: "Previamente tratado", prior: true, priorYear: year });
export const newCase = (id: string, tooth: number, openedOn: string): EndoCase => ({
  id, tooth, type: CASE_TYPES[0], openedOn, complaint: "", pain: "", tests: emptyTests(), pulpal: "", periapical: "", difficulty: "", diagnosisNotes: "",
  canals: [], sessions: [], obturation: { date: "", technique: "", sealer: "", coronalSeal: "", notes: "" }, rx: [], followUps: [], nextControlDate: "", closedReason: "",
});

const VALID_TEETH = new Set<number>([...[1, 2, 3, 4].flatMap(q => [1, 2, 3, 4, 5, 6, 7, 8].map(n => q * 10 + n)), ...[5, 6, 7, 8].flatMap(q => [1, 2, 3, 4, 5].map(n => q * 10 + n))]);
const isoOk = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const date = (value: unknown) => isoOk(value) ? value : "";
const oneOf = (value: unknown, list: readonly string[]) => list.includes(String(value)) ? String(value) : "";
/** Milímetros con un decimal entre 0 y 40; 0 = sin registrar. */
const mm = (value: unknown) => {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 40 ? Math.round(n * 10) / 10 : 0;
};
const obj = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const list = (value: unknown, max: number) => Array.isArray(value) ? value.slice(0, max) : [];
const uniqueIds = <T extends { id: string }>(items: T[]) => { const seen = new Set<string>(); return items.filter(item => item.id && !seen.has(item.id) && seen.add(item.id)); };

/** Valida y limpia lo que llega del cliente; nunca confía en la forma recibida. */
export function normalizeEndo(raw: unknown): EndoData {
  const input = obj(raw);
  const cases = uniqueIds(list(input.cases, 120).flatMap(item => {
    const c = obj(item);
    const tooth = Number(c.tooth);
    if (!VALID_TEETH.has(tooth) || !isoOk(c.openedOn)) return [];
    const testsIn = obj(c.tests);
    const tests = emptyTests();
    for (const t of TESTS) tests[t.key] = oneOf(testsIn[t.key], t.options);
    const canals = uniqueIds(list(c.canals, 8).map(raw => {
      const k = obj(raw);
      return { id: text(k.id, 60), name: text(k.name, 30), apparentLength: mm(k.apparentLength), apexLocator: mm(k.apexLocator), workingLength: mm(k.workingLength), reference: text(k.reference, 60), apexDistance: (() => { const n = Number(String(k.apexDistance ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : 0; })(), masterFile: text(k.masterFile, 20), masterCone: text(k.masterCone, 20), notes: text(k.notes, 500) };
    }));
    const sessions = uniqueIds(list(c.sessions, 40).flatMap(raw => {
      const s = obj(raw);
      if (!isoOk(s.date)) return [];
      return [{ id: text(s.id, 60), date: s.date, steps: [...new Set(list(s.steps, 20).map(v => oneOf(v, SESSION_STEPS)).filter(Boolean))], irrigants: [...new Set(list(s.irrigants, 10).map(v => text(v, 60)).filter(Boolean))], medication: text(s.medication, 80), temporary: text(s.temporary, 80), notes: text(s.notes, 4000) }];
    })).sort((a, b) => a.date.localeCompare(b.date));
    const o = obj(c.obturation);
    const rx = list(c.rx, 40).flatMap(raw => {
      const r = obj(raw); const id = Number(r.imageId);
      return Number.isSafeInteger(id) && id > 0 && RX_STAGES.includes(String(r.stage) as typeof RX_STAGES[number]) && isoOk(r.date) ? [{ imageId: id, stage: String(r.stage), date: r.date as string }] : [];
    }).filter((r, i, all) => all.findIndex(x => x.imageId === r.imageId) === i);
    const followUps = uniqueIds(list(c.followUps, 40).flatMap(raw => {
      const f = obj(raw); const pai = Number(f.pai);
      if (!isoOk(f.date)) return [];
      return [{ id: text(f.id, 60), date: f.date, pai: Number.isInteger(pai) && pai >= 1 && pai <= 5 ? pai : 0, symptoms: oneOf(f.symptoms, ["Asintomático", "Sintomático"]), outcome: oneOf(f.outcome, OUTCOMES), notes: text(f.notes, 2000) }];
    })).sort((a, b) => a.date.localeCompare(b.date));
    return [{
      id: text(c.id, 60), tooth, type: oneOf(c.type, CASE_TYPES) || CASE_TYPES[0], openedOn: c.openedOn as string,
      complaint: text(c.complaint, 1000), pain: text(c.pain, 1000), tests,
      pulpal: oneOf(c.pulpal, PULPAL_DX), periapical: oneOf(c.periapical, PERIAPICAL_DX), difficulty: oneOf(c.difficulty, DIFFICULTY), diagnosisNotes: text(c.diagnosisNotes, 2000),
      canals, sessions,
      obturation: { date: date(o.date), technique: text(o.technique, 80), sealer: text(o.sealer, 80), coronalSeal: text(o.coronalSeal, 80), notes: text(o.notes, 2000) },
      rx, followUps, nextControlDate: date(c.nextControlDate), closedReason: text(c.closedReason, 200),
      ...(c.prior === true ? { prior: true, priorYear: /^\d{4}$/.test(String(c.priorYear ?? "")) ? String(c.priorYear) : "" } : {}),
    }];
  }));
  return { version: 1, cases };
}

export function referencedEndoImageIds(data: EndoData): number[] {
  return [...new Set(data.cases.flatMap(c => [...c.rx.map(r => r.imageId)]))];
}

export type EndoStatus = "Diagnóstico" | "En curso" | "Obturado" | "Control atrasado" | "Cerrado";
/** Marca única que se proyecta al odontograma general. */
export type EndoToothMark = "en curso" | "obturado";

export function caseStatus(c: EndoCase, today: string): EndoStatus {
  if (c.closedReason) return "Cerrado";
  if (c.prior) return "Obturado";
  if (c.obturation.date) return c.nextControlDate && c.nextControlDate < today ? "Control atrasado" : "Obturado";
  if (c.sessions.length) return "En curso";
  return "Diagnóstico";
}

/** Para el odontograma general: solo el estado, sin datos técnicos. El caso más reciente manda. */
export function endoMarksByTooth(data: EndoData): Record<number, EndoToothMark> {
  const marks: Record<number, EndoToothMark> = {};
  const ordered = [...data.cases].sort((a, b) => a.openedOn.localeCompare(b.openedOn));
  for (const c of ordered) {
    if (c.closedReason && !c.obturation.date) { delete marks[c.tooth]; continue; }
    if (c.obturation.date || c.prior) marks[c.tooth] = "obturado";
    else if (c.sessions.length) marks[c.tooth] = "en curso";
  }
  return marks;
}

/** Datos que faltan para considerar el caso bien documentado (no bloquea, avisa). */
export function missingDocumentation(c: EndoCase): string[] {
  const missing: string[] = [];
  if (c.prior) return missing;
  if (!c.pulpal) missing.push("diagnóstico pulpar");
  if (!c.periapical) missing.push("diagnóstico periapical");
  if (!Object.values(c.tests).some(Boolean)) missing.push("pruebas de sensibilidad");
  if (!c.rx.some(r => r.stage === "Diagnóstica" || r.stage === "CBCT")) missing.push("RX diagnóstica");
  if (c.sessions.length || c.obturation.date) {
    if (!c.canals.length) missing.push("conductos");
    for (const k of c.canals) if (!k.workingLength) missing.push(`longitud de trabajo de ${k.name || "un conducto"}`);
  }
  if (c.obturation.date) {
    if (!c.obturation.technique) missing.push("técnica de obturación");
    if (!c.obturation.coronalSeal) missing.push("sellado coronario");
    if (!c.rx.some(r => r.stage === "Obturación")) missing.push("RX final de obturación");
    if (!c.nextControlDate && !c.followUps.length) missing.push("fecha de control");
  }
  return missing;
}

const fdate = (iso: string) => iso ? iso.split("-").reverse().join("-") : "";
const fmm = (n: number) => n ? `${String(n).replace(".", ",")} mm` : "";
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;

export function canalLine(k: EndoCanal): string {
  return [k.name || "Conducto", k.workingLength && `LT ${fmm(k.workingLength)}${k.reference ? ` (ref. ${k.reference.toLowerCase()})` : ""}`, k.apexLocator && `localizador ${fmm(k.apexLocator)}`, k.apparentLength && `long. aparente ${fmm(k.apparentLength)}`, k.apexDistance ? `a ${fmm(k.apexDistance)} del ápice radiográfico` : "", k.masterFile && `LAM ${k.masterFile}`, k.masterCone && `cono ${k.masterCone}`].filter(Boolean).join(", ");
}

/** Texto de evolución para la historia clínica a partir de una sesión. */
export function sessionEvolutionText(c: EndoCase, s: EndoSession): string {
  const lines = [`${c.type} pieza ${fdi(c.tooth)}.`];
  if (c.pulpal || c.periapical) lines.push(`Diagnóstico: ${[c.pulpal, c.periapical].filter(Boolean).join(" / ")}.`);
  if (s.steps.length) lines.push(`Procedimiento: ${s.steps.join(", ").toLowerCase()}.`);
  if (s.steps.some(step => step === "Conductometría" || step === "Preparación químico-mecánica" || step === "Obturación") && c.canals.length) lines.push(`Conductos: ${c.canals.map(canalLine).join("; ")}.`);
  if (s.irrigants.length) lines.push(`Irrigación: ${s.irrigants.join(", ")}.`);
  if (s.medication && s.medication !== "Ninguna") lines.push(`Medicación intraconducto: ${s.medication.toLowerCase()}.`);
  if (s.steps.includes("Obturación") && c.obturation.technique) lines.push(`Obturación: ${c.obturation.technique.toLowerCase()}${c.obturation.sealer ? `, cemento ${c.obturation.sealer}` : ""}.`);
  if (s.temporary) lines.push(`Sellado: ${s.temporary}.`);
  if (s.notes) lines.push(s.notes);
  return lines.join(" ");
}

export function followUpEvolutionText(c: EndoCase, f: EndoFollowUp, next: string): string {
  return [`Control endodóntico pieza ${fdi(c.tooth)}${c.obturation.date ? ` (obturada el ${fdate(c.obturation.date)})` : ""}.`, f.symptoms && `${f.symptoms}.`, f.pai && `PAI ${f.pai}.`, f.outcome && `Evolución: ${f.outcome.toLowerCase()}.`, f.notes, next && `Próximo control: ${fdate(next)}.`].filter(Boolean).join(" ");
}

/** Sugerencia de próximo control según guías (ESE/AAE): 6 y 12 meses, luego anual hasta 4 años. */
export function suggestedNextControl(obturatedOn: string, followUpsDone: number): string {
  if (!isoOk(obturatedOn)) return "";
  const months = [6, 12, 24, 36, 48][Math.min(followUpsDone, 4)];
  if (followUpsDone > 4) return "";
  const d = new Date(`${obturatedOn}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
