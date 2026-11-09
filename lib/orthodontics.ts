/** Módulo de ortodoncia: modelo de datos, validación y resumen del tratamiento. Sin datos de pacientes. */

export const DIAGNOSIS_FIELDS = [
  { key: "facial", label: "Características faciales", options: ["Mesofacial", "Dolicofacial", "Braquifacial", "Perfil recto", "Perfil convexo", "Perfil cóncavo", "Simetría facial", "Asimetría facial", "Competencia labial", "Incompetencia labial"] },
  { key: "oclusal", label: "Análisis oclusal y dentario", options: ["Clase I molar", "Clase II molar", "Clase III molar", "Mordida cruzada anterior", "Mordida cruzada posterior", "Mordida abierta anterior", "Sobremordida profunda", "Apiñamiento leve", "Apiñamiento moderado", "Apiñamiento severo", "Diastemas"] },
  { key: "dentoalveolar", label: "Dentoalveolar", options: ["Protrusión dentoalveolar", "Retrusión dentoalveolar", "Biprotrusión", "Desviación de línea media", "Discrepancia de Bolton", "Agenesias", "Dientes supernumerarios", "Impactación dentaria"] },
  { key: "articulador", label: "Montaje en articulador", options: ["Sin montaje", "Montaje en relación céntrica", "Discrepancia RC–MIC", "Guía anterior conservada", "Interferencias en lateralidad"] },
  { key: "periodontal", label: "Periodontal", options: ["Salud periodontal", "Gingivitis", "Recesiones", "Biotipo delgado", "Biotipo grueso", "Hiperplasia gingival"] },
  { key: "atm", label: "ATM y musculatura", options: ["Sin hallazgos", "Ruido articular", "Dolor muscular", "Limitación de apertura", "Desviación en apertura", "Bruxismo"] },
  { key: "viaAerea", label: "Vía aérea", options: ["Respirador nasal", "Respirador oral", "Hipertrofia adenoidea", "Hipertrofia amigdalina", "Sospecha de apnea del sueño", "Sin hallazgos"] },
  { key: "cefalometrico", label: "Análisis cefalométrico", options: ["Steiner", "McNamara", "Ricketts", "Jarabak", "Tweed", "Björk", "Sin telerradiografía"] },
  { key: "claseEsqueletica", label: "Clase esquelética", options: ["Clase I esquelética", "Clase II esquelética", "Clase III esquelética", "Patrón hiperdivergente", "Patrón hipodivergente", "Patrón normodivergente"] },
] as const;
export type DiagnosisKey = typeof DIAGNOSIS_FIELDS[number]["key"];

export const APPLIANCES = ["Brackets metálicos", "Brackets estéticos", "Autoligado", "Alineadores transparentes", "Ortodoncia lingual", "Expansor rápido palatino", "Mantenedor de espacio", "Retenedores", "Placa removible", "Mini-implantes", "Tubos y botones", "Aparato funcional"] as const;
export const XRAY_TYPES = ["Panorámica", "Telerradiografía lateral", "Cefalometría", "CBCT", "Panorámica y telerradiografía", "Sin radiografía"] as const;
export const ARCH_WIRES = ["Sin arco", "0.012 NiTi", "0.014 NiTi", "0.016 NiTi", "0.018 NiTi", "0.016×0.022 NiTi", "0.017×0.025 NiTi", "0.019×0.025 NiTi", "0.016 acero", "0.018 acero", "0.017×0.025 acero", "0.019×0.025 acero", "Arco de TMA", "Alineador"] as const;
export const ELASTICS = ["Ninguno", "Clase II", "Clase III", "Verticales", "Cruzados", "Triangulares", "Intermaxilares"] as const;
export const HYGIENE = ["Buena", "Regular", "Mala"] as const;

export const FACIAL_SLOTS = [
  { key: "f-reposo", label: "Frente en reposo", group: "Facial" },
  { key: "f-sonrisa", label: "Frente sonriendo", group: "Facial" },
  { key: "f-perfil-d", label: "Perfil derecho", group: "Facial" },
  { key: "f-perfil-i", label: "Perfil izquierdo", group: "Facial" },
] as const;
export const INTRAORAL_SLOTS = [
  { key: "i-frontal", label: "Frontal en oclusión", group: "Intraoral" },
  { key: "i-lat-d", label: "Lateral derecha", group: "Intraoral" },
  { key: "i-lat-i", label: "Lateral izquierda", group: "Intraoral" },
  { key: "i-oclusal-s", label: "Oclusal superior", group: "Intraoral" },
  { key: "i-oclusal-i", label: "Oclusal inferior", group: "Intraoral" },
  { key: "i-resalte", label: "Resalte (overjet)", group: "Intraoral" },
] as const;
export const PHOTO_SLOTS = [...FACIAL_SLOTS, ...INTRAORAL_SLOTS];
const SLOT_KEYS = new Set<string>(PHOTO_SLOTS.map(slot => slot.key));

export type DiagnosisEntry = { value: string; notes: string };
export type OrthoPlan = {
  startDate: string;
  estimatedMonths: number;
  plannedControls: number;
  xrayType: string;
  appliances: string[];
  otherAppliance: string;
  cementationUpper: string;
  cementationLower: string;
  nextControlDate: string;
  objective: string;
};
export type OrthoControl = {
  id: string;
  date: string;
  upperArch: string;
  lowerArch: string;
  aligner: string;
  elastics: string;
  hygiene: string;
  notes: string;
};
export type PhotoTemplate = { id: string; date: string; label: string; photos: Record<string, number> };
export type OrthoData = {
  version: 1;
  diagnosis: Record<DiagnosisKey, DiagnosisEntry>;
  plan: OrthoPlan;
  controls: OrthoControl[];
  templates: PhotoTemplate[];
};

export const emptyOrtho = (): OrthoData => ({
  version: 1,
  diagnosis: Object.fromEntries(DIAGNOSIS_FIELDS.map(field => [field.key, { value: "", notes: "" }])) as Record<DiagnosisKey, DiagnosisEntry>,
  plan: { startDate: "", estimatedMonths: 0, plannedControls: 0, xrayType: "", appliances: [], otherAppliance: "", cementationUpper: "", cementationLower: "", nextControlDate: "", objective: "" },
  controls: [],
  templates: [],
});

const isoOk = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const date = (value: unknown) => isoOk(value) ? value : "";
const count = (value: unknown, max: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : 0;
};

/** Valida y limpia lo que llega del cliente; nunca confía en la forma recibida. */
export function normalizeOrtho(raw: unknown): OrthoData {
  const base = emptyOrtho();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;
  const diag = (input.diagnosis && typeof input.diagnosis === "object" ? input.diagnosis : {}) as Record<string, unknown>;
  for (const field of DIAGNOSIS_FIELDS) {
    const entry = (diag[field.key] && typeof diag[field.key] === "object" ? diag[field.key] : {}) as Record<string, unknown>;
    base.diagnosis[field.key] = { value: text(entry.value, 200), notes: text(entry.notes, 2000) };
  }
  const plan = (input.plan && typeof input.plan === "object" ? input.plan : {}) as Record<string, unknown>;
  const appliances = Array.isArray(plan.appliances) ? [...new Set(plan.appliances.map(item => text(item, 80)).filter(Boolean))].slice(0, 20) : [];
  base.plan = {
    startDate: date(plan.startDate),
    estimatedMonths: count(plan.estimatedMonths, 120),
    plannedControls: count(plan.plannedControls, 200),
    xrayType: text(plan.xrayType, 80),
    appliances,
    otherAppliance: text(plan.otherAppliance, 120),
    cementationUpper: date(plan.cementationUpper),
    cementationLower: date(plan.cementationLower),
    nextControlDate: date(plan.nextControlDate),
    objective: text(plan.objective, 2000),
  };
  const controls = Array.isArray(input.controls) ? input.controls : [];
  const seen = new Set<string>();
  base.controls = controls.slice(0, 300).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const c = item as Record<string, unknown>;
    const id = text(c.id, 60);
    if (!id || seen.has(id) || !isoOk(c.date)) return [];
    seen.add(id);
    const hygiene = (HYGIENE as readonly string[]).includes(String(c.hygiene)) ? String(c.hygiene) : "";
    return [{ id, date: c.date, upperArch: text(c.upperArch, 80), lowerArch: text(c.lowerArch, 80), aligner: text(c.aligner, 80), elastics: text(c.elastics, 80), hygiene, notes: text(c.notes, 4000) }];
  });
  const templates = Array.isArray(input.templates) ? input.templates : [];
  const seenTemplates = new Set<string>();
  base.templates = templates.slice(0, 60).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const t = item as Record<string, unknown>;
    const id = text(t.id, 60);
    if (!id || seenTemplates.has(id) || !isoOk(t.date)) return [];
    seenTemplates.add(id);
    const photos: Record<string, number> = {};
    if (t.photos && typeof t.photos === "object") for (const [slot, imageId] of Object.entries(t.photos as Record<string, unknown>)) {
      const n = Number(imageId);
      if (SLOT_KEYS.has(slot) && Number.isSafeInteger(n) && n > 0) photos[slot] = n;
    }
    return [{ id, date: t.date, label: text(t.label, 80), photos }];
  });
  return base;
}

/** Ids de imágenes que el documento referencia (para comprobar que son del mismo profesional y paciente). */
export function referencedImageIds(data: OrthoData): number[] {
  return [...new Set(data.templates.flatMap(template => Object.values(template.photos)))];
}

export type OrthoStatus = "Sin plan" | "En tratamiento" | "Atrasado" | "Sin próximo control" | "Finalizado";
export type OrthoSummary = {
  status: OrthoStatus;
  controlsDone: number;
  plannedControls: number;
  controlsPercent: number;
  elapsedMonths: number;
  estimatedMonths: number;
  timePercent: number;
  expectedEnd: string;
  nextControlDate: string;
  daysLate: number;
  /** Atención por desfase: el tiempo avanzó mucho más que los controles hechos. */
  behindSchedule: boolean;
};

const dayNumber = (iso: string) => Math.floor(new Date(`${iso}T12:00:00Z`).getTime() / 86400000);
const addMonths = (iso: string, months: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export function orthoActive(data: OrthoData | null): boolean {
  if (!data) return false;
  const p = data.plan;
  return Boolean(p.startDate || p.estimatedMonths || p.plannedControls || p.appliances.length || data.controls.length);
}

/** Resumen del tratamiento: lo planificado frente al avance real y estado de seguimiento. */
export function summarizeOrtho(data: OrthoData, today: string, finished = false): OrthoSummary {
  const p = data.plan;
  const controlsDone = data.controls.length;
  const controlsPercent = p.plannedControls ? Math.min(100, Math.round(controlsDone / p.plannedControls * 100)) : 0;
  const elapsedMonths = p.startDate && today >= p.startDate ? Math.floor((dayNumber(today) - dayNumber(p.startDate)) / 30.4375) : 0;
  const timePercent = p.startDate && p.estimatedMonths ? Math.max(0, Math.min(100, Math.round((dayNumber(today) - dayNumber(p.startDate)) / (p.estimatedMonths * 30.4375) * 100))) : 0;
  const expectedEnd = p.startDate && p.estimatedMonths ? addMonths(p.startDate, p.estimatedMonths) : "";
  const daysLate = p.nextControlDate && p.nextControlDate < today ? dayNumber(today) - dayNumber(p.nextControlDate) : 0;
  let status: OrthoStatus;
  if (!orthoActive(data)) status = "Sin plan";
  else if (finished || (p.plannedControls > 0 && controlsDone >= p.plannedControls && !p.nextControlDate)) status = "Finalizado";
  else if (daysLate > 0) status = "Atrasado";
  else if (!p.nextControlDate) status = "Sin próximo control";
  else status = "En tratamiento";
  return {
    status, controlsDone, plannedControls: p.plannedControls, controlsPercent, elapsedMonths, estimatedMonths: p.estimatedMonths,
    timePercent, expectedEnd, nextControlDate: p.nextControlDate, daysLate,
    behindSchedule: p.plannedControls > 0 && p.estimatedMonths > 0 && timePercent - controlsPercent >= 25 && timePercent >= 25,
  };
}

const fdate = (iso: string) => iso.split("-").reverse().join("-");

/** Texto de la evolución clínica que genera un control de ortodoncia. */
export function controlEvolutionText(control: OrthoControl, nextControlDate = ""): string {
  const parts: string[] = [];
  if (control.upperArch && control.upperArch !== "Sin arco") parts.push(`arco superior ${control.upperArch}`);
  if (control.lowerArch && control.lowerArch !== "Sin arco") parts.push(`arco inferior ${control.lowerArch}`);
  if (control.aligner) parts.push(`alineador ${control.aligner}`);
  if (control.elastics && control.elastics !== "Ninguno") parts.push(`elásticos ${control.elastics}`);
  const lines = [`Control de ortodoncia: ${parts.length ? parts.join("; ") : "sin cambios de aparatología"}.`];
  if (control.hygiene) lines.push(`Higiene: ${control.hygiene.toLowerCase()}.`);
  if (control.notes) lines.push(control.notes);
  if (nextControlDate) lines.push(`Próximo control: ${fdate(nextControlDate)}.`);
  return lines.join("\n");
}
