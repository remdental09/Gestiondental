import { DENTAL_DICTIONARY_HINTS } from "./dental-lexicon.ts";
import { buildMinsalClinicalContext } from "./minsal-knowledge.ts";
import { buildEndoPerioContext } from "./endoperio-knowledge.ts";
import { IDENTITY_NORMALIZATION_PROMPT, normalizeIdentityNumbers } from "./identity-numbers.ts";
import { CLINICAL_WRITING_PROMPT, TOOTH_NUMBERING_PROMPT, procedureCovered, deduplicateProcedureSentences } from "./clinical-writing.ts";
/**
 * Propuesta estructurada de un dictado clínico.
 * La validación es pura: sirve para la salida de Workers AI y para el
 * estructurador local que se usa cuando el binding no está disponible.
 * No persiste datos ni incluye identidad de pacientes.
 */

/**
 * Llama 3.1 8B (fp8) redacta la nota y extrae los hallazgos; si falla, Llama 3.3 70B y luego Mistral Small.
 * Un dictado típico gasta ~110-130 Neurons (cuota gratuita: 10 000 al día) y tarda 12-20 s.
 * Si falla o no responde a tiempo se prueba el respaldo; si ambos fallan, quedan las reglas locales.
 */
import {
  applyLexicon,
  applySelfCorrections,
  depthFrom,
  describeDate,
  fold,
  isAppointmentText,
  lexiconDoubts,
  isNumberWord,
  numberSignature,
  isFuturePayment,
  isPaymentText,
  paymentAmountDetails,
  paymentMethodFrom,
  reconcileCorrection,
  spokenAmounts,
  numberRuns,
  stripDictationFrame,
  resolveSpokenDate,
  resolveSpokenTime,
  santiagoToday,
  type PaymentMethod,
  type TranscriptCorrection,
} from "./spoken.ts";

export type { PaymentMethod, TranscriptCorrection } from "./spoken.ts";
export { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from "./spoken.ts";
import { CARIES_DEPTH_LABEL, CARIES_DEPTH_QUESTION, cariesDepthFrom, isCariesDepth, type CariesDepth } from "../caries.ts";
import { ICD11, ICD11_CATALOG, cariesIcd11, diagnosisMatches, icd11Label, type SuggestedMapping } from "../icd11.ts";
import { classifyEvolution, type EvolutionKind } from "./evolution-type.ts";
import { matchPrestacion } from "../prestaciones-catalog.ts";
export { CARIES_DEPTHS, CARIES_DEPTH_LABEL, CARIES_DEPTH_SHORT, cariesDetail } from "../caries.ts";
export { cariesIcd11, icd11Label } from "../icd11.ts";

/**
 * Primario: Llama 3.1 8B (fp8), ~8 veces más barato por token de salida que el 70B en neuronas de Workers AI.
 * Es el único Llama 3.1/3.2 8B instruct que lista hoy la API de modelos (los «-fast» ya no existen).
 */
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
/** Si el primero falla, no responde a tiempo o devuelve JSON inválido, se prueba el siguiente. */
export const WORKERS_AI_FALLBACKS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/mistralai/mistral-small-3.1-24b-instruct"] as const;
/** El cupo diario es de la cuenta: si se agotó con un modelo, los demás también fallan. */
export function isQuotaError(message: string): boolean {
  return /\b4006\b|daily free allocation/i.test(message);
}

export const TOOTH_STATUSES = [
  "Sin hallazgos",
  "Implante",
  "Implante con pilar",
  "Corona",
  "Ausente",
  "Indicación de exodoncia",
  "Resto radicular con endodoncia",
] as const;

export const CROWN_MATERIALS = ["Zirconio", "Disilicato", "Metal cerámica", "Resina", "Otro"] as const;
export const ODONTOGRAM_SURFACES = ["V", "P", "M", "D", "O"] as const;
export const PERIO_SITES = ["MV", "V", "DV", "ML", "L", "DL"] as const;

export type ToothStatus = (typeof TOOTH_STATUSES)[number];
export type CrownMaterial = (typeof CROWN_MATERIALS)[number];
export type OdontogramSurface = (typeof ODONTOGRAM_SURFACES)[number];
export type PerioSite = (typeof PERIO_SITES)[number];
export type ToothNumbering = "FDI" | "chilena" | "universal";
export type RestorationMaterial = "Resina compuesta" | "Vidrio ionómero" | "Amalgama" | "Cavit" | "IRM" | "Otro";

export type SurfaceFinding = {
  condition: "not_examined" | "sound" | "caries" | "restored" | "sealant" | "other_restoration";
  /** Profundidad de la caries (opcional): esmalte, dentina superficial, dentina profunda o compromiso pulpar. */
  depth?: CariesDepth | null;
  /** Registros anteriores con ICDAS; ya no se pide. */
  icdas?: 1 | 2 | 3 | 4 | 5 | 6 | null;
  activity?: "active" | "inactive" | "uncertain" | null;
  restorationStage?: "provisional" | "definitive" | null;
  restorationMaterial?: RestorationMaterial | null;
};

/** Diagnóstico con código CIE-11 verificado (OMS, MMS 2026-01). */
/**
 * Etiqueta de diagnóstico de una evolución. `code` es CIE-11 (o "" para conceptos sin código verificado);
 * la pieza (`tooth`, FDI almacenado como 24) y los hallazgos (`findings`) se guardan aparte del código.
 * `suggested`: equivalencia propuesta (términos AAE, caries con compromiso pulpar) que el profesional debe confirmar.
 */
export type DiagnosisItem = {
  id: string;
  tooth?: number;
  code: string;
  title: string;
  label: string;
  evidence: string;
  findings?: string;
  origin?: "reglas" | "ia" | "ia+reglas" | "manual";
  suggested?: SuggestedMapping;
  term?: string;
};

export type OdontogramChange = {
  id: string;
  tooth: number;
  numbering: ToothNumbering;
  numberingLabel: string;
  sourceText: string;
  kind: "status" | "surface" | "crown";
  status?: ToothStatus;
  surface?: OdontogramSurface;
  finding?: SurfaceFinding;
  material?: CrownMaterial;
  shade?: string | null;
  missingReason?: "caries" | "other" | "unknown";
  /** implant: la corona va sobre un implante y no reemplaza ese estado. */
  foundation?: "tooth" | "implant";
  /** Cita literal del dictado que respalda el cambio. */
  evidence?: string;
  origin?: ItemOrigin;
  /** La IA y las reglas no coinciden para esta pieza: queda rechazado por defecto. */
  conflict?: boolean;
  /** Aviso del tipo de evolución (p. ej. «es un control»): queda sin marcar por defecto. */
  advisory?: string;
  /** Caries dictada y restaurada en la misma sesión: la superficie queda restaurada y la caries sigue como diagnóstico. */
  treatedCaries?: SurfaceFinding;
};

export type ItemOrigin = "ia" | "reglas" | "ia+reglas";
export type FichaField = "allergies" | "history" | "medications";
export type FichaChange = { id: string; field: FichaField; text: string; evidence: string; origin: ItemOrigin };
export type ProcedureItem = { id: string; text: string; evidence: string; verified: boolean };

export type BudgetChange = {
  id: string;
  title: string;
  label: string;
  /** Código del catálogo de prestaciones cuando el texto coincide con una sola prestación. */
  catalogCode?: string;
  amount: number;
  /** «Fase 1», «Fase 2»…: la fase del plan en que se dictó la prestación. */
  phase?: string;
  /** «A», «B»…: la opción de plan en que se dictó. La primera es el plan principal; las demás, alternativas. */
  option?: string;
  sourceText: string;
  evidence?: string;
  origin?: ItemOrigin;
};

export type PerioStub = {
  id: string;
  tooth: number;
  numberingLabel: string;
  site: PerioSite;
  siteLabel: string;
  depth: number;
  sourceText: string;
  persisted: false;
  bleeding?: boolean;
  suppuration?: boolean;
  evidence?: string;
  origin?: ItemOrigin;
};

/** Sondaje dictado al que le falta el sitio o los milímetros: se completa en la revisión o con una aclaración. */
export type PerioPending = {
  id: string;
  tooth: number;
  numberingLabel: string;
  site: PerioSite | null;
  depth: number | null;
  bleeding: boolean;
  suppuration: boolean;
  evidence: string;
  origin: ItemOrigin;
};

export type MobilityChange = { id: string; tooth: number; numberingLabel: string; grade: "0" | "I" | "II" | "III"; evidence: string; origin: ItemOrigin };

/** Pago o abono recibido hoy, según el dictado. */
export type PaymentChange = {
  id: string;
  amount: number;
  method: PaymentMethod | null;
  concept: string;
  evidence: string;
  origin: ItemOrigin;
  /** Base y porcentaje cuando el pago se calculó desde una fracción explícita del presupuesto. */
  baseAmount?: number;
  percentage?: number;
  /** ID de una prestación presupuestaria dictada en el mismo flujo. */
  budgetRef?: string;
};

/** Próxima cita dictada. day en YYYY-MM-DD y time en HH:MM, ambos en hora de Chile. */
export type AppointmentChange = {
  id: string;
  day: string | null;
  time: string | null;
  reason: string;
  /** Cómo se dijo la fecha («el jueves»), para revisarla. */
  said: string;
  evidence: string;
  origin: ItemOrigin;
  note?: string;
  timeDoubt?: string;
};

export type DictationProposal = {
  evolution: { title: string; body: string } | null;
  odontogram: OdontogramChange[];
  budget: BudgetChange[];
  perio: PerioStub[];
  clarifications: string[];
  /** Hallazgos que no se aplican hasta completarlos en la revisión (las caries ya no quedan aquí: la profundidad es opcional). */
  incomplete?: OdontogramChange[];
  /** Diagnósticos con código CIE-11 (caries por profundidad y diagnósticos dictados con código verificado). */
  diagnoses?: DiagnosisItem[];
  /** Alergias, antecedentes y medicamentos propuestos para la ficha. */
  ficha?: FichaChange[];
  /** Procedimientos realizados según el dictado, con su cita. */
  procedures?: ProcedureItem[];
  /** Transcripción literal; se guarda completa al final de la evolución. */
  transcript?: string;
  /** Texto corregido (diccionario + IA validada) y cada cambio hecho sobre lo dictado. */
  corrected?: { text: string; corrections: TranscriptCorrection[] };
  perioPending?: PerioPending[];
  mobility?: MobilityChange[];
  payments?: PaymentChange[];
  appointments?: AppointmentChange[];
  /** Tipo de evolución (control, obturación, higiene…): define el título y si se espera tocar el odontograma. */
  evolutionKind?: EvolutionKind;
  /** Nombre oído en el saludo («quiero evolucionar la ficha de …»), para compararlo con la ficha abierta. */
  spokenName?: string;
  /** Lo que el tipo de evolución dejó fuera del odontograma («ya figura como implante»). */
  policyNotes?: string[];
};

export type ChartSurface = {
  condition: SurfaceFinding["condition"];
  depth?: SurfaceFinding["depth"];
  icdas?: SurfaceFinding["icdas"];
  activity?: SurfaceFinding["activity"];
  restorationStage?: SurfaceFinding["restorationStage"];
  restorationMaterial?: SurfaceFinding["restorationMaterial"];
};

export type ChartSnapshot = {
  teeth: Record<number, string>;
  surfaces: Record<number, Partial<Record<OdontogramSurface, ChartSurface>>>;
  missingReason?: Record<number, "caries" | "other" | "unknown">;
  crowns?: Record<number, { material: string; shade?: string | null; foundation?: "tooth" | "implant" }>;
};

export type StructureInput = {
  transcript: string;
  chart: { tooth: number; status: string }[];
};

export type ClinicalModel = {
  readonly id: string;
  readonly model: string;
  complete(input: StructureInput): Promise<unknown>;
};

export type StructureOutcome = {
  engine: string;
  model: string | null;
  notice: string | null;
  proposal: DictationProposal;
  /** Si la IA falló: motivo legible para mostrarlo con «Reintentar». */
  aiError?: string;
  /** Milisegundos que tardó el paso de IA, si se llamó. */
  aiMs?: number;
  /** La IA respondió por un respaldo (OpenAI): nota discreta, no es advertencia. */
  aiNote?: string;
};

type ChartActionMetadata = { sourceEvolutionId?: number; sourceActionId?: string; historyTitle?: string };

export type ChartAction =
  | ({ action: "setToothStatus"; patientId: number; tooth: number; status: string } & ChartActionMetadata)
  | ({ action: "setToothMissingReason"; patientId: number; tooth: number; reason: "caries" | "other" | "unknown" } & ChartActionMetadata)
  | ({ action: "setCrownDetails"; patientId: number; tooth: number; material: string; shade: string; foundation?: "tooth" | "implant" } & ChartActionMetadata)
  | ({ action: "setToothSurface"; patientId: number; tooth: number; surface: OdontogramSurface; finding: SurfaceFinding } & ChartActionMetadata);

const LOCAL_NOTICE = "Workers AI no está enlazado en este entorno. La propuesta salió del estructurador local, sin costo por dictado, y no se guarda sola.";
const AI_NOTICE = "La IA redactó la nota y propuso los cambios. Cada pieza, cara, profundidad de caries y monto se contrastó con una cita literal del dictado y con las reglas locales; revisa y acepta antes de guardar.";
const AI_FAILED_NOTICE = "La IA no respondió y la propuesta salió solo de las reglas locales. Revisa con más cuidado";

export function formatFdi(tooth: number): string {
  return `${Math.floor(tooth / 10)}.${tooth % 10}`;
}

export function isValidFdi(tooth: number): boolean {
  if (!Number.isInteger(tooth)) return false;
  const quadrant = Math.floor(tooth / 10);
  const position = tooth % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

/** Numeración nacional chilena permanente 1–32 → FDI compacto. */
export function chileToFdi(position: number): number | null {
  if (!Number.isInteger(position) || position < 1 || position > 32) return null;
  if (position <= 8) return 19 - position;
  if (position <= 16) return 12 + position;
  if (position <= 24) return 65 - position;
  return position + 6;
}

/** Numeración Universal estadounidense permanente 1–32 → FDI compacto. */
export function universalToFdi(position: number): number | null {
  if (!Number.isInteger(position) || position < 1 || position > 32) return null;
  if (position <= 8) return 19 - position;
  if (position <= 16) return 12 + position;
  if (position <= 24) return 55 - position;
  return position + 16;
}

const PRIMARY_LETTER: Record<string, number> = {
  A: 55, B: 54, C: 53, D: 52, E: 51, F: 61, G: 62, H: 63, I: 64, J: 65,
  K: 75, L: 74, M: 73, N: 72, O: 71, P: 81, Q: 82, R: 83, S: 84, T: 85,
};

export const SITE_LABEL: Record<PerioSite, string> = {
  MV: "Mesial vestibular",
  V: "Vestibular",
  DV: "Distal vestibular",
  ML: "Mesial lingual o palatino",
  L: "Lingual o palatino",
  DL: "Distal lingual o palatino",
};

function clip(value: string, max = 180): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Hallazgos clínicos que no son estados del odontograma: no aportan caras ni caries. */
const OTHER_FINDING = /(?<!\p{L})(?:fractur\p{L}*|fisur\p{L}*|c[uú]spides?|desgaste|abfracci\p{L}*|abrasi[oó]n|erosi[oó]n|atrici[oó]n|movilidad|tinci[oó]n|manchas?|absceso|f[ií]stula|dolor|sensibilidad)(?!\p{L})/iu;
const FINDING_CUE = /(?<!\p{L})(?:caries|obtura\p{L}*|restaura\p{L}*|resina|amalgama|sellante|san[oa]|ausente|implante|corona|exodoncia|extra[ií]d\p{L}*|resto\s+radicular|endodoncia|fractur\p{L}*|fisur\p{L}*|c[uú]spides?|icdas|esmalte|dentina|pulpar|penetrante|lesi[oó]n|movilidad|sondaje|dolor|sensibilidad|absceso|f[ií]stula|desgaste|abfracci\p{L}*|pulpitis|necrosis|periodontitis|activ[ao]|inactiv[ao]|oclusal|mesial|distal|vestibular|palatin[ao]|lingual|incisal|mod)(?!\p{L})/iu;
const TOOTH_START = /(?:^|\s)((?:(?:la|el)\s+)?(?:(?:pieza|diente)s?\s+(?:(?:fdi|iso|chilena|nacional|universal)\s+)?(?:\d|un[oa]?\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b|nueve\b|diez\b|once\b|doce\b|trece\b|catorce\b|quince\b|diec|veint|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|temporal|decidu|de\s+leche)|(?:fdi|iso)\s+(?:\d|un[oa]?\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|siete\b|ocho\b)))/giu;
const CLAUSE_START = /(?:^|\s)((?:(?:el|la)\s+)?(?:paciente\s+)?(?:refiere|relata|comenta|niega)(?!\p{L})|se\s+(?:le\s+)?(?:indica|planifica|realiz[oó]|instal[oó]|cement[oó]|observa|encuentra)(?!\p{L})|(?:el\s+)?motivo\s+de\s+(?:la\s+)?consulta(?!\p{L})|viene\s+(?:a|por|para)\s|nos\s+vemos(?!\p{L})|est[aá]\s+conectad[oa](?!\p{L})|fue\s+(?:una\s+)?t[eé]cnica(?!\p{L})|(?:sondaje|sondeo|movilidad)(?!\p{L})|(?:con\s+)?sangrado\s+al\s+(?:sondaje|sondeo)(?!\p{L})|(?:presupuesto|se\s+presupuesta)(?!\p{L})|(?:el\s+paciente\s+|la\s+paciente\s+)?(?:abon[oó]|pag[oó]|cancel[oó])(?!\p{L})|pr[oó]xim[oa]\s+(?:cita|control|sesi[oó]n|hora)(?!\p{L})|se\s+(?:cita|agenda|reagenda)(?!\p{L})|se\s+controla(?:r[aá])?\s+(?:en|el|para|dentro)(?!\p{L})|aclaraci[oó]n:)/giu;
const OPEN_ENDING = /(?:^|\s)(?:en|de|del|la|el|los|las|a|al|para|entre|sobre|por|un|una|que|o|con|desde|hasta|observa|observan|extrae|extrajo|restaura|restaur[oó]|obtura|obtur[oó]|presenta|presentan|indica|planifica|realiza|realiz[oó]|instal[oó]|cement[oó]|tiene|hay|evidencia|paciente)$/iu;
const TRAILING_CONNECTOR = /(?:[\s,;:]+(?:y|e|con|adem[aá]s|tambi[eé]n))+[\s,;:]*$|[\s,;:]+$/iu;

/** «punto», «punto aparte» y «coma» dictados como palabras. No toca FDI «tres punto seis» ni «punto de contacto». */
const DIGIT_WORDS: Record<string, string> = { uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8" };

function spokenPunctuation(text: string): string {
  const digit = (value: string) => DIGIT_WORDS[value.toLowerCase()] ?? value;
  return text
    // «1 punto 6» o «uno punto seis» es una pieza FDI, no un punto seguido.
    .replace(/(?<![\p{L}\d])([1-8]|uno|dos|tres|cuatro|cinco|seis|siete|ocho)\s+punto\s+([1-8]|uno|dos|tres|cuatro|cinco|seis|siete|ocho)(?![\p{L}\d])/giu, (_, left: string, right: string) => `${digit(left)}.${digit(right)}`)
    .replace(/\s+punto\s+(?:y\s+)?(?:aparte|seguido|final)(?!\p{L})/giu, ". ")
    .replace(/(?<!\d|(?<!\p{L})(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho))\s+punto(?!\p{L})(?!\s+(?:de|del|\d|uno|dos|tres|cuatro|cinco|seis|siete|ocho)(?!\p{L}))/giu, ".")
    .replace(/\s+coma(?=\s)/giu, ",");
}

function stripEdge(value: string): string {
  return value.replace(TRAILING_CONNECTOR, "").replace(/^[\s,;:]+/, "").trim();
}

/** Corta antes de «pieza N» o de «refiere / se indica…» cuando lo anterior ya es una frase completa. */
function splitAtCues(piece: string): string[] {
  const points = new Map<number, "tooth" | "clause">();
  for (const match of piece.matchAll(TOOTH_START)) {
    const index = (match.index ?? 0) + match[0].length - match[1].length;
    if (index > 0) points.set(index, "tooth");
  }
  for (const match of piece.matchAll(CLAUSE_START)) {
    const index = (match.index ?? 0) + match[0].length - match[1].length;
    if (index > 0 && !points.has(index)) points.set(index, "clause");
  }
  const sorted = [...points.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  let start = 0;
  sorted.forEach((index, position) => {
    const left = piece.slice(start, index);
    const core = stripEdge(left);
    if (!core) return;
    const nextIndex = sorted[position + 1] ?? piece.length;
    const right = piece.slice(index, nextIndex);
    const rawLeft = left.trim();
    const endsOpen = OPEN_ENDING.test(rawLeft) && !/(?:^|\s)(?:y|e)$/i.test(rawLeft);
    if (endsOpen) return;
    const kind = points.get(index);
    if (kind === "tooth" && !FINDING_CUE.test(right.replace(/^\S+\s+\S+/, ""))) return;
    const hasTooth = toothMentions(core).length > 0;
    const complete = hasTooth ? FINDING_CUE.test(core) : core.split(/\s+/).length >= 2;
    if (!complete) return;
    out.push(core);
    start = index;
  });
  out.push(stripEdge(piece.slice(start)));
  return out.filter(Boolean);
}

function sentences(text: string): string[] {
  return spokenPunctuation(text)
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => splitAtCues(part));
}

/** Solo las partes de la frase que no hablan de fractura, cúspide u otro hallazgo fuera de la leyenda. */
function surfaceScope(sentence: string): string {
  // «fosas y fisuras» es la anatomía del sellante o de la caries oclusal, no una fisura dentaria.
  // En un sellante, las fosas y fisuras son la cara oclusal.
  const sealing = /\b(?:sellante|sellad\p{L}*)\b/iu.test(sentence);
  const anatomical = sentence.replace(/\b(?:fosas?\s+y\s+(?:fisuras?|surcos?)|surcos?\s+y\s+fisuras?|fosas?,?\s+surcos?\s+y\s+fisuras?)\b/giu, sealing ? "fosas oclusal" : "fosas");
  const parts = anatomical.split(/\s*[,;]\s*|\s+(?:y|e|con|m[aá]s)\s+/iu);
  return parts.filter((part) => !OTHER_FINDING.test(part)).join(" ");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ensurePeriod(value: string): string {
  const clean = value.trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function systemKind(token: string | undefined): "fdi" | "chile" | "universal" | null {
  if (!token) return null;
  const value = token.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.\s]/g, "");
  if (value === "fdi" || value === "iso") return "fdi";
  if (value === "chilena" || value === "nacional") return "chile";
  if (value === "universal" || value === "estadounidense" || value === "eeuu" || value === "ada") return "universal";
  return null;
}

type Mention = { ok: true; tooth: number; numbering: ToothNumbering; numberingLabel: string } | { ok: false; reason: string };

function interpretTooth(raw: string, system: string | undefined): Mention {
  const kind = systemKind(system);
  const dotted = raw.includes(".");
  const compact = Number(raw.replace(".", ""));
  if (!Number.isInteger(compact)) return { ok: false, reason: `«${raw}» no es un número de pieza.` };
  if (dotted && (kind === "chile" || kind === "universal")) {
    return { ok: false, reason: `«${raw}» usa punto de FDI y también otro sistema. Aclara la pieza antes de marcarla.` };
  }
  if (dotted || kind === "fdi") {
    if (!isValidFdi(compact)) return { ok: false, reason: `«${system ? `${system} ` : ""}${raw}» no es una pieza FDI válida.` };
    return { ok: true, tooth: compact, numbering: "FDI", numberingLabel: `FDI ${formatFdi(compact)}` };
  }
  if (kind === "chile") {
    const tooth = chileToFdi(compact);
    if (!tooth) return { ok: false, reason: `«${raw}» está fuera de la numeración nacional chilena (1 a 32).` };
    return { ok: true, tooth, numbering: "chilena", numberingLabel: `nacional chilena ${compact} · FDI ${formatFdi(tooth)}` };
  }
  if (kind === "universal") {
    const tooth = universalToFdi(compact);
    if (!tooth) return { ok: false, reason: `«${raw}» está fuera de la numeración Universal (1 a 32).` };
    return { ok: true, tooth, numbering: "universal", numberingLabel: `Universal ${compact} · FDI ${formatFdi(tooth)}` };
  }
  // Sin etiqueta: «pieza 1» a «pieza 32» es numeración nacional chilena (30 = FDI 3.6), como dicta Luis.
  // Del 33 al 48 y del 51 al 85 solo existen en FDI. Con punto («2.6», «dos punto seis») siempre es FDI (arriba).
  const chile = chileToFdi(compact);
  if (chile) return { ok: true, tooth: chile, numbering: "chilena", numberingLabel: `nacional chilena ${compact} · FDI ${formatFdi(chile)}` };
  if (isValidFdi(compact)) return { ok: true, tooth: compact, numbering: "FDI", numberingLabel: `FDI ${formatFdi(compact)}` };
  return { ok: false, reason: invalidToothQuestion(raw) };
}

/** Pieza sin etiqueta que no existe en ningún sistema (p. ej. «pieza 39», «pieza 50»): se pregunta, sin valor por defecto. */
function invalidToothQuestion(raw: string, suggestion?: string): string {
  return `«pieza ${raw}» no es una pieza válida ni en numeración chilena (1–32) ni en FDI (33–48, 51–85). ¿Qué pieza?${suggestion ? ` Primera opción: ${suggestion}.` : ""}`;
}

/** Pieza que nombra «pieza N» sin etiqueta: chilena del 1 al 32, FDI del 33 al 48 y del 51 al 85. */
function bareToothNumber(value: number): number | null {
  return chileToFdi(value) ?? (isValidFdi(value) ? value : null);
}

const SPOKEN_DIGIT = "(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)";
// Como segundo dígito, «un/una» es casi siempre el artículo («pieza cuatro una caries»), no el 1: el dígito se dicta «uno».
const SPOKEN_DIGIT_SECOND = "(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho)";
// Dientes temporales (FDI 51–55, 61–65, 71–75, 81–85) dictados en palabras.
const PRIMARY_TENS: Array<[string, number]> = [["cincuenta", 50], ["sesenta", 60], ["setenta", 70], ["ochenta", 80]];
const PRIMARY_UNITS: Array<[string, number]> = [["cinco", 5], ["cuatro", 4], ["tres", 3], ["dos", 2], ["uno", 1]];
const SPOKEN_CARDINALS: Array<[string, number]> = [
  ...PRIMARY_TENS.flatMap(([tens, base]) => PRIMARY_UNITS.map(([unit, value]) => [`${tens} y ${unit}`, base + value] as [string, number])),
  ["cuarenta y ocho", 48], ["cuarenta y siete", 47], ["cuarenta y seis", 46], ["cuarenta y cinco", 45], ["cuarenta y cuatro", 44], ["cuarenta y tres", 43], ["cuarenta y dos", 42], ["cuarenta y uno", 41], ["cuarenta", 40],
  ["treinta y ocho", 38], ["treinta y siete", 37], ["treinta y seis", 36], ["treinta y cinco", 35], ["treinta y cuatro", 34], ["treinta y tres", 33], ["treinta y dos", 32], ["treinta y uno", 31], ["treinta", 30],
  ["veintinueve", 29], ["veintiocho", 28], ["veintisiete", 27], ["veintiseis", 26], ["veinticinco", 25], ["veinticuatro", 24], ["veintitres", 23], ["veintidos", 22], ["veintiuno", 21], ["veinte", 20],
  ["diecinueve", 19], ["dieciocho", 18], ["diecisiete", 17], ["dieciseis", 16], ["quince", 15], ["catorce", 14], ["trece", 13], ["doce", 12], ["once", 11], ["diez", 10],
  ["nueve", 9], ["ocho", 8], ["siete", 7], ["seis", 6], ["cinco", 5], ["cuatro", 4], ["tres", 3], ["dos", 2], ["uno", 1], ["un", 1],
];

function speechText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function spokenDigit(word: string): number {
  return { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 }[word] ?? 0;
}

function toothMentions(sentence: string): Mention[] {
  const mentions: Mention[] = [];
  const numbered = /\b(?:pieza|diente)\s+(?:(fdi|iso|chilena|nacional|universal|estadounidense|ee\.?\s*uu\.?|ada)\s+)?(\d{1,2}(?:\.\d)?)\b|\b(fdi|iso|chilena|nacional|universal|estadounidense|ee\.?\s*uu\.?|ada)\s+(\d{1,2}(?:\.\d)?)\b/gi;
  for (const match of sentence.matchAll(numbered)) {
    mentions.push(interpretTooth(match[2] || match[4], match[1] || match[3]));
  }
  // «en la 3.6» sin etiqueta: la forma con punto es FDI (la corrección convierte «tres seis» en 3.6).
  // No se lee como pieza si es una medida («4.5 mm») o parte de otro número («50.000», «10.30»).
  const unlabeled = sentence.replace(numbered, (whole) => " ".repeat(whole.length));
  for (const match of unlabeled.matchAll(/(?<![\d.,])(?<![x×]\s?)([1-8])\.([1-8])(?![\d.,]?\d)(?!\s*(?:mm|mil[ií]metros?|cm|%|hrs?|horas?|h\b|[x×]\s*\d))/giu)) {
    mentions.push(interpretTooth(`${match[1]}.${match[2]}`, "fdi"));
  }
  // «las piezas 16 y 26», «dientes 1.6, 2.6 y 3.6»: la etiqueta se comparte con toda la lista.
  for (const list of sentence.matchAll(/\b(?:pieza|diente)s\s+(?:(fdi|iso|chilena|nacional|universal|estadounidense)\s+)?(\d{1,2}(?:\.\d)?(?:\s*(?:,|y|e)\s*\d{1,2}(?:\.\d)?)+)(?![\d.]?\d)/gi)) {
    for (const number of list[2].match(/\d{1,2}(?:\.\d)?/g) ?? []) mentions.push(interpretTooth(number, list[1]));
  }
  // «tercer molar inferior derecho 48», «muela 37»: el número que sigue al nombre del diente.
  for (const match of sentence.matchAll(/\b(?:molar(?:es)?|premolar(?:es)?|incisivo|canino|muela|cordal)(?:\s+(?:superior|inferior|derech[oa]|izquierd[oa]|central|lateral|primer|segundo|tercer)){0,4}\s+(\d{2}(?:\.\d)?)(?![\d.]?\d)(?!\s*(?:mm|mil[ií]metros?|cm|%|mg|mil))/giu)) {
    mentions.push(interpretTooth(match[1], undefined));
  }
  // «caries de la 37», «el 46»: solo números que no pueden ser un día del mes (FDI 33–48 y 51–85).
  for (const match of unlabeled.matchAll(/(?<![\d.,])\b(?:la|el)\s+(3[3-9]|4[0-8]|5[1-9]|6\d|7\d|8[0-5])(?![\d.,]?\d)(?!\s*(?:mm|mil[ií]metros?|cm|%|mg|mil|a[nñ]os?|de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)))/giu)) {
    mentions.push(interpretTooth(match[1], undefined));
  }
  const spoken = speechText(sentence);
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => consumed.some(([from, to]) => start < to && end > from);
  const pair = new RegExp(String.raw`\b(?:(?:pieza|diente)\s+)?(?:(?:fdi|iso)\s+)?${SPOKEN_DIGIT}\s+${SPOKEN_DIGIT_SECOND}\b`, "g");
  for (const match of spoken.matchAll(pair)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const words = match[0].match(new RegExp(SPOKEN_DIGIT, "g")) ?? [];
    const first = words[0];
    const second = words[1];
    if (!first || !second) continue;
    consumed.push([start, end]);
    mentions.push(interpretTooth(`${spokenDigit(first)}.${spokenDigit(second)}`, "fdi"));
  }
  for (const [phrase, value] of SPOKEN_CARDINALS) {
    const labeled = new RegExp(String.raw`\b(pieza|diente|fdi|iso)\s+(?:(fdi|iso|chilena|nacional|universal|estadounidense)\s+)?${phrase}\b`, "g");
    for (const match of spoken.matchAll(labeled)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      consumed.push([start, end]);
      const cue = match[1];
      const system = match[2] || (cue === "fdi" || cue === "iso" ? "fdi" : undefined);
      mentions.push(interpretTooth(String(value), system));
    }
  }
  const temporal = /\b(?:pieza|diente)\s+(?:temporal|decidua|deciduo|de\s+leche)\s+([a-t])\b/gi;
  for (const match of sentence.matchAll(temporal)) {
    const letter = match[1].toUpperCase();
    const tooth = PRIMARY_LETTER[letter];
    mentions.push(tooth
      ? { ok: true, tooth, numbering: "chilena", numberingLabel: `temporal chilena ${letter} · FDI ${formatFdi(tooth)}` }
      : { ok: false, reason: `La letra ${letter} no pertenece a la serie temporal chilena A–T.` });
  }
  return mentions;
}

const PERFORMED = /(?:^|\P{L})(?:se\s+(?:instal[oó]|coloc[oó]|cement[oó]|realiz[oó]|efectu[oó]|insert[oó])|cementad[oa])(?!\p{L})/iu;
const NEGATED_PERFORMED = /(?:^|\P{L})no\s+se\s+(?:instal[oó]|coloc[oó]|cement[oó]|realiz[oó]|efectu[oó]|insert[oó])(?!\p{L})/iu;

function isPatient(sentence: string): boolean {
  return /\b(?:refiere|relata|comenta|dice que|cuenta que|niega)\b/i.test(sentence)
    && !PERFORMED.test(sentence)
    && !/\bse\s+observa\b/i.test(sentence);
}

function isPerformed(sentence: string): boolean {
  return PERFORMED.test(sentence) && !NEGATED_PERFORMED.test(sentence);
}

function isPlanStrict(sentence: string): boolean {
  return /\b(?:se\s+planifica|planificad[oa]|se\s+indica|a\s+futuro|presupuesto|cotizaci[oó]n|por\s+cotizar)\b/i.test(sentence);
}

const PLAN_CUE = /(?:^|\P{L})(?:plan\s+(?:de\s+tratamiento|opci[oó]n|alternativ\p{L}*)|(?:fase|etapa)\s+(?:\d+|uno|dos|tres|cuatro|cinco)|opci[oó]n\s+(?:[abc]|be|ce|\d|uno|dos|tres)|alternativa|a\s+decidir|se\s+eval[uú]a(?:r[aá])?|se\s+(?:propone|sugiere|recomienda|planea)|por\s+definir)(?!\p{L})/iu;
const PLAN_HEADER = /(?:^|\P{L})plan\s+(?:de\s+tratamiento|opci[oó]n)(?!\p{L})/iu;

/** Lo que se planifica o se presupuesta no es lo que se hizo: «Plan de tratamiento», «Fase dos», «Opción B», «a decidir». */
function isPlan(sentence: string): boolean {
  return isPlanStrict(sentence) || PLAN_CUE.test(sentence);
}

/** Frases que siguen a un «Plan de tratamiento» sin que se diga que algo se hizo: siguen siendo plan. */
function inPlanContext(all: string[], index: number): boolean {
  if (index < 0 || PERFORMED_TODAY.test(all[index]) || EXTRACTION_DONE.test(all[index])) return false;
  for (let k = index - 1; k >= Math.max(0, index - 6); k -= 1) {
    if (isPerformed(all[k]) || PERFORMED_TODAY.test(all[k])) return false;
    if (PLAN_HEADER.test(all[k])) return true;
  }
  return false;
}

function planContextOfSegment(segment: string, transcript: string): boolean {
  const all = sentences(transcript);
  const target = normalizeEvidence(segment);
  const index = all.findIndex((line) => { const text = normalizeEvidence(line); return text.includes(target) || target.includes(text); });
  return inPlanContext(all, index);
}

function isNegatedFinding(sentence: string): boolean {
  return /(?:^|\P{L})no\s+(?:se\s+)?(?:observa|hay|presenta|instal[oó]|coloc[oó]|cement[oó]|realiz[oó])(?!\p{L})/iu.test(sentence);
}

function parseAmount(sentence: string): number | null {
  if (!/\b(?:pesos|clp)\b|\$/i.test(sentence)) return null;
  const match = sentence.match(/(?:\$\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,9})(?=\s*(?:pesos|clp)\b)|\$\s*(\d{1,3}(?:\.\d{3})+|\d{4,9})/i);
  if (!match) return null;
  const amount = Number((match[1] || match[2]).replace(/\./g, ""));
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= 1_000_000_000 ? amount : null;
}

const SPOKEN_AMOUNT = /\b(?:(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veinti\p{L}+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s|y)\s+)*(?:mil|mill[oó]n|millones)\b(?:\s+(?:y\s+)?(?:un|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)\b)*/giu;

function budgetLabel(sentence: string): string {
  const label = sentence
    .replace(/\b([1-8])\.([1-8])\b/g, "$1#$2")
    .replace(/(?:\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d{4,9})/g, " ")
    .replace(SPOKEN_AMOUNT, " ")
    .replace(/(?<!\p{L})(?:(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|veinti\p{L}+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s|y)\s+)*(?:lucas?|lukas?)(?!\p{L})/giu, " ")
    .replace(/\b(?:presupuesto|cotizaci[oó]n|honorarios?|pesos|clp|lucas?|fdi|iso|chilena|nacional|universal|cada\s+uno|cada\s+una)\b/gi, " ")
    .replace(/(?<!\p{L})plan\s+de\s+tratamiento(?!\p{L})/giu, " ")
    .replace(/(?<!\p{L})(?:fase|etapa)\s+(?:\d+|uno|dos|tres|cuatro|cinco)(?!\p{L})/giu, " ")
    .replace(/(?<!\p{L})opci[oó]n\s+(?:[abc]|be|ce|\d|uno|dos|tres)(?!\p{L})/giu, " ")
    .replace(/(?<!\p{L})(?:se\s+)?(?:planifica|plantea|propone|indica|realiza)(?:\s+hoy)?(?!\p{L})/giu, " ")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:\s+(?:por|a|en|de|del|la|el|y))+$/i, "")
    .replace(/#/g, ".")
    .replace(/^(?:plan|de|del|la|el|un|una)\s+/i, "");
  const clean = clip(label, 180);
  if (clean.length < 3) return "Prestación dictada";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type SurfaceVia = "oclusal" | "incisal" | "vestibular" | "palatina" | "lingual" | "mesial" | "distal";
type RawSurface = { code: OdontogramSurface; via: SurfaceVia };

const LETTER_GROUPS: Record<string, Array<[OdontogramSurface, SurfaceVia]>> = {
  mod: [["M", "mesial"], ["O", "oclusal"], ["D", "distal"]],
  dom: [["D", "distal"], ["O", "oclusal"], ["M", "mesial"]],
  mo: [["M", "mesial"], ["O", "oclusal"]],
  om: [["O", "oclusal"], ["M", "mesial"]],
  od: [["O", "oclusal"], ["D", "distal"]],
  do: [["D", "distal"], ["O", "oclusal"]],
  md: [["M", "mesial"], ["D", "distal"]],
  dm: [["D", "distal"], ["M", "mesial"]],
  vo: [["V", "vestibular"], ["O", "oclusal"]],
  ov: [["O", "oclusal"], ["V", "vestibular"]],
};

function collectRawSurfaces(sentence: string): RawSurface[] {
  const text = speechText(sentence);
  const found: RawSurface[] = [];
  const add = (code: OdontogramSurface, via: SurfaceVia) => {
    if (!found.some((item) => item.code === code && item.via === via)) found.push({ code, via });
  };
  for (const match of text.matchAll(/\b(mesio|disto|ocluso|vestibulo|linguo|palato)\s*-?\s*(oclusal|oclual|incisal|distal|mesial|vestibular|bucal|labial|lingual|palatina|palatino)\b/g)) {
    const prefix = match[1];
    const rest = match[2];
    if (prefix === "mesio") add("M", "mesial");
    if (prefix === "disto") add("D", "distal");
    if (prefix === "ocluso") add("O", "oclusal");
    if (prefix === "vestibulo") add("V", "vestibular");
    if (prefix === "linguo") add("P", "lingual");
    if (prefix === "palato") add("P", "palatina");
    if (rest.startsWith("oclus")) add("O", "oclusal");
    if (rest === "incisal") add("O", "incisal");
    if (rest === "distal") add("D", "distal");
    if (rest === "mesial") add("M", "mesial");
    if (rest === "vestibular" || rest === "bucal" || rest === "labial") add("V", "vestibular");
    if (rest === "lingual") add("P", "lingual");
    if (rest.startsWith("palat")) add("P", "palatina");
  }
  for (const group of text.match(/\b(?:mod|dom|mo|om|od|do|md|dm|vo|ov)\b/g) ?? []) {
    for (const [code, via] of LETTER_GROUPS[group] ?? []) add(code, via);
  }
  for (const match of text.matchAll(/\bcaras?\s+([omdvpli]{1,3})\b/g)) {
    for (const letter of match[1]) {
      if (letter === "o") add("O", "oclusal");
      if (letter === "i") add("O", "incisal");
      if (letter === "m") add("M", "mesial");
      if (letter === "d") add("D", "distal");
      if (letter === "v") add("V", "vestibular");
      if (letter === "p") add("P", "palatina");
      if (letter === "l") add("P", "lingual");
    }
  }
  if (/\b(?:oclusal|oclual)\b/.test(text)) add("O", "oclusal");
  if (/\bincisal\b/.test(text)) add("O", "incisal");
  if (/\b(?:vestibular|bucal|labial)\b/.test(text)) add("V", "vestibular");
  if (/\bpalatin[oa]\b/.test(text)) add("P", "palatina");
  if (/\blingual\b/.test(text)) add("P", "lingual");
  if (/\bmesial\b/.test(text)) add("M", "mesial");
  if (/\bdistal\b/.test(text)) add("D", "distal");
  return found;
}

/** Maps dictated faces onto V/P/M/D/O. A mismatch that has one clinical reading is kept and explained; an incisal face on a posterior is not guessed. */
export function resolveDictatedSurfaces(sentence: string, tooth: number): { surfaces: OdontogramSurface[]; notes: string[] } {
  const anterior = tooth % 10 <= 3;
  const upper = [1, 2, 5, 6].includes(Math.floor(tooth / 10));
  const label = `FDI ${formatFdi(tooth)}`;
  const surfaces: OdontogramSurface[] = [];
  const notes: string[] = [];
  const add = (code: OdontogramSurface) => { if (!surfaces.includes(code)) surfaces.push(code); };
  const note = (text: string) => { if (!notes.includes(text)) notes.push(text); };
  for (const item of collectRawSurfaces(sentence)) {
    if (item.via === "oclusal" && anterior) {
      add("O");
      note(`En ${label}, «oclusal» se registró como incisal.`);
      continue;
    }
    if (item.via === "incisal" && !anterior) {
      note(`En ${label}, «incisal» no corresponde a una pieza posterior y no se marcó.`);
      continue;
    }
    if (item.via === "palatina" && !upper) {
      add("P");
      note(`En ${label}, «palatina» se registró como lingual.`);
      continue;
    }
    if (item.via === "lingual" && upper) {
      add("P");
      note(`En ${label}, «lingual» se registró como palatina.`);
      continue;
    }
    add(item.code);
  }
  return { surfaces, notes };
}

function icdasFrom(sentence: string): number | null {
  const digit = sentence.match(/\bicdas\s*([1-6])\b/i);
  if (digit) return Number(digit[1]);
  const roman = sentence.match(/\bicdas\s*(IV|VI|III|II|V|I)\b/i);
  if (!roman) return null;
  return { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 }[roman[1].toUpperCase()] ?? null;
}

function activityFrom(sentence: string): SurfaceFinding["activity"] {
  if (/\binactiv[ao]\b/i.test(sentence)) return "inactive";
  if (/\binciert[ao]\b|\bdudos[ao]\b/i.test(sentence)) return "uncertain";
  if (/\bactiv[ao]\b/i.test(sentence)) return "active";
  return null;
}

function materialFrom(sentence: string): CrownMaterial | undefined {
  if (/\b(?:zirconio|circonio)\b/i.test(sentence)) return "Zirconio";
  if (/\bdisilicato\b/i.test(sentence)) return "Disilicato";
  if (/\bmetal\s*-?\s*porcelana\b|\bmetal[ -]?cer[aá]mica\b/i.test(sentence)) return "Metal cerámica";
  if (/\bresina\b/i.test(sentence)) return "Resina";
  if (/\botro\s+material\b/i.test(sentence)) return "Otro";
  return undefined;
}

function shadeFrom(sentence: string): string | null {
  return sentence.match(/\b(?:color|shade)\s+([A-D][1-4](?:\.5)?)\b/i)?.[1]?.toUpperCase() ?? null;
}

function missingReasonFrom(sentence: string): OdontogramChange["missingReason"] | undefined {
  if (/\bpor\s+caries\b/i.test(sentence)) return "caries";
  if (/\bpor\s+extracci[oó]n\b|\botra\s+causa\b/i.test(sentence)) return "other";
  if (/\bcausa\s+(?:desconocida|no\s+precisada)\b/i.test(sentence)) return "unknown";
  return undefined;
}

function crownOnImplantSentence(sentence: string): boolean {
  return /\b(?:corona|pr[oó]tesis\s+fija)\b/i.test(sentence)
    && /\b(?:sobre|encima\s+de|en)\s+(?:el\s+|la\s+|un\s+)?implante\b/i.test(sentence)
    && !(/\bprovisori[ao]\b/i.test(sentence) && !/\bdefinitiv[ao]\b/i.test(sentence));
}

const EXTRACTION_INDICATED = /(?<!\p{L})(?:indicaci[oó]n\s+de\s+exodoncia|indica(?:da)?\s+(?:la\s+)?exodoncia|exodoncia\s+indicada|para\s+exodoncia)(?!\p{L})/iu;

/** Exodoncia efectuada en la sesión (no planificada ni indicada): la pieza queda ausente. */
const EXTRACTION_DONE = /(?<!\p{L})(?:se\s+(?:realiz[aó]|hace|hizo|efect[uú]a|efectu[oó]|practic[aó])\s+(?:la\s+|una\s+)?(?:exodoncia|extracci[oó]n)|se\s+extra(?:e|jo|jeron)|exodoncia\s+(?:realizada|efectuada)|extracci[oó]n\s+(?:realizada|efectuada))(?!\p{L})/iu;

function statusFrom(sentence: string): ToothStatus | null {
  if (EXTRACTION_DONE.test(sentence) && !/\b(?:planific|se\s+indic|se\s+plante)/i.test(sentence)) return "Ausente";
  if (/\bresto\s+radicular\b/i.test(sentence) && /\bendodoncia\b/i.test(sentence)) return "Resto radicular con endodoncia";
  if (EXTRACTION_INDICATED.test(sentence)) return "Indicación de exodoncia";
  if (crownOnImplantSentence(sentence)) return null;
  if (/\bimplante\b/i.test(sentence) && !/\b(?:corona|pr[oó]tesis\s+fija)\b/i.test(sentence)) {
    if (/\b(?:control\p{L}*|seguimiento|revisi[oó]n|mantenimiento)(?!\p{L})/iu.test(sentence) && !isPerformed(sentence)) return null;
    if (/\b(?:planific|se\s+indic|program)\b/i.test(sentence)) return null;
    return "Implante";
  }
  if (/\b(?:corona|pr[oó]tesis\s+fija\s+definitiva)\b/i.test(sentence) && !/\bprovisori[ao]\b/i.test(sentence)) return "Corona";
  if (/\b(?:ausente|extra[ií]d[oa]|exodonciad[oa])\b/i.test(sentence)) return "Ausente";
  if (/(?<!\p{L})ausencia\s+(?:de(?:l|\s+la)?\s+)?(?:pieza\s+|diente\s+)?\d/iu.test(sentence)) return "Ausente";
  return null;
}

type FindingResult = { finding: SurfaceFinding; depthNote?: string } | { error: string; partial?: SurfaceFinding } | null;

/** Pregunta opcional (no bloquea) cuando la caries se dictó sin profundidad. Mismo formato para reglas e IA, así se deduplica. */
export function depthQuestion(heading: string, ambiguous: string | undefined, quote: string): string {
  return `${heading}: ${ambiguous ? `${ambiguous}; ` : ""}¿profundidad de la caries (${CARIES_DEPTH_QUESTION})? Opcional: «${clip(quote.trim().replace(/[.;,]+$/, ""))}».`;
}

/** Restauración hecha en la sesión (no una obturación existente). */
const TREATED_RESTORATION = /(?<!\p{L})(?:se\s+(?:realiz[aó]|hace|hizo|efect[uú]a|efectu[oó]|obtur[aó]|restaur[aó])|(?:obturad[oa]|restaurad[oa])\s+hoy)(?!\p{L})/iu;

function restorationDetailsFrom(sentence: string): Pick<SurfaceFinding, "restorationStage" | "restorationMaterial"> {
  const restorationStage = /\bprovisori[oa]\b/iu.test(sentence)
    ? "provisional"
    : /\b(?:definitiv[oa]|permanent[ae])\b/iu.test(sentence) ? "definitive" : null;
  let restorationMaterial: RestorationMaterial | null = null;
  if (/\b(?:composite|resina\s+compuesta|resina)\b/iu.test(sentence)) restorationMaterial = "Resina compuesta";
  else if (/\b(?:vidrio\s+ion[oó]mero|ion[oó]mero\s+de\s+vidrio|\bgic\b)/iu.test(sentence)) restorationMaterial = "Vidrio ionómero";
  else if (/\bamalgama\b/iu.test(sentence)) restorationMaterial = "Amalgama";
  else if (/\bcavit\b/iu.test(sentence)) restorationMaterial = "Cavit";
  else if (/\birm\b/iu.test(sentence)) restorationMaterial = "IRM";
  else if (/\botro\s+material\b/iu.test(sentence)) restorationMaterial = "Otro";
  return { restorationStage, restorationMaterial };
}

function restoredFinding(sentence: string): SurfaceFinding {
  return { condition: "restored", depth: null, icdas: null, activity: null, ...restorationDetailsFrom(sentence) };
}

function findingFrom(sentence: string): FindingResult {
  const deniesCaries = /\b(?:sin|no)\s+(?:se\s+observa\s+)?caries\b/i.test(sentence);
  const hasCaries = /\bcaries\b/i.test(sentence) && !deniesCaries;
  // «resina vestibular» o «amalgama oclusal» dictadas solas son una obturación existente.
  const restored = /\b(?:obturaci[oó]n|obturad[oa]|restauraci[oó]n|restaurad[oa]|resina|amalgama|ion[oó]mero)\b/i.test(sentence);
  const sealant = /\bsellante\b/i.test(sentence);
  const other = /\botra\s+restauraci[oó]n\b/i.test(sentence);
  const sound = /\b(?:sana|sano|sin\s+lesi[oó]n)\b/i.test(sentence) || deniesCaries;
  // «Se realiza obturación … por caries de dentina»: la caries es el motivo; la cara queda obturada.
  if (hasCaries && restored && !sealant && !other && !sound && TREATED_RESTORATION.test(sentence)) {
    return { finding: restoredFinding(sentence) };
  }
  const kinds = [hasCaries, restored, sealant, other, sound].filter(Boolean).length;
  if (kinds > 1) return { error: `La frase mezcla hallazgos de superficie y no se eligió uno: «${clip(sentence)}».` };
  if (hasCaries) {
    // La caries se registra igual; la profundidad es opcional y, si falta, solo se pregunta.
    const reading = cariesDepthFrom(sentence);
    const finding: SurfaceFinding = { condition: "caries", depth: reading.depth, icdas: (icdasFrom(sentence) ?? null) as SurfaceFinding["icdas"], activity: activityFrom(sentence) };
    return reading.depth ? { finding } : { finding, depthNote: reading.ambiguous ?? "" };
  }
  if (restored) return { finding: restoredFinding(sentence) };
  if (sealant) return { finding: { condition: "sealant", depth: null, icdas: null, activity: null } };
  if (other) return { finding: { condition: "other_restoration", depth: null, icdas: null, activity: null } };
  if (sound) return { finding: { condition: "sound", depth: null, icdas: null, activity: null } };
  return null;
}

function perioSite(sentence: string): PerioSite | null {
  // Acepta «mesial vestibular», «mesio vestibular», «mesiovestibular», «disto-lingual», «palatal»…
  const text = sentence.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const mesial = /\bmesi(?:al\b|o\s*-?\s*(?=vestibul|buca|lingu|palat))/.test(text);
  const distal = /\bdist(?:al\b|o\s*-?\s*(?=vestibul|buca|lingu|palat))/.test(text);
  const vestibular = /(?:\b|mesio|disto)(?:vestibular|bucal)\b/.test(text);
  const lingual = /(?:\b|mesio|disto)(?:lingual|palatin[oa]|palatal)\b/.test(text);
  if (mesial && distal) return null;
  if (mesial && vestibular) return "MV";
  if (distal && vestibular) return "DV";
  if (mesial && lingual) return "ML";
  if (distal && lingual) return "DL";
  if (vestibular) return "V";
  if (lingual) return "L";
  return null;
}

const SURFACE_ORDER = ["M", "O", "D", "V", "P"];

function fdiToChile(tooth: number): number | null {
  for (let position = 1; position <= 32; position += 1) if (chileToFdi(position) === tooth) return position;
  return null;
}

function faceWord(tooth: number, surface: OdontogramSurface): string {
  const lower = [3, 4, 7, 8].includes(Math.floor(tooth / 10));
  if (surface === "P") return lower ? "lingual" : "palatina";
  if (surface === "O") return tooth % 10 <= 3 ? "incisal" : "oclusal";
  if (surface === "V") return "vestibular";
  if (surface === "M") return "mesial";
  return "distal";
}

function facesLabel(tooth: number, surfaces: OdontogramSurface[]): string {
  const sorted = [...surfaces].sort((a, b) => SURFACE_ORDER.indexOf(a) - SURFACE_ORDER.indexOf(b));
  if (sorted.length === 1) return faceWord(tooth, sorted[0]);
  return sorted.map((surface) => surface === "O" && tooth % 10 <= 3 ? "I" : surface).join("-");
}

function describeFinding(tooth: number, finding: SurfaceFinding, surfaces: OdontogramSurface[], root = false): string {
  const faces = facesLabel(tooth, surfaces);
  if (finding.condition === "caries") {
    const name = finding.depth && isCariesDepth(finding.depth) ? CARIES_DEPTH_LABEL[finding.depth].toLowerCase() : "caries (profundidad no consignada)";
    const legacy = !finding.depth && finding.icdas ? `, ICDAS ${finding.icdas}` : "";
    const activity = finding.activity === "active" ? ", activa" : finding.activity === "inactive" ? ", inactiva" : "";
    return `${name} ${faces}${legacy}${activity} (${icd11Label(cariesIcd11(finding.depth, root))})`;
  }
  if (finding.condition === "restored") {
    const details = [
      finding.restorationStage === "provisional" ? "provisoria" : finding.restorationStage === "definitive" ? "definitiva" : "",
      finding.restorationMaterial ?? "",
    ].filter(Boolean);
    return "obturación " + faces + (details.length ? " (" + details.join(" · ") + ")" : "");
  }
  if (finding.condition === "sealant") return `sellante ${faces}`;
  if (finding.condition === "sound") return `sin lesión visible ${faces}`;
  return `otra restauración ${faces}`;
}

function describeStatus(item: OdontogramChange): string {
  if (item.status === "Corona" || item.kind === "crown") {
    const seat = item.foundation === "implant" ? " sobre implante" : "";
    return `corona${seat}${item.material ? ` de ${item.material}` : ""}${item.shade ? `, color ${item.shade}` : ""}`;
  }
  if (item.status === "Ausente" && /extracci/i.test(item.sourceText)) return "ausente por extracción";
  if (item.status === "Ausente" && item.missingReason === "caries") return "ausente por caries";
  if (item.status === "Ausente") return "ausente";
  if (item.status === "Implante") return "implante";
  if (item.status === "Implante con pilar") return "implante con pilar";
  if (item.status === "Indicación de exodoncia") return "indicación de exodoncia";
  if (item.status === "Resto radicular con endodoncia") return "resto radicular con endodoncia";
  return item.status ?? "estado registrado";
}

function toothHeading(item: OdontogramChange): string {
  const chile = fdiToChile(item.tooth);
  const fdi = `FDI ${formatFdi(item.tooth)}`;
  return chile && item.tooth < 50 ? `${fdi} (Chile ${chile})` : item.numberingLabel || fdi;
}

function examLines(items: OdontogramChange[]): string[] {
  const teeth: number[] = [];
  for (const item of items) if (!teeth.includes(item.tooth)) teeth.push(item.tooth);
  return teeth.map((tooth) => {
    const group = items.filter((item) => item.tooth === tooth);
    const parts: string[] = [];
    const buckets = new Map<string, { finding: SurfaceFinding; surfaces: OdontogramSurface[]; root: boolean }>();
    for (const item of group) {
      if (item.kind !== "surface" || !item.surface || !item.finding) continue;
      const root = item.finding.condition === "caries" && isRootCaries(item.sourceText);
      const key = `${item.finding.condition}:${item.finding.depth ?? ""}:${item.finding.icdas ?? ""}:${item.finding.activity ?? ""}:${root ? "r" : ""}`;
      const bucket = buckets.get(key) ?? { finding: item.finding, surfaces: [], root };
      bucket.surfaces.push(item.surface);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) parts.push(describeFinding(tooth, bucket.finding, bucket.surfaces, bucket.root));
    for (const item of group) if (item.kind !== "surface") parts.push(describeStatus(item));
    return `${toothHeading(group[0])}: ${parts.join(". ")}.`;
  });
}

export const EXAM_REGISTRY_HEADER = "Examen (odontograma)";
export const TRANSCRIPT_HEADER = "Transcripción completa";
const FICHA_HEADER: Record<FichaField, string> = { allergies: "Alergias", history: "Antecedentes", medications: "Medicamentos" };

function fichaFrom(sentence: string): FichaField | null {
  if (/(?<!\p{L})(?:se\s+indica|receta|prescrib\p{L}*|se\s+deja)(?!\p{L})/iu.test(sentence)) return null;
  if (/(?<!\p{L})al[eé]rg\p{L}*/iu.test(sentence)) return "allergies";
  if (/(?<!\p{L})(?:medicamentos?|f[aá]rmacos?|toma(?!\s+de(?!\p{L}))|tomando|consume|en\s+tratamiento\s+con|losart[aá]n|metformina|aspirina|clopidogrel|anticoagulante\p{L}*|warfarina|acenocumarol|levotiroxina|enalapril|insulina|omeprazol|atorvastatina)(?!\p{L})|\d+\s*(?:mg|mcg)(?!\p{L})/iu.test(sentence)) return "medications";
  if (/(?<!\p{L})(?:antecedentes?|hipertens\p{L}*|diab[eé]t\p{L}*|cardi[oó]pat\p{L}*|asm[aá]tic\p{L}*|asma|embarazad\p{L}*|epilep\p{L}*|hipotiroid\p{L}*|hipertiroid\p{L}*|fumador\p{L}*|tabaquismo|bifosfonatos?|radioterapia|quimioterapia|vih|hepatitis|marcapasos|anticoagulad\p{L}*)(?!\p{L})/iu.test(sentence)) return "history";
  return null;
}

/** «alérgica a la penicilina toma losartán»: alergia y medicamento son dos datos de la ficha. */
const FICHA_CUT = /\s*[,;]?\s+(?=(?:y\s+)?(?:toma|tomando|consume|usa|en\s+tratamiento\s+con|al[eé]rgic\p{L}*|alergia|antecedentes?|hipertens\p{L}*|diab[eé]t\p{L}*)(?!\p{L}))/iu;

function fichaParts(sentence: string): Array<{ field: FichaField; text: string }> {
  const out: Array<{ field: FichaField; text: string }> = [];
  for (const raw of sentence.split(new RegExp(FICHA_CUT.source, "giu"))) {
    const text = raw.replace(/^y\s+/i, "").trim();
    if (!text) continue;
    const field = fichaFrom(text);
    const last = out.at(-1);
    if (!field || (last && last.field === field)) {
      if (last) last.text = `${last.text} ${text}`;
      else out.push({ field: fichaFrom(sentence) ?? "history", text });
    } else out.push({ field, text });
  }
  return out.length ? out : [{ field: fichaFrom(sentence) ?? "history", text: sentence }];
}

/** Motivo de la visita dicho por el profesional («viene a control por…», «motivo de consulta…»). */
const VISIT_REASON = /(?<!\p{L})(?:motivo\s+de\s+(?:la\s+)?consulta|viene\s+(?:a|por|para)|acude\s+(?:a|por|para)|consulta\s+por)(?!\p{L})/iu;
/** Estado observado sin cambio de odontograma («se encuentra en buen estado», «sin sangrado», «conectado con pilar»). */
const EXAM_STATE = /(?<!\p{L})(?:se\s+encuentra|buen\s+estado|sin\s+(?:hemorragia|sangrado|inflamaci[oó]n|supuraci[oó]n|dolor|movilidad)|conectad[oa]|cicatriz\p{L}*|cerr[oó]\s+bien|t[eé]cnica\s+flapless|flapless)(?!\p{L})/iu;

/** Lo hecho hoy dicho en presente («se realiza profilaxis», «se instala pilar», «se cambia arco»). */
const PERFORMED_TODAY = /(?<!\p{L})(?<!no\s)se\s+(?:realiza|hace|efect[uú]a|instala|coloca|cementa|atornilla|cambia|activa(?:n)?|ajusta|pule|obtura|restaura|extrae|retira|entrega|toma)(?!\p{L})/iu;

/** Rehace la sección «Examen (odontograma)» con los cambios que quedaron propuestos. */
export function replaceExamSection(body: string, items: OdontogramChange[]): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => line.trim() === EXAM_REGISTRY_HEADER);
  const registry = examLines(items);
  if (at >= 0) {
    let stop = at + 1;
    while (stop < lines.length && lines[stop].trim() !== "") stop += 1;
    lines.splice(at, stop - at + (stop < lines.length ? 1 : 0), ...(registry.length ? [EXAM_REGISTRY_HEADER, ...registry, ""] : []));
  } else if (registry.length) {
    lines.unshift(EXAM_REGISTRY_HEADER, ...registry, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function composeEvolution(transcript: string, odontogram: OdontogramChange[] = [], clarifications: string[] = [], ficha: FichaChange[] = []): { title: string; body: string } | null {
  const clean = transcript.trim();
  if (!clean) return null;
  const sources = new Set(odontogram.map((item) => clip(item.sourceText, 400)));
  const fichaBySource = new Map(ficha.map((item) => [clip(item.evidence, 400), item.field] as const));
  const relato: string[] = [];
  const fichaLines: Record<FichaField, string[]> = { allergies: [], history: [], medications: [] };
  const otrosExamen: string[] = [];
  const diagnostico: string[] = [];
  const procedimientos: string[] = [];
  const indicaciones: string[] = [];
  const plan: string[] = [];
  const presupuesto: string[] = [];
  const sondaje: string[] = [];
  const pagos: string[] = [];
  const citas: string[] = [];
  const aclaraciones: string[] = [];
  const resto: string[] = [];
  const unresolved: string[] = [];
  // Frases ya respondidas con «Aclaración: <frase>: <respuesta>» no quedan como pendientes.
  const answered = new Set(sentences(clean)
    .map((sentence) => sentence.match(/^aclaraci[oó]n:\s*(.+):[^:]*$/iu)?.[1])
    .filter((quote): quote is string => Boolean(quote))
    .map((quote) => normalizeEvidence(quote)));
  for (const sentence of sentences(clean)) {
    const line = ensurePeriod(capitalize(sentence));
    const key = clip(sentence, 400);
    if (answered.has(normalizeEvidence(sentence)) && sources.size && toothMentions(sentence).length > 0 && !OTHER_FINDING.test(sentence) && !/^aclaraci/iu.test(sentence)) continue;
    if (VISIT_REASON.test(sentence) && !isAppointmentText(sentence)) { relato.push(line); continue; }
    if (sources.has(key)) {
      if (OTHER_FINDING.test(sentence)) otrosExamen.push(line);
      else if (TREATED_RESTORATION.test(sentence) || isPerformed(sentence) || PERFORMED_TODAY.test(sentence)) procedimientos.push(line);
      continue;
    }
    const field = fichaBySource.get(key);
    if (/^aclaraci[oó]n:/iu.test(sentence)) aclaraciones.push(line);
    else if (field) fichaLines[field].push(line);
    else if (isPaymentText(sentence) && !isFuturePayment(sentence)) pagos.push(line);
    else if (isAppointmentText(sentence)) citas.push(line);
    else if (isPatient(sentence)) relato.push(line);
    else if (/\b(?:presupuesto|cotizaci[oó]n)\b/i.test(sentence)) presupuesto.push(line);
    else if (/\bse\s+(?:le\s+)?indica\b/i.test(sentence)) indicaciones.push(line);
    else if (PERFORMED_TODAY.test(sentence) && !isPlan(sentence)) procedimientos.push(line);
    else if (EXAM_STATE.test(sentence)) otrosExamen.push(line);
    else if (isPerformed(sentence)) procedimientos.push(line);
    else if (isPlan(sentence)) plan.push(line);
    else if (/(?<!\p{L})(?:sondaje|sondeo|movilidad)(?!\p{L})/iu.test(sentence)) sondaje.push(line);
    else if (isDiagnosisSentence(sentence)) diagnostico.push(line);
    else if (toothMentions(sentence).length > 0 && OTHER_FINDING.test(sentence)) otrosExamen.push(line);
    else if (toothMentions(sentence).length > 0) unresolved.push(line);
    else resto.push(line);
  }
  const lines: string[] = [];
  if (relato.length) lines.push("Motivo y relato", ...relato, "");
  for (const field of ["allergies", "history", "medications"] as const) {
    if (fichaLines[field].length) lines.push(FICHA_HEADER[field], ...fichaLines[field], "");
  }
  const exam = examLines(odontogram);
  if (exam.length) lines.push(EXAM_REGISTRY_HEADER, ...exam, "");
  if (otrosExamen.length) lines.push("Otros hallazgos del examen", ...otrosExamen, "");
  if (diagnostico.length) lines.push("Diagnóstico", ...diagnostico, "");
  if (procedimientos.length) lines.push("Procedimientos realizados", ...procedimientos, "");
  if (indicaciones.length) lines.push("Indicaciones", ...indicaciones, "");
  if (plan.length) lines.push("Plan de tratamiento", ...plan, "");
  if (presupuesto.length) lines.push("Presupuesto", ...presupuesto, "");
  if (sondaje.length) lines.push("Sondaje", ...sondaje, "");
  if (pagos.length) lines.push("Pagos", ...pagos, "");
  if (citas.length) lines.push("Próxima cita", ...citas, "");
  if (resto.length) lines.push("Otros dichos", ...resto, "");
  if (aclaraciones.length) lines.push("Aclaraciones del profesional", ...aclaraciones, "");
  const pending = [...new Set([...unresolved, ...clarifications.filter((item) => !ROUTING_QUESTION.test(item) && !DEPTH_QUESTION.test(item)).map((item) => item.trim()).filter(Boolean)])];
  if (pending.length) lines.push("Pendiente de aclarar", ...pending.map((item) => ensurePeriod(item)));
  const body = lines.join("\n").trim();
  return body ? { title: "Evolución dictada", body } : null;
}

function mergeFichaText(existing: string, additions: string[]): string {
  const base = existing.trim();
  const blank = !base || /^sin\s+registr\p{L}*\.?$/iu.test(base);
  const fresh = additions.map((item) => item.trim()).filter(Boolean)
    .filter((item) => blank || !normalizeEvidence(base).includes(normalizeEvidence(item)));
  if (!fresh.length) return blank ? base : base;
  return blank ? fresh.join(" ") : `${base}${/[.;]$/.test(base) ? "" : "."} ${fresh.join(" ")}`;
}

/** Valores nuevos de alergias y antecedentes de la ficha. Los medicamentos van dentro de antecedentes. Devuelve null si no hay cambios. */
export function planFichaUpdate(patient: { allergies?: string | null; history?: string | null }, accepted: FichaChange[]): { allergies: string; history: string } | null {
  if (!accepted.length) return null;
  const allergies = mergeFichaText(patient.allergies ?? "", accepted.filter((item) => item.field === "allergies").map((item) => item.text)).slice(0, 2000);
  const meds = accepted.filter((item) => item.field === "medications").map((item) => item.text);
  const history = mergeFichaText(patient.history ?? "", [
    ...accepted.filter((item) => item.field === "history").map((item) => item.text),
    ...(meds.length ? [`Medicamentos: ${meds.join(" ")}`] : []),
  ]).slice(0, 10000);
  if (allergies === (patient.allergies ?? "").trim() && history === (patient.history ?? "").trim()) return null;
  return { allergies: allergies || "Sin registrar", history };
}

export const DIAGNOSES_HEADER = "Diagnósticos (CIE-11)";

const DIAGNOSIS_STEM = "(?:pulp|necros|absces|periodont|fractur|fisur|quiste|retracc|recesi|agrand|hiperplas|atrici|desgast|abras|erosi|abfracc|infracc|pericoron|rest|raiz)";
const DIAGNOSIS_DOUBT = new RegExp(`\\b(?:descart\\p{L}*|sospecha|probable|posible|diagnostico diferencial|d\\/d|no\\s+se\\s+confirma|sin\\s+confirmar|por\\s+confirmar|a\\s+descartar|sin\\s+(?:signos?\\s+de\\s+|evidencia\\s+de\\s+)?(?:\\p{L}+\\s+)?${DIAGNOSIS_STEM})`, "iu");

const DIAGNOSIS_CUE = /\b(?:diagnostic[oa]s?|diagnosticamos|dx|corresponde\s+a|se\s+trata\s+de|cuadro\s+de|compatible\s+con)\b/;

function isDiagnosisSentence(sentence: string): boolean {
  if (isPatient(sentence) || isPlan(sentence) || isNegatedFinding(sentence)) return false;
  const plain = sentence.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return !DIAGNOSIS_DOUBT.test(plain) && diagnosisMatches(sentence).length > 0;
}

/** La duda clínica no se codifica; se convierte en una pregunta que vuelve al flujo de interpretación con IA. */
function uncertainDiagnosisQuestion(sentence: string): string | null {
  if (!DIAGNOSIS_DOUBT.test(fold(sentence))) return null;
  const matches = diagnosisMatches(sentence);
  if (!matches.length) return null;
  const terms = [...new Set(matches.map((item) => item.term || item.title))];
  const mentions = toothMentions(sentence).filter((item): item is Extract<Mention, { ok: true }> => item.ok);
  const location = mentions.length === 1 ? ` en FDI ${formatFdi(mentions[0].tooth)}` : "";
  return `Diagnóstico por confirmar: «${clip(sentence, 180)}». ¿El clínico confirma ${terms.join(" / ")}${location} como diagnóstico, o debe quedar solo como sospecha? Responde con la corrección; se volverá a interpretar con IA.`;
}

function diagnosisUncertaintyAnswered(sentence: string, transcript: string): boolean {
  const source = normalizeEvidence(sentence);
  return transcript.split(/\n+/).some((line) => {
    if (!/^\s*Aclaraci[oó]n\s*:/iu.test(line)) return false;
    const match = line.match(/^\s*Aclaraci[oó]n\s*:\s*(.+?):\s*(.+)$/iu);
    if (!match?.[2].trim()) return false;
    return source.includes(normalizeEvidence(match[1]));
  });
}

/** Texto de la línea de un diagnóstico en la nota. */
export function diagnosisLabel(item: Pick<DiagnosisItem, "tooth" | "code" | "title" | "findings" | "suggested">): string {
  const where = item.tooth ? `FDI ${formatFdi(item.tooth)}${item.findings ? ` ${item.findings}` : ""}: ` : item.findings ? `${item.findings}: ` : "";
  const code = item.code ? `CIE-11 ${item.code}` : "sin código CIE-11";
  const suggested = item.suggested ? `, equivalencia sugerida de «${item.suggested.term}»` : "";
  return `${where}${item.title} (${code}${suggested})`;
}

/**
 * Diagnósticos dictados por el profesional (no relatos del paciente, ni negaciones, ni sospechas, ni planes),
 * con código CIE-11 verificado o como etiqueta sin código. Las caries van aparte, con su profundidad.
 */
export function textDiagnoses(text: string): DiagnosisItem[] {
  const out: DiagnosisItem[] = [];
  for (const sentence of sentences(text)) {
    if (!isDiagnosisSentence(sentence)) continue;
    const mention = toothMentions(sentence).find((item) => item.ok);
    const sentenceTooth = mention && mention.ok ? mention.tooth : undefined;
    // «pieza 1.1 subluxación pieza 2.1 fractura…»: cada pieza dictada lleva su propio diagnóstico.
    const clauses = sentence.split(/(?=\b(?:pieza|diente)\s)/iu).filter((clause) => clause.trim());
    const found = clauses.length > 1
      ? clauses.flatMap((clause) => {
          const own = toothMentions(clause).find((item) => item.ok);
          let tooth = own && own.ok ? own.tooth : undefined;
          if (tooth === undefined && diagnosisMatches(clause).length) {
            // «Fractura coronaria complicada de la | pieza 21…»: el corte deja la pieza en la cláusula siguiente.
            const index = clauses.indexOf(clause);
            const next = clauses[index + 1] ? toothMentions(clauses[index + 1]).find((item) => item.ok) : undefined;
            if (next && next.ok && /(?:\b(?:de|del|en|a|la|el)\s*)+$/iu.test(clause.trim())) tooth = next.tooth;
            else tooth = sentenceTooth;
          }
          return diagnosisMatches(clause).map((match) => ({ match, tooth }));
        })
      : (() => {
          const matches = diagnosisMatches(sentence);
          // Un solo diagnóstico para varias piezas de la misma frase («desgaste en 1.3 y 2.3»): uno por pieza.
          const teeth = [...new Set(toothMentions(sentence).filter((item) => item.ok).map((item) => (item as { tooth: number }).tooth))];
          if (matches.length === 1 && teeth.length > 1) return teeth.map((tooth) => ({ match: matches[0], tooth }));
          return matches.map((match) => ({ match, tooth: sentenceTooth }));
        })();
    for (const { match, tooth: mentioned } of found) {
      // La periodontitis y la gingivitis se dictan del paciente, no de la pieza que se nombre en la misma frase.
      const tooth = /^(?:periodontitis|gingivitis)(?!\p{L}*\s+(?:apical|periapical))/iu.test(match.title) ? undefined : mentioned;
      if (out.some((done) => done.code === match.code && done.title === match.title && done.tooth === tooth)) continue;
      const item: DiagnosisItem = { id: `dx-${out.length + 1}`, tooth, code: match.code, title: match.title, label: "", evidence: clip(sentence, 400), findings: "", origin: "reglas", term: match.term, ...(match.suggested ? { suggested: match.suggested } : {}) };
      item.label = diagnosisLabel(item);
      out.push(item);
    }
  }
  return out;
}

const ROOT_CARIES = /\b(?:caries\s+(?:de\s+(?:la\s+)?)?(?:radicular|raiz|cemento)|radicular|cementari[ao]|superficie\s+radicular)\b/;

/** Caries radicular (cemento): se dijo en la cita del hallazgo. */
export function isRootCaries(sourceText: string | undefined): boolean {
  return ROOT_CARIES.test(fold(sourceText ?? "")) && !/\bresto\s+radicular\b/.test(fold(sourceText ?? ""));
}

/**
 * Diagnóstico CIE-11 de cada caries propuesta, por pieza y profundidad. La caries con compromiso pulpar
 * propone además un diagnóstico pulpar (DA09.Z) como sugerencia a confirmar.
 */
export function cariesDiagnoses(items: OdontogramChange[]): DiagnosisItem[] {
  const groups = new Map<string, OdontogramChange[]>();
  for (const original of items) {
    if (original.kind !== "surface") continue;
    // Caries tratada en la misma sesión: la superficie queda restaurada, pero el diagnóstico se conserva.
    const item = original.finding?.condition === "caries" ? original : original.finding?.condition === "restored" && original.treatedCaries ? { ...original, finding: original.treatedCaries } : null;
    if (!item || item.finding?.condition !== "caries") continue;
    const key = `${item.tooth}:${item.finding.depth ?? ""}:${isRootCaries(item.sourceText) ? "r" : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: DiagnosisItem[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const depth = first.finding?.depth ?? null;
    const root = isRootCaries(first.sourceText);
    const icd = cariesIcd11(depth, root);
    const name = (depth ? CARIES_DEPTH_LABEL[depth] : "Caries, profundidad no consignada") + (root && depth !== "pulpar" ? " (radicular)" : "");
    const faces = facesLabel(first.tooth, group.map((item) => item.surface).filter((face): face is OdontogramSurface => Boolean(face)));
    const findings = `${faces}: ${name.toLowerCase()}`;
    out.push({ id: `dxc-${out.length + 1}`, tooth: first.tooth, code: icd.code, title: icd.title, label: `FDI ${formatFdi(first.tooth)} ${faces}: ${name} (${icd11Label(icd)})`, evidence: clip(first.sourceText, 400), findings, origin: "reglas" });
    if (depth === "pulpar" && !out.some((item) => item.tooth === first.tooth && item.code === "DA09.Z")) {
      const pulp = ICD11["DA09.Z"];
      const item: DiagnosisItem = { id: `dxc-${out.length + 1}`, tooth: first.tooth, code: pulp.code, title: pulp.title, label: "", evidence: clip(first.sourceText, 400), findings: "caries con compromiso pulpar", origin: "reglas", suggested: { from: "caries-pulpar", term: "caries con compromiso pulpar" } };
      item.label = diagnosisLabel(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Junta los diagnósticos de caries, reglas e IA. Si ya se dictó un diagnóstico pulpar (DA09.x) para la pieza,
 * no se sugiere DA09.Z por la caries pulpar. Coincidencias IA/reglas quedan como «ia+reglas».
 */
export function mergeDiagnoses(caries: DiagnosisItem[], rules: DiagnosisItem[], ai: DiagnosisItem[] = []): DiagnosisItem[] {
  const out: DiagnosisItem[] = [];
  const same = (a: DiagnosisItem, b: DiagnosisItem) => a.code === b.code && (a.code ? true : fold(a.title) === fold(b.title)) && (a.tooth ?? 0) === (b.tooth ?? 0);
  for (const item of [...rules, ...ai]) {
    const prior = out.find((done) => same(done, item));
    if (prior) { if (prior.origin !== item.origin) prior.origin = "ia+reglas"; continue; }
    out.push({ ...item });
  }
  const pulpCoded = (tooth?: number) => out.some((item) => item.tooth === tooth && item.code.startsWith("DA09") && item.code !== "DA09.Z");
  const withCaries = caries.filter((item) => !(item.suggested?.from === "caries-pulpar" && pulpCoded(item.tooth)));
  return [...withCaries, ...out].map((item, index) => ({ ...item, id: `dx-${index + 1}` }));
}

/** Concepto elegido por la IA → código del catálogo: por las reglas o por título/sinónimo exacto. */
function diagnosisFromTerm(term: string): { code: string; title: string; suggested?: SuggestedMapping } | null {
  const matches = diagnosisMatches(term);
  if (matches.length) return matches[0];
  const target = fold(term).replace(/[.,;:]+$/, "").trim();
  if (target.length < 4) return null;
  for (const entry of ICD11_CATALOG) {
    if (entry.kind !== "stem" || !entry.isLeaf) continue;
    if ([entry.title, ...entry.synonyms].some((name) => fold(name) === target)) return { code: entry.code, title: ICD11[entry.code].title };
  }
  return null;
}

function withoutSection(lines: string[], header: string): string[] {
  const at = lines.findIndex((line) => line.trim() === header);
  if (at < 0) return lines;
  let stop = at + 1;
  while (stop < lines.length && lines[stop].trim() !== "") stop += 1;
  return [...lines.slice(0, at), ...lines.slice(stop + 1)];
}

/** Agrega (o reemplaza) la sección de diagnósticos CIE-11 dictados, antes de la transcripción literal. */
export function withDiagnosesSection(body: string, diagnoses: DiagnosisItem[]): string {
  const lines = withoutSection(body.replace(/\r\n/g, "\n").split("\n"), DIAGNOSES_HEADER);
  const textOnly = diagnoses.filter((item) => !item.code.startsWith("DA08.0")).map((item) => ({ ...item, label: item.label || diagnosisLabel(item) }));
  if (!textOnly.length) return lines.join("\n").trim();
  const cut = lines.findIndex((line) => line.trim() === TRANSCRIPT_HEADER);
  const at = cut >= 0 ? cut : lines.length;
  lines.splice(at, 0, ...(at > 0 && lines[at - 1].trim() !== "" ? [""] : []), DIAGNOSES_HEADER, ...textOnly.map((item) => item.label), "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Arma el texto clínico que se guarda: nota revisada y odontograma aceptado; el dictado queda fuera del historial. */
export function finalizeEvolution(body: string, accepted: OdontogramChange[], diagnoses?: DiagnosisItem[]): string {
  // Sin lista se respeta la nota tal como quedó editada (incluida su sección CIE-11); con lista (aunque vacía),
  // la sección refleja exactamente las etiquetas confirmadas por el profesional.
  const lines = (diagnoses ? withDiagnosesSection(body, diagnoses) : body.replace(/\r\n/g, "\n")).split("\n");
  const cut = lines.findIndex((line) => line.trim() === TRANSCRIPT_HEADER);
  const kept = cut >= 0 ? lines.slice(0, cut) : lines;
  let at = kept.findIndex((line) => line.trim() === EXAM_REGISTRY_HEADER);
  if (at >= 0) {
    let stop = at + 1;
    while (stop < kept.length && kept[stop].trim() !== "") stop += 1;
    kept.splice(at, stop - at + (stop < kept.length ? 1 : 0));
  } else {
    const exam = kept.findIndex((line) => /^examen\b/i.test(line.trim()));
    if (exam >= 0) {
      let stop = exam + 1;
      while (stop < kept.length && kept[stop].trim() !== "") stop += 1;
      at = stop + 1;
    } else at = kept.length;
  }
  const registry = examLines(accepted);
  if (registry.length) kept.splice(Math.min(at, kept.length), 0, EXAM_REGISTRY_HEADER, ...registry, "");
  const note = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return note.slice(0, 30000);
}

function dedupeKey(item: OdontogramChange): string {
  return [item.tooth, item.kind, item.surface ?? "", item.status ?? "", item.foundation ?? "", item.finding?.condition ?? "", item.finding?.depth ?? "", item.finding?.icdas ?? "", item.material ?? ""].join(":");
}

export function structureTranscript(transcript: string, options: { today?: string } = {}): DictationProposal {
  const today = options.today ?? santiagoToday();
  const clarifications: string[] = [];
  const odontogram: OdontogramChange[] = [];
  const budget: BudgetChange[] = [];
  const perio: PerioStub[] = [];
  const perioPending: PerioPending[] = [];
  const mobility: MobilityChange[] = [];
  const payments: PaymentChange[] = [];
  const appointments: AppointmentChange[] = [];
  const incomplete: OdontogramChange[] = [];
  const ficha: FichaChange[] = [];
  const seen = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  const allSentences = sentences(transcript).flatMap((line) => {
    const parts = line.split(/,?\s+y\s+(?=ausencia\s+de(?:l|\s+la|\s+las)?\s)/iu).filter((part) => part.trim());
    // «caries … en la 4.6, y caries … en la 4.5»: cada hallazgo con su pieza va aparte para no mezclar las caras.
    return parts.flatMap((part) => {
      const pieces = part.split(/,\s+(?:y\s+)?(?=(?:caries|obturaci[oó]n|restauraci[oó]n|sellantes?|fractura|lesi[oó]n)(?!\p{L}))/iu).filter((piece) => piece.trim());
      return pieces.length > 1 && pieces.every((piece) => toothMentions(piece).some((found) => found.ok)) ? pieces : [part];
    });
  });
  // «El diagnóstico está claro…» no es un diagnóstico perdido si en otra frase sí se dictó uno reconocido.
  const transcriptHasDiagnosis = allSentences.some((line) => isDiagnosisSentence(line));
  for (const [sentenceIndex, sentence] of allSentences.entries()) {
    const field = fichaFrom(sentence);
    if (field && toothMentions(sentence).length === 0) {
      for (const part of fichaParts(sentence)) {
        ficha.push({ id: nextId("fic"), field: part.field, text: ensurePeriod(capitalize(clip(part.text, 400))), evidence: clip(part.text, 400), origin: "reglas" });
      }
      continue;
    }
    // Un diagnóstico dictado queda como etiqueta para confirmar en la revisión: no hace falta el aviso.
    const taggedDiagnosis = isDiagnosisSentence(sentence);
    if (!taggedDiagnosis && !/^\s*Aclaraci[oó]n\s*:/iu.test(sentence) && !diagnosisUncertaintyAnswered(sentence, transcript)) {
      const question = uncertainDiagnosisQuestion(sentence);
      if (question) clarifications.push(question);
    }
    if (!taggedDiagnosis && /\b(?:epb|l[oö]e[\s-]?silness|aap[\s-]?efp|estadio|grado)\b/i.test(sentence) && /\b(?:periodon|sextante|epb|gingival)\b/i.test(sentence)) {
      clarifications.push("El dictado menciona tamizaje o clasificación periodontal. No se infiere diagnóstico ni se guarda el periodontograma.");
    }
    if (!taggedDiagnosis && !transcriptHasDiagnosis && /\bdiagn[oó]stico\b/i.test(sentence)) {
      clarifications.push("No se creó un diagnóstico confirmado a partir del dictado.");
    }
    const grade = mobilityGrade(sentence);
    if (grade) {
      for (const mention of toothMentions(sentence)) {
        if (mention.ok) mobility.push({ id: nextId("mov"), tooth: mention.tooth, numberingLabel: mention.numberingLabel, grade, evidence: clip(sentence, 400), origin: "reglas" });
      }
    }
    if (/(?<!\p{L})(?:sondaje|sondeo)(?!\p{L})/iu.test(sentence)) {
      // Varias mediciones en una frase («mesiovestibular 5 mm con sangrado, distovestibular 6 mm»): una lectura por sitio.
      const several = perioFragments(sentence);
      if (several.length >= 2) {
        for (const part of several) {
          perio.push({
            id: nextId("per"), tooth: part.mention.tooth, numberingLabel: part.mention.numberingLabel, site: part.site, siteLabel: SITE_LABEL[part.site],
            depth: part.depth, sourceText: clip(sentence), persisted: false, bleeding: part.bleeding, suppuration: part.suppuration, evidence: clip(sentence, 400), origin: "reglas",
          });
        }
        continue;
      }
      const reading = perioReading(sentence);
      if (/(?<!\p{L})(?:sondaje|sondeo)(?:\s+de)?\s+\d{1,2}[.,]\d+\s*(?:mm|mil[ií]metros)/iu.test(sentence)) clarifications.push("El sondaje con decimal no se anota. Usa milímetros enteros.");
      else if (!reading.mention && /(?<!\p{L})(?:generalizad\p{L}*|en\s+general|en\s+toda\s+la\s+boca|boca\s+completa|todas\s+las\s+piezas|localizad\p{L}*)(?!\p{L})/iu.test(sentence)) {
        // «Sangrado al sondaje generalizado» es una nota periodontal, no un registro por pieza: queda en la evolución.
      } else if (!reading.mention) { if (!/(?<!\p{L})(?:sextantes?|generaliz\p{L}*|toda\s+la\s+boca|todas\s+las\s+piezas)(?!\p{L})/iu.test(sentence)) clarifications.push(`Sondaje sin una pieza identificada: «${clip(sentence)}». ¿En qué pieza?`); }
      else if (reading.depth !== null && reading.depth > 15) clarifications.push(`Sondaje fuera de 0 a 15 mm: «${clip(sentence)}».`);
      else if (reading.depth === null && !reading.bleeding && !reading.suppuration) clarifications.push(`Sondaje sin milímetros enteros: «${clip(sentence)}». No se anota.`);
      else if (reading.depth === null || !reading.site) {
        perioPending.push({ id: nextId("pen"), tooth: reading.mention.tooth, numberingLabel: reading.mention.numberingLabel, site: reading.site, depth: reading.depth, bleeding: reading.bleeding, suppuration: reading.suppuration, evidence: clip(sentence, 400), origin: "reglas" });
      } else {
        perio.push({
          id: nextId("per"),
          tooth: reading.mention.tooth,
          numberingLabel: reading.mention.numberingLabel,
          site: reading.site,
          siteLabel: SITE_LABEL[reading.site],
          depth: reading.depth,
          sourceText: clip(sentence),
          persisted: false,
          bleeding: reading.bleeding,
          suppuration: reading.suppuration,
          evidence: clip(sentence, 400),
          origin: "reglas",
        });
      }
      continue;
    }

    if (isPaymentText(sentence) && !isFuturePayment(sentence)) {
      const concept = paymentConcept(sentence);
      const details = paymentAmountDetails(sentence, paymentContextAmounts(sentence, transcript));
      if (details) payments.push({
        id: nextId("pag"),
        amount: details.amount,
        method: paymentMethodFrom(sentence),
        concept,
        evidence: clip(sentence, 400),
        origin: "reglas",
        ...(details.baseAmount ? { baseAmount: details.baseAmount, percentage: details.percentage } : {}),
      });
      else clarifications.push(`Pago sin monto base inequívoco: «${clip(sentence)}». ¿Cuál es el monto total al que corresponde el abono?`);
      const isBudget = isNewBudgetQuote(sentence);
      if (isBudget) {
        const budgetAmount = parseAmount(sentence) ?? spokenAmounts(sentence)[0]?.value ?? null;
        const label = budgetLabel(sentence);
        if (budgetAmount) budget.push({ id: nextId("pre"), title: "Presupuesto dictado", label, amount: budgetAmount, sourceText: clip(sentence) });
        else {
          budget.push({ id: nextId("pre"), title: "Presupuesto dictado", label, amount: 0, sourceText: clip(sentence) });
          clarifications.push(`Falta el monto en pesos de «${label}». Complétalo antes de guardar.`);
        }
      }
      continue;
    }
    if (isAppointmentText(sentence)) {
      const appointment = appointmentFrom(sentence, today, nextId("cit"), "reglas");
      // «Hasta la próxima sesión» es una despedida: sin fecha ni hora no hay cita que crear ni que preguntar.
      if (!appointment.day && !appointment.time && /\bhasta\s+(?:la\s+)?pr[oó]xim[ao]\b/iu.test(sentence)) continue;
      appointments.push(appointment);
      continue;
    }

    const isBudget = /\b(?:presupuesto|presupuesta|cotizaci[oó]n|honorarios)\b/i.test(sentence);
    // Un monto hablado también es de presupuesto si la frase es del plan o dice «pesos»/«lucas» (sin la palabra «presupuesto»).
    const priced = isBudget || isPlan(sentence) || inPlanContext(allSentences, sentenceIndex) || /(?<!\p{L})(?:pesos|lucas?|lukas?)(?!\p{L})/iu.test(sentence);
    const amount = parseAmount(sentence) ?? (priced ? spokenAmounts(sentence)[0]?.value ?? null : null);
    if (amount) {
      budget.push({ id: nextId("pre"), title: "Presupuesto dictado", label: budgetLabel(sentence), amount, sourceText: clip(sentence) });
    } else if (/\b(?:presupuesto|cotizaci[oó]n|honorarios)\b/i.test(sentence)) {
      const label = budgetLabel(sentence);
      budget.push({ id: nextId("pre"), title: "Presupuesto dictado", label, amount: 0, sourceText: clip(sentence) });
      clarifications.push(`Falta el monto en pesos de «${label}». Complétalo antes de guardar.`);
    }

    if (isPatient(sentence)) {
      if (/(?:^|\P{L})(?:caries|ausente|implante|obturaci\p{L}*|corona|extraj\p{L}*|extra[ií]d\p{L}*|exodoncia)(?!\p{L})/iu.test(sentence)) {
        clarifications.push(`Relato, no hallazgo confirmado: «${clip(sentence)}».`);
      }
      continue;
    }
    if ((isPlan(sentence) || inPlanContext(allSentences, sentenceIndex)) && !isPerformed(sentence) && !EXTRACTION_INDICATED.test(sentence)) {
      if (isPlanStrict(sentence) && /\b(?:implante|corona|exodoncia|caries|obturaci)\b/i.test(sentence)) {
        clarifications.push(`Plan o presupuesto, sin cambio de odontograma: «${clip(sentence)}».`);
      }
      continue;
    }
    if (isNegatedFinding(sentence) && !/\b(?:sana|sano|sin\s+lesi[oó]n)\b/i.test(sentence)) {
      clarifications.push(`Hallazgo negado, sin cambio de odontograma: «${clip(sentence)}».`);
      continue;
    }
    if (/\bresto\s+radicular\b/i.test(sentence) && !/\bendodoncia\b/i.test(sentence) && !EXTRACTION_DONE.test(sentence)) {
      clarifications.push("Hay un resto radicular sin decir si tiene endodoncia. No se cambió el estado general.");
    }

    if (/(?<!\p{L})(?:exodoncia|extracci[oó]n)\s+(?:de|del)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:pieza|diente|molar|premolar|incisivo|canino|muela|cordal|\d)/iu.test(sentence)
      && !EXTRACTION_DONE.test(sentence) && !EXTRACTION_INDICATED.test(sentence)
      && !/(?<!\p{L})(?:planific\p{L}*|se\s+indic\p{L}*|se\s+plante\p{L}*|program\p{L}*|agend\p{L}*|pr[oó]xim\p{L}*|requiere|necesita|futur\p{L}*)(?!\p{L})/iu.test(sentence)) {
      clarifications.push(`¿La exodoncia ya se realizó o solo está indicada? No se cambió el estado de la pieza: «${clip(sentence)}».`);
    }

    let mentions = toothMentions(sentence);
    // «ausencia de la 2.5 y la 2.6, pilares la 2.4 y la 2.7»: solo las dos primeras faltan.
    const absence = /(?<!\p{L})ausencia\s+(?:de(?:l|\s+la|\s+las)?\s+)/iu.exec(sentence);
    if (absence && !/(?<!\p{L})ausentes?(?!\p{L})/iu.test(sentence)) {
      const tail = sentence.slice(absence.index).split(/(?<!\p{L})(?:pilar(?:es)?|soport\p{L}*|apoyad\p{L}*|(?:y\s+)?se\s+planifica)(?!\p{L})/iu)[0];
      mentions = toothMentions(tail);
    }
    const scope = surfaceScope(sentence);
    const onImplant = crownOnImplantSentence(sentence);
    const status = isPaymentText(sentence) ? null : statusFrom(sentence);
    const surfaceResult = onImplant || status === "Ausente" || status === "Implante" ? null : findingFrom(scope);
    if (!mentions.length && (status || surfaceResult)) {
      // Dictado conversacional: la pieza puede estar en la frase anterior o en la siguiente.
      // Solo se hereda si el entorno apunta a una única pieza válida; si no, se pregunta.
      // En una charla clínica lo que se hace sigue a lo que se acaba de nombrar: se usa la frase anterior
      // más cercana que nombre pieza (hasta tres atrás) y, solo si no hay ninguna, la siguiente.
      const previous = allSentences.slice(Math.max(0, sentenceIndex - 3), sentenceIndex).reverse().map((other) => toothMentions(other)).find((found) => found.length > 0);
      const following = allSentences.slice(sentenceIndex + 1, sentenceIndex + 3).flatMap((other) => toothMentions(other));
      const near = previous ?? following;
      const distinct = new Map(near.filter((m) => m.ok).map((m) => [m.tooth, m]));
      if (distinct.size === 1 && near.every((m) => m.ok)) mentions = [...distinct.values()];
    }
    if (!mentions.length && (status || surfaceResult)) {
      clarifications.push(`Falta una pieza identificable en: «${clip(sentence)}».`);
      continue;
    }
    for (const mention of mentions) {
      if (!mention.ok) {
        clarifications.push(mention.reason);
        continue;
      }
      if (onImplant || status) {
        const base = {
          tooth: mention.tooth,
          numbering: mention.numbering,
          numberingLabel: mention.numberingLabel,
          sourceText: clip(sentence, 400),
          evidence: clip(sentence, 400),
          origin: "reglas" as const,
        };
        const items: OdontogramChange[] = onImplant
          ? [
              { ...base, id: nextId("odo"), kind: "status", status: "Implante" },
              { ...base, id: nextId("odo"), kind: "crown", status: "Corona", foundation: "implant", material: materialFrom(sentence), shade: shadeFrom(sentence) },
            ]
          : [{
              ...base,
              id: nextId("odo"),
              kind: status === "Corona" ? "crown" : "status",
              status: status ?? "Sin hallazgos",
              ...(status === "Corona" ? { foundation: "tooth" as const, material: materialFrom(sentence), shade: shadeFrom(sentence) } : {}),
              ...((status === "Ausente" || status === "Indicación de exodoncia") && missingReasonFrom(sentence) ? { missingReason: missingReasonFrom(sentence) } : {}),
            }];
        for (const item of items) {
          const key = dedupeKey(item);
          if (!seen.has(key)) {
            seen.add(key);
            odontogram.push(item);
          }
        }
        continue;
      }
      if (!surfaceResult) continue;
      if ("error" in surfaceResult) {
        clarifications.push(surfaceResult.error);
        if (surfaceResult.partial) {
          for (const surface of resolveDictatedSurfaces(scope, mention.tooth).surfaces) {
            incomplete.push({
              id: nextId("inc"),
              tooth: mention.tooth,
              numbering: mention.numbering,
              numberingLabel: mention.numberingLabel,
              sourceText: clip(sentence, 400),
              evidence: clip(sentence, 400),
              origin: "reglas",
              kind: "surface",
              surface,
              finding: surfaceResult.partial,
            });
          }
        }
        continue;
      }
      let resolved = resolveDictatedSurfaces(scope, mention.tooth);
      // «Caries profunda en oclusal de la 3.7. Se restaura con resina compuesta.»: la restauración sin cara va en la cara recién dictada.
      if (!resolved.surfaces.length && !resolved.notes.length && surfaceResult.finding.condition === "restored") {
        for (const other of allSentences.slice(Math.max(0, sentenceIndex - 2), sentenceIndex).reverse()) {
          if (!toothMentions(other).some((found) => found.ok && found.tooth === mention.tooth)) continue;
          const inherited = resolveDictatedSurfaces(surfaceScope(other), mention.tooth).surfaces;
          if (inherited.length) { resolved = { ...resolved, surfaces: inherited }; break; }
        }
      }
      for (const note of resolved.notes) clarifications.push(note);
      if (!resolved.surfaces.length) {
        // «pieza 1.6 sin caries» sin cara: queda en la nota, no cambia el odontograma ni pregunta la cara.
        if (surfaceResult.finding.condition === "sound" && /\b(?:sin|no)\s+(?:se\s+observa\s+)?caries\b/i.test(sentence)) continue;
        if (!resolved.notes.length) clarifications.push(`Falta la superficie del hallazgo: «${clip(sentence)}».`);
        continue;
      }
      if (surfaceResult.depthNote !== undefined && !/^aclaraci[oó]n:/iu.test(sentence)) clarifications.push(depthQuestion(`FDI ${formatFdi(mention.tooth)}`, surfaceResult.depthNote || undefined, sentence));
      for (const surface of resolved.surfaces) {
        // Una «Aclaración:» con la profundidad completa la caries ya propuesta en vez de duplicarla.
        const earlier = surfaceResult.finding.condition === "caries"
          ? odontogram.find((done) => done.kind === "surface" && done.tooth === mention.tooth && done.surface === surface && done.finding?.condition === "caries")
          : undefined;
        if (earlier?.finding) {
          const next = surfaceResult.finding;
          earlier.finding = { ...earlier.finding, depth: next.depth ?? earlier.finding.depth ?? null, activity: next.activity ?? earlier.finding.activity ?? null, icdas: next.icdas ?? earlier.finding.icdas ?? null };
          continue;
        }
        const item: OdontogramChange = {
          id: nextId("odo"),
          tooth: mention.tooth,
          numbering: mention.numbering,
          numberingLabel: mention.numberingLabel,
          sourceText: clip(sentence, 400),
          evidence: clip(sentence, 400),
          origin: "reglas",
          kind: "surface",
          surface,
          finding: surfaceResult.finding,
        };
        const key = dedupeKey(item);
        if (!seen.has(key)) {
          seen.add(key);
          odontogram.push(item);
        }
      }
    }
  }

  // Una caries completada después con «Aclaración:» deja de estar incompleta y deja de preguntarse.
  const completed = (item: OdontogramChange) => odontogram.some((done) => done.kind === "surface" && done.tooth === item.tooth && done.surface === item.surface);
  const solved = new Set(incomplete.filter(completed).map((item) => normalizeEvidence(item.sourceText)));
  const openIncomplete = incomplete.filter((item) => !completed(item));
  const openClarifications = clarifications.filter((note) => {
    const quoted = note.match(/«([^»]+)»/)?.[1];
    return !(quoted && /caries/i.test(note) && solved.has(normalizeEvidence(quoted.replace(/…$/, ""))));
  });
  const validated = validateProposal({ evolution: null, odontogram, budget, perio, clarifications: tidyClarifications([...openClarifications, ...numberingDoubts(transcript)], odontogram) });
  const routed = finishRouting({
    ...validated,
    incomplete: openIncomplete,
    ficha,
    procedures: [],
    transcript: transcript.trim(),
    perioPending,
    mobility,
    payments,
    appointments,
  });
  return { ...routed, evolution: composeEvolution(transcript, routed.odontogram, routed.clarifications, ficha) };
}

// ---------------------------------------------------------------------------
// Rutas nuevas: periodontograma, pagos y próxima cita.
// ---------------------------------------------------------------------------

function mobilityGrade(sentence: string): MobilityChange["grade"] | null {
  const match = fold(sentence).match(/\bmovilidad\s+(?:dentaria\s+)?(?:(?:de\s+)?grado\s+)?(0|1|2|3|i{1,3}|cero|uno|dos|tres)\b/);
  if (!match) return null;
  const map: Record<string, MobilityChange["grade"]> = { "0": "0", cero: "0", "1": "I", i: "I", uno: "I", "2": "II", ii: "II", dos: "II", "3": "III", iii: "III", tres: "III" };
  return map[match[1]] ?? null;
}

/** Lecturas completas (sitio + milímetros) dentro de una misma frase de sondaje; sirve solo si hay dos o más. */
function perioFragments(sentence: string) {
  const mention = toothMentions(sentence).find((item): item is Extract<Mention, { ok: true }> => item.ok);
  if (!mention) return [];
  const out: Array<{ mention: typeof mention; site: PerioSite; depth: number; bleeding: boolean; suppuration: boolean }> = [];
  for (const part of sentence.split(/\s*[,;]\s*|\s+y\s+/iu)) {
    const reading = perioReading(part);
    // «…, vestibular 3, distovestibular 5 con supuración»: el sitio ya fijó la unidad en el primer fragmento.
    if (reading.depth === null && reading.site && !toothMentions(part).length) {
      const bare = fold(part).match(/(?<![\d.,])(\d{1,2})(?![\d.,]?\d)/);
      if (bare && Number(bare[1]) <= 15 && out.length) reading.depth = Number(bare[1]);
    }
    if (reading.depth === null && !reading.site) continue; // encabezado («Sondaje en la pieza 3.6»)
    if (reading.depth === null || !reading.site || reading.depth > 15) return [];
    if (out.some((item) => item.site === reading.site)) return [];
    out.push({ mention, site: reading.site, depth: reading.depth, bleeding: reading.bleeding, suppuration: reading.suppuration });
  }
  return out;
}

function perioReading(sentence: string) {
  const folded = fold(sentence);
  const mention = toothMentions(sentence).find((item): item is Extract<Mention, { ok: true }> => item.ok) ?? null;
  return {
    mention,
    depth: depthFrom(sentence),
    site: perioSite(folded),
    bleeding: /\b(?:sangra\w*|sangrado|hemorragia)\b/.test(folded) && !/\b(?:sin|no)\s+(?:hay\s+)?(?:sangra\w*|sangrado)\b/.test(folded),
    suppuration: /\b(?:supura\w*|pus)\b/.test(folded) && !/\b(?:sin|no)\s+(?:hay\s+)?(?:supura\w*|pus)\b/.test(folded),
  };
}

function paymentConcept(sentence: string): string {
  const termPattern = /\b(?:implante|exodoncia|endodoncia|destartraje|detartraje|corona|pr[oó]tesis|obturaci\p{L}*|resina|carilla|ortodoncia|limpieza|blanqueamiento|pulido coronario|tratamiento periodontal|tratamiento restaurador|cirug[ií]a bucal|cirug[ií]a oral|injerto [oó]seo|membrana|sutura|consulta|control|urgencia)\b/giu;
  const terms = [...sentence.matchAll(termPattern)];
  const cueAt = fold(sentence).search(/\b(?:abona|abono|paga|pago|pagado|deja|dejan|dejo|cancela|cancelo)\b/);
  const prior = cueAt >= 0 ? terms.filter((match) => (match.index ?? -1) <= cueAt) : terms;
  const match = prior[prior.length - 1] ?? terms[0];
  return match ? capitalize(match[0]) : "";
}

function isNewBudgetQuote(sentence: string): boolean {
  return /\b(?:presupuesto\s+(?:de|del|para)|cotizaci[oó]n\s+(?:de|del|para)|se\s+(?:presupuesta|cotiza)|(?:precio|valor|costo)\s+(?:total\s+)?(?:de|del))\b/i.test(sentence);
}

function paymentContextAmounts(evidence: string, transcript: string): number[] {
  const conceptTokens = normalizeEvidence(paymentConcept(evidence)).split(" ").filter((word) => word.length > 3);
  const rows = sentences(transcript).map((text) => ({
    normalized: normalizeEvidence(text),
    amounts: spokenAmounts(text).map((item) => item.value),
  })).filter((row) => row.amounts.length > 0);
  const priceCue = /\b(?:presupuesto|cotizaci[oó]n|honorarios?|costo|precio|valor|vale|cuesta|sale|total|importe)\b/;
  const related = conceptTokens.length
    ? rows.filter((row) => priceCue.test(row.normalized) && conceptTokens.some((token) => row.normalized.includes(token)))
    : [];
  const relatedValues = [...new Set(related.flatMap((row) => row.amounts))];
  if (relatedValues.length) return relatedValues;
  const priced = rows.filter((row) => priceCue.test(row.normalized));
  return [...new Set(priced.flatMap((row) => row.amounts))];
}

function paymentBudgetMatch(payment: PaymentChange, budgets: BudgetChange[]): BudgetChange | undefined {
  let candidates = budgets.filter((budget) => budget.amount > 0);
  if (payment.baseAmount) candidates = candidates.filter((budget) => budget.amount === payment.baseAmount);
  const conceptTokens = normalizeEvidence(payment.concept).split(" ").filter((word) => word.length > 3);
  if (conceptTokens.length) {
    const matches = candidates.filter((budget) => {
      const haystack = normalizeEvidence([budget.title, budget.label, budget.evidence ?? "", budget.sourceText].join(" "));
      return conceptTokens.some((token) => haystack.includes(token));
    });
    if (matches.length) candidates = matches;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function appointmentFrom(sentence: string, today: string, id: string, origin: ItemOrigin): AppointmentChange {
  const date = resolveSpokenDate(sentence, today);
  const time = resolveSpokenTime(sentence);
  const reasonMatch = sentence.match(/(?<!\p{L})(?:para|a)\s+((?:control|evaluaci\p{L}*|endodoncia|obturaci\p{L}*|resina|corona|limpieza|destartraje|exodoncia|implante|cementaci\p{L}*|retiro|sesi[oó]n|continuar|terminar|pr[oó]tesis|blanqueamiento|ajuste|tratamiento|radiograf\p{L}*|toma)[^,.;]*)/iu);
  const reason = reasonMatch ? capitalize(clip(reasonMatch[1].trim(), 120)) : "Control";
  return {
    id,
    day: date?.date ?? null,
    time: time?.time ?? null,
    reason,
    said: [date?.said, time?.said].filter(Boolean).join(" ") || "",
    evidence: clip(sentence, 400),
    origin,
    ...(date?.note ? { note: date.note } : date?.doubt ? { note: date.doubt } : {}),
    ...(time?.doubt ? { timeDoubt: time.doubt } : {}),
  };
}

/** Preguntas que salen de lo que falta. Se recalculan cada vez, por eso llevan un prefijo propio. */
/** La profundidad de caries es opcional: se pregunta en la revisión, pero no queda como pendiente en la nota. */
const DEPTH_QUESTION = /^(?:IA:\s*)?FDI \d\.\d: [^«]*¿profundidad de la caries/;
const ROUTING_QUESTION = /^(?:¿Con qué medio se pagaron|¿Qué día es la próxima cita|¿A qué hora es la cita|¿En qué sitio se midió|¿Cuántos mm midió|Confirma la hora de la cita)/;

const money = (amount: number) => `$${amount.toLocaleString("es-CL").replace(/,/g, ".")}`;

function originUnion(a: ItemOrigin, b: ItemOrigin): ItemOrigin {
  return a === b ? a : "ia+reglas";
}

/** Une repetidos (lo dictado + la aclaración, o IA + reglas) y genera las preguntas de lo que falta. */
/** Vincula con el catálogo las prestaciones del presupuesto dictado; sin coincidencia clara no se toca. */
const ORDINAL_WORD: Record<string, number> = { uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };

/** Fase y opción del plan en que se dictó una prestación: la última mención («fase dos», «opción B») hasta su frase. */
export function budgetContext(transcript: string | string[], evidence: string): { phase?: string; option?: string } {
  // La cita puede venir del texto corregido o del dictado original: se busca en ambos, por el inicio y por el final.
  let upto = evidence;
  const clean = evidence.trim().toLowerCase();
  search: for (const text of Array.isArray(transcript) ? transcript : [transcript]) {
    const lower = (text ?? "").toLowerCase();
    for (const probe of [clean.slice(0, 40), clean.slice(-30)]) {
      const at = probe.length >= 8 ? lower.indexOf(probe) : -1;
      if (at >= 0) { upto = (text ?? "").slice(0, at + (probe === clean.slice(-30) ? probe.length : evidence.length)); break search; }
    }
  }
  const out: { phase?: string; option?: string } = {};
  const phase = [...upto.matchAll(/(?<!\p{L})(?:fase|etapa)\s+(\d+|uno|una|dos|tres|cuatro|cinco)(?!\p{L})/giu)].pop();
  if (phase) {
    const number = /^\d+$/.test(phase[1]) ? Number(phase[1]) : ORDINAL_WORD[phase[1].toLowerCase()];
    if (number >= 1 && number <= 9) out.phase = `Fase ${number}`;
  }
  const option = [...upto.matchAll(/(?<!\p{L})opci[oó]n\s+([abc]|be|bé|ce|cé|\d|uno|una|dos|tres)(?!\p{L})/giu)].pop();
  if (option) {
    const raw = option[1].toLowerCase();
    const index = /^\d$/.test(raw) ? Number(raw) : raw in ORDINAL_WORD ? ORDINAL_WORD[raw] : raw.charCodeAt(0) - 96; // «be» y «ce»: la primera letra
    if (index >= 1 && index <= 3) out.option = String.fromCharCode(64 + index);
  }
  return out;
}

function withCatalogCodes(proposal: DictationProposal): DictationProposal {
  return {
    ...proposal,
    budget: proposal.budget.map((item) => {
      const context = budgetContext([proposal.corrected?.text ?? "", proposal.transcript ?? ""], item.evidence || item.sourceText || "");
      const withContext = { ...item, ...(item.phase ? {} : context.phase ? { phase: context.phase } : {}), ...(item.option ? {} : context.option ? { option: context.option } : {}) };
      if (withContext.catalogCode) return withContext;
      const found = matchPrestacion(withContext.label);
      return found ? { ...withContext, catalogCode: found.code } : withContext;
    }),
  };
}

export function finishRouting(proposal: DictationProposal): DictationProposal {
  const payments: PaymentChange[] = [];
  for (const item of proposal.payments ?? []) {
    const itemEvidence = normalizeEvidence(item.evidence);
    const same = payments.find((done) => {
      if (done.amount !== item.amount) return false;
      const doneEvidence = normalizeEvidence(done.evidence);
      if (doneEvidence === itemEvidence) return true;
      const [shorter, longer] = doneEvidence.length <= itemEvidence.length
        ? [doneEvidence, itemEvidence]
        : [itemEvidence, doneEvidence];
      return shorter.length >= 12 && longer.includes(shorter);
    });
    if (!same) { payments.push({ ...item }); continue; }
    same.origin = originUnion(same.origin, item.origin);
    if (!same.method && item.method) same.method = item.method;
    if (!same.concept && item.concept) same.concept = item.concept;
    if (!same.baseAmount && item.baseAmount) same.baseAmount = item.baseAmount;
    if (!same.percentage && item.percentage) same.percentage = item.percentage;
  }
  let appointments: AppointmentChange[] = [];
  for (const item of proposal.appointments ?? []) {
    const same = appointments.find((done) => (item.day && done.day === item.day) || (!item.day && !done.day));
    if (!same) { appointments.push({ ...item }); continue; }
    same.origin = originUnion(same.origin, item.origin);
    // Una hora dicha sin dudas gana a una hora supuesta.
    if (item.time && (!same.time || (same.timeDoubt && !item.timeDoubt))) { same.time = item.time; same.timeDoubt = item.timeDoubt; }
    if (same.reason === "Control" && item.reason !== "Control") same.reason = item.reason;
  }
  if (appointments.some((item) => item.day)) appointments = appointments.filter((item) => item.day);
  // Una cita para el mismo día dicha dos veces (dictado + aclaración) queda una sola.
  const perio: PerioStub[] = [];
  for (const item of proposal.perio) {
    const same = perio.find((done) => done.tooth === item.tooth && done.site === item.site);
    if (!same) { perio.push({ ...item }); continue; }
    if (same.depth !== item.depth && item.origin === "reglas" && same.origin !== "reglas") continue;
    same.bleeding = same.bleeding || item.bleeding;
    same.suppuration = same.suppuration || item.suppuration;
    if (same.origin && item.origin) same.origin = originUnion(same.origin, item.origin);
  }
  const pending: PerioPending[] = [];
  for (const item of proposal.perioPending ?? []) {
    const done = perio.some((reading) => reading.tooth === item.tooth && (item.depth === null || reading.depth === item.depth) && (!item.site || reading.site === item.site));
    if (done || pending.some((other) => other.tooth === item.tooth && other.depth === item.depth && other.site === item.site)) continue;
    pending.push({ ...item });
  }
  const mobility: MobilityChange[] = [];
  for (const item of proposal.mobility ?? []) {
    const same = mobility.find((done) => done.tooth === item.tooth);
    if (same) { if (same.grade === item.grade) same.origin = originUnion(same.origin, item.origin); continue; }
    mobility.push({ ...item });
  }

  const questions: string[] = [];
  for (const item of payments) {
    if (!item.method) questions.push(`¿Con qué medio se pagaron ${money(item.amount)} (efectivo, débito, crédito o transferencia)? «${clip(item.evidence)}»`);
  }
  for (const item of appointments) {
    if (!item.day) questions.push(`¿Qué día es la próxima cita? «${clip(item.evidence)}»`);
    else if (!item.time) questions.push(`¿A qué hora es la cita del ${describeDate(item.day)}? «${clip(item.evidence)}»`);
    else if (item.timeDoubt) questions.push(`Confirma la hora de la cita: ${item.timeDoubt} «${clip(item.evidence)}»`);
  }
  for (const item of pending) {
    const label = `FDI ${formatFdi(item.tooth)}`;
    if (item.depth === null) questions.push(`¿Cuántos mm midió el sondaje en ${label}? «${clip(item.evidence)}»`);
    else questions.push(`¿En qué sitio se midió el sondaje de ${item.depth} mm en ${label} (mesial, distal o central; vestibular o palatino/lingual)? «${clip(item.evidence)}»`);
  }
  const kept = proposal.clarifications.filter((note) => !ROUTING_QUESTION.test(note));
  const linkedPayments = payments.map((item) => {
    const budget = paymentBudgetMatch(item, proposal.budget);
    return budget ? { ...item, budgetRef: budget.id } : item;
  });
  return withCatalogCodes({
    ...proposal,
    perio,
    perioPending: pending,
    mobility,
    payments: linkedPayments,
    appointments,
    clarifications: [...new Set([...kept, ...questions])],
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? clip(value, max) : "";
}

function coerceFinding(value: unknown): SurfaceFinding | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Hallazgo de superficie incompleto." };
  const record = value as Record<string, unknown>;
  const condition = text(record.condition, 32);
  if (!["not_examined", "sound", "caries", "restored", "sealant", "other_restoration"].includes(condition)) {
    return { error: "Estado de superficie no reconocido." };
  }
  if (condition !== "caries") return { condition: condition as SurfaceFinding["condition"], depth: null, icdas: null, activity: null };
  // Profundidad opcional; ICDAS y actividad solo si venían de un registro anterior válido.
  const depth = isCariesDepth(record.depth) ? record.depth : null;
  const icdas = Number(record.icdas);
  const activity = text(record.activity, 16);
  return {
    condition: "caries",
    depth,
    icdas: (Number.isInteger(icdas) && icdas >= 1 && icdas <= 6 ? icdas : null) as SurfaceFinding["icdas"],
    activity: (["active", "inactive", "uncertain"].includes(activity) ? activity : null) as SurfaceFinding["activity"],
  };
}

function coerceOdontogram(value: unknown): OdontogramChange | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Un cambio de odontograma no tiene forma válida." };
  const record = value as Record<string, unknown>;
  const tooth = Number(record.tooth);
  if (!isValidFdi(tooth)) return { error: `La pieza ${String(record.tooth)} no es un FDI válido y se dejó fuera.` };
  const numbering: ToothNumbering | null = record.numbering === "FDI" || record.numbering === "chilena" || record.numbering === "universal" ? record.numbering : null;
  if (!numbering) {
    return { error: `Falta el sistema de numeración de FDI ${formatFdi(tooth)}. No se marcó la pieza.` };
  }
  const kind = record.kind === "crown" || record.kind === "surface" || record.kind === "status" ? record.kind : null;
  if (!kind) return { error: `Tipo de cambio no reconocido en FDI ${formatFdi(tooth)}.` };
  const base = {
    id: "odo",
    tooth,
    numbering,
    numberingLabel: text(record.numberingLabel, 80) || (numbering === "FDI" ? `FDI ${formatFdi(tooth)}` : numbering),
    sourceText: text(record.sourceText, 400),
    ...(typeof record.evidence === "string" && record.evidence.trim() ? { evidence: clip(record.evidence, 400) } : {}),
    ...(record.origin === "ia" || record.origin === "reglas" || record.origin === "ia+reglas" ? { origin: record.origin as ItemOrigin } : {}),
    ...(record.conflict === true ? { conflict: true } : {}),
  };
  if (kind === "surface") {
    const surface = record.surface;
    if (surface !== "V" && surface !== "P" && surface !== "M" && surface !== "D" && surface !== "O") {
      return { error: `Superficie no reconocida en FDI ${formatFdi(tooth)}.` };
    }
    const finding = coerceFinding(record.finding);
    if ("error" in finding) return finding;
    return { ...base, kind, surface, finding };
  }
  const status = kind === "crown" ? "Corona" : text(record.status, 48);
  if (!TOOTH_STATUSES.includes(status as ToothStatus)) return { error: `Estado general no reconocido en FDI ${formatFdi(tooth)}.` };
  const item: OdontogramChange = { ...base, kind, status: status as ToothStatus };
  if (status === "Corona") {
    const material = text(record.material, 40);
    if (material) {
      if (!CROWN_MATERIALS.includes(material as CrownMaterial)) return { error: `Material de corona no reconocido en FDI ${formatFdi(tooth)}.` };
      item.material = material as CrownMaterial;
    }
    const shade = text(record.shade, 8);
    if (shade) {
      if (!/^[A-D][1-4](?:\.5)?$/i.test(shade)) return { error: `Color de corona no reconocido en FDI ${formatFdi(tooth)}.` };
      item.shade = shade.toUpperCase();
    }
  }
  if ((status === "Ausente" || status === "Indicación de exodoncia") && typeof record.missingReason === "string") {
    if (!["caries", "other", "unknown"].includes(record.missingReason)) return { error: "Causa de ausencia no reconocida." };
    item.missingReason = record.missingReason as OdontogramChange["missingReason"];
  }
  if ((status === "Corona" || status === "Implante") && (record.foundation === "implant" || record.foundation === "tooth")) item.foundation = record.foundation;
  return item;
}

export function validateProposal(input: unknown): DictationProposal {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("La propuesta no es un objeto JSON.");
  const record = input as Record<string, unknown>;
  const clarifications: string[] = [];
  if (Array.isArray(record.clarifications)) {
    for (const item of record.clarifications) {
      if (typeof item === "string" && item.trim()) clarifications.push(clip(item, 400));
    }
  }
  let evolution: DictationProposal["evolution"] = null;
  if (record.evolution && typeof record.evolution === "object" && !Array.isArray(record.evolution)) {
    const source = record.evolution as Record<string, unknown>;
    const body = typeof source.body === "string" ? source.body.trim().slice(0, 30000) : "";
    const title = text(source.title, 180) || "Evolución dictada";
    if (body) evolution = { title, body };
  }
  const odontogram: OdontogramChange[] = [];
  if (Array.isArray(record.odontogram)) {
    for (const raw of record.odontogram.slice(0, 64)) {
      const item = coerceOdontogram(raw);
      if ("error" in item) clarifications.push(item.error);
      else odontogram.push({ ...item, id: `odo-${odontogram.length + 1}` });
    }
  }
  const blocked = new Set(odontogram.filter((item) => item.kind !== "surface" && (item.status === "Implante" || item.status === "Implante con pilar" || item.status === "Ausente")).map((item) => item.tooth));
  const kept = odontogram.filter((item) => {
    if (item.kind === "surface" && blocked.has(item.tooth)) {
      clarifications.push(`No se propone superficie en FDI ${formatFdi(item.tooth)} porque el estado general es ${odontogram.find((status) => status.tooth === item.tooth && status.kind !== "surface")?.status}.`);
      return false;
    }
    return true;
  });
  const budget: BudgetChange[] = [];
  if (Array.isArray(record.budget)) {
    for (const raw of record.budget.slice(0, 12)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const source = raw as Record<string, unknown>;
      const amount = Number(typeof source.amount === "string" ? source.amount.replace(/\./g, "") : source.amount);
      const label = text(source.label, 180);
      if (!label || !Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
        clarifications.push("Una prestación del presupuesto no tiene monto válido y se omitió.");
        continue;
      }
      budget.push({
        id: `pre-${budget.length + 1}`,
        title: text(source.title, 180) || "Presupuesto dictado",
        label,
        amount,
        sourceText: text(source.sourceText, 400),
        ...(typeof source.evidence === "string" && source.evidence.trim() ? { evidence: clip(source.evidence, 400) } : {}),
        ...(source.origin === "ia" || source.origin === "reglas" || source.origin === "ia+reglas" ? { origin: source.origin as ItemOrigin } : {}),
      });
    }
  }
  const perio: PerioStub[] = [];
  if (Array.isArray(record.perio)) {
    for (const raw of record.perio.slice(0, 32)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const source = raw as Record<string, unknown>;
      const tooth = Number(source.tooth);
      const site = source.site;
      const depth = Number(source.depth);
      if (!isValidFdi(tooth) || (site !== "MV" && site !== "V" && site !== "DV" && site !== "ML" && site !== "L" && site !== "DL") || !Number.isInteger(depth) || depth < 0 || depth > 15) {
        clarifications.push("Un sondaje quedó incompleto y no se anota.");
        continue;
      }
      if (source.persisted === true) clarifications.push("El sondaje no se guarda en este prototipo.");
      perio.push({
        id: `per-${perio.length + 1}`,
        tooth,
        numberingLabel: text(source.numberingLabel, 80) || `FDI ${formatFdi(tooth)}`,
        site,
        siteLabel: text(source.siteLabel, 80) || SITE_LABEL[site],
        depth,
        sourceText: text(source.sourceText, 180),
        persisted: false,
        ...(typeof source.bleeding === "boolean" ? { bleeding: source.bleeding } : {}),
        ...(typeof source.suppuration === "boolean" ? { suppuration: source.suppuration } : {}),
        ...(typeof source.evidence === "string" && source.evidence.trim() ? { evidence: clip(source.evidence, 400) } : {}),
        ...(source.origin === "ia" || source.origin === "reglas" || source.origin === "ia+reglas" ? { origin: source.origin as ItemOrigin } : {}),
      });
    }
  }
  return { evolution, odontogram: kept.map((item, index) => ({ ...item, id: `odo-${index + 1}` })), budget, perio, clarifications: [...new Set(clarifications)] };
}

/**
 * Arreglos mínimos y seguros para JSON de modelos chicos: comillas tipográficas, comas finales,
 * saltos de línea dentro de cadenas y salida cortada (cierra cadenas y llaves abiertas).
 * No inventa contenido: si no queda un JSON válido, falla y se usa el siguiente modelo.
 */
export function repairModelJson(raw: string): string {
  let text = raw.replace(/[\u201C\u201D]/g, '"').replace(/^\uFEFF/, "");
  let out = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) { escaped = false; out += char; continue; }
      if (char === "\\") { escaped = true; out += char; continue; }
      if (char === '"') { inString = false; out += char; continue; }
      if (char === "\n") { out += "\\n"; continue; }
      if (char === "\r" || char === "\t") { out += " "; continue; }
      out += char;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") stack.pop();
    out += char;
  }
  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';
  // Salida cortada: quita un par clave/valor a medias y cierra lo abierto.
  if (stack.length) out = out.replace(/,\s*"[^"]*"\s*:?\s*$/, "").replace(/[,:]\s*$/, "");
  out += stack.reverse().join("");
  text = out.replace(/,(\s*[}\]])/g, "$1");
  return text;
}

export function parseModelJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("El modelo no devolvió JSON.");
  const end = raw.lastIndexOf("}");
  if (end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) as unknown; } catch { /* se intenta reparar abajo */ }
  }
  try {
    return JSON.parse(repairModelJson(raw.slice(start))) as unknown;
  } catch {
    throw new Error("El modelo devolvió JSON inválido.");
  }
}

const MODEL_ARRAY_FIELDS = ["hallazgos", "procedimientos", "presupuesto", "ficha", "periodonto", "pagos", "citas", "diagnosticos", "dudas"] as const;

/**
 * Valida la forma de la respuesta (los modelos chicos a veces devuelven otra cosa).
 * Completa con vacío lo que falte; si la forma no sirve, lanza error para pasar al siguiente modelo.
 */
export function validateModelOutput(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object" || Array.isArray(output)) throw new Error("JSON del modelo sin objeto principal.");
  const record = { ...(output as Record<string, unknown>) };
  const nota = record.nota;
  if (!nota || typeof nota !== "object" || Array.isArray(nota)) throw new Error("JSON del modelo sin «nota».");
  const sections: Record<string, string> = {};
  let filled = 0;
  for (const [key] of NOTE_SECTIONS) {
    const value = (nota as Record<string, unknown>)[key];
    if (value != null && typeof value !== "string") throw new Error(`JSON del modelo: «nota.${key}» no es texto.`);
    sections[key] = typeof value === "string" ? value : "";
    if (sections[key].trim()) filled += 1;
  }
  const corrected = record.texto_corregido;
  if (corrected != null && typeof corrected !== "string") throw new Error("JSON del modelo: «texto_corregido» no es texto.");
  if (!filled && !(typeof corrected === "string" && corrected.trim())) throw new Error("JSON del modelo vacío.");
  record.nota = sections;
  record.texto_corregido = typeof corrected === "string" ? corrected : "";
  for (const field of MODEL_ARRAY_FIELDS) {
    const value = record[field];
    if (value == null) { record[field] = []; continue; }
    if (!Array.isArray(value)) throw new Error(`JSON del modelo: «${field}» no es lista.`);
    record[field] = value.filter((item) => item !== null && (typeof item === "object" || typeof item === "string"));
  }
  return record;
}

export function modelOutputToJson(result: unknown): unknown {
  if (typeof result === "string") return parseModelJson(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Respuesta del modelo vacía.");
  const record = result as Record<string, unknown>;
  if ("nota" in record || "hallazgos" in record || "evolution" in record || "odontogram" in record) return result;
  if (typeof record.response === "string") return parseModelJson(record.response);
  if (record.response && typeof record.response === "object") return record.response;
  const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return parseModelJson(message.content);
  if (message?.content && typeof message.content === "object") return message.content;
  if (typeof choice?.text === "string") return parseModelJson(choice.text);
  throw new Error("Respuesta del modelo vacía.");
}

// ---------------------------------------------------------------------------
// Paso de IA: redacta la nota y extrae datos con cita literal. Todo lo que
// devuelve se contrasta con la transcripción antes de proponerlo.
// ---------------------------------------------------------------------------

export const NOTE_SECTIONS = [
  ["motivo", "Motivo de consulta"],
  ["anamnesis", "Anamnesis y antecedentes"],
  ["alergias", "Alergias"],
  ["medicamentos", "Medicamentos"],
  ["examen", "Examen"],
  ["diagnostico", "Diagnóstico"],
  ["procedimientos", "Procedimientos realizados"],
  ["plan", "Plan de tratamiento"],
  ["indicaciones", "Indicaciones"],
  ["presupuesto", "Presupuesto"],
] as const;

export const AI_SYSTEM_PROMPT = `${DENTAL_DICTIONARY_HINTS}\n\n${IDENTITY_NORMALIZATION_PROMPT}\n\n${TOOTH_NUMBERING_PROMPT}\n\n${CLINICAL_WRITING_PROMPT}\n\nEres asistente de un odontólogo chileno. Recibes la transcripción literal de un dictado por voz (puede venir sin puntuación y con errores de reconocimiento). Devuelves SOLO JSON con el esquema pedido.

1) "nota": redacta una evolución odontológica profesional, clara y concisa, en español clínico de Chile y en tercera persona. Esta es una RE-REDACCIÓN CLÍNICA, no una transcripción corregida palabra por palabra: transforma activamente el habla cotidiana, las abreviaciones y las expresiones coloquiales en lenguaje odontológico natural. La nota final no debe sonar a dictado ni conservar frases como «muela», «bien grande», «arreglarla», «capaz», «se ve» o «se va bien» cuando exista una formulación clínica inequívoca. Conserva todos los hechos, su temporalidad, negaciones y grado de certeza; profesionalizar la expresión no autoriza a inventar hallazgos ni diagnósticos.
Equivalencias de estilo: «le duele con frío» → «refiere dolor provocado por frío» (sin inferir diagnóstico pulpar); «muela 3.6» → «pieza 3.6» (sin cambiar su numeración); «compósito/composito» → «composite» y «restauración de composite» o «restauración de resina compuesta» (elige una sola forma; no las dupliques); «caries bien grande» → «lesión cariosa extensa»; «caries dentinaria superficial» → «lesión cariosa dentinaria superficial» (conserva esa profundidad; nunca la conviertas en «terminal superficial» ni agregues una cara no dictada); «parece profunda» → «aparentemente profunda» (sin afirmar compromiso pulpar); «arreglarla» → «realizar tratamiento restaurador» solo cuando ese plan se desprenda claramente del dictado; «capaz va a endodoncia» → «se considerará tratamiento endodóntico», manteniendo el carácter condicional; «se hace destartraje supra y subgingival en los seis grupos» → «Se realiza destartraje supragingival y subgingival en los seis grupos»; «se va bien» → «finaliza la atención en buenas condiciones» si eso es lo que expresa el contexto. Usa «se observa» en lugar de «se ve» cuando se trate de un hallazgo clínico.
Si la ubicación se expresa con palabras ambiguas como «por arriba», no la conviertas automáticamente en cara oclusal ni en otra superficie: redacta el hallazgo sin asignar una cara y pregunta en «dudas» si esa ubicación es clínicamente relevante.
Ejemplo de estilo para este tipo de dictado:
Dictado informal: «Paciente viene a control. Le duele con frío la muela 3.6. Se ve una caries bien grande por arriba y parece que está profunda. Se conversa que primero hay que arreglarla y ver si aguanta; si no, capaz va a endodoncia. Se hace destartraje supra y subgingival en los seis grupos. Paciente se va bien».
Redacción esperada: motivo = «Control. Refiere dolor provocado por frío en la pieza 3.6»; examen = «Se observa una lesión cariosa extensa en la pieza 3.6, aparentemente profunda»; procedimientos = «Se realiza destartraje supragingival y subgingival en los seis grupos»; plan = «Se plantea realizar tratamiento restaurador en la pieza 3.6 y evaluar su respuesta. Según la evaluación, se considerará tratamiento endodóntico»; evolución = «Paciente finaliza la atención en buenas condiciones»; duda = «¿Con “por arriba” se refiere a la cara oclusal?». No copies el dictado informal dentro de la nota. Las instrucciones orales de edición («aclaración», «rectifica», «corrige», «borra», «texto revisado») son metadiscurso: aplícalas a los datos clínicos y nunca las copies ni las describas en la evolución. Si el dictado contiene versiones repetidas o rectificaciones, redacta solo el dato final corregido y conserva los demás hechos clínicos no afectados. Antes de escribir, identifica todos los hechos clínicos explícitos y conserva cada uno en la sección correspondiente: los hallazgos observados en «examen», las acciones futuras en «plan» y los procedimientos ya realizados en «procedimientos». No omitas hallazgos, detalles ni razones clínicas por resumir; cada hecho relevante del dictado debe aparecer en la nota una sola vez, con redacción natural y fiel. Revisa al final que todas las observaciones y relaciones causales expresadas estén representadas y que ninguna se haya convertido en una inferencia. Cada procedimiento realizado hoy debe aparecer tanto en «nota.procedimientos» como en el arreglo raíz «procedimientos»; el arreglo raíz no sustituye su presencia en la evolución clínica. No hagas una transcripción literal ni escribas frases conversacionales («estamos viendo», «vamos a hacer»): conviértelas en redacción clínica natural («En la evaluación se observa…», «Se planifica…») solo cuando el dictado respalde esa acción. Ordena la información como motivo/anamnesis, examen objetivo, diagnóstico únicamente si fue dictado, procedimientos efectivamente realizados, plan e indicaciones. Usa terminología odontológica precisa y conserva el sentido y el grado de certeza; no inventes interpretaciones clínicas. Evita repeticiones, muletillas y encabezados vacíos. Ejemplo de estilo: «Se observa disminución de la altura sinusal en el sector posterior. Se planifica tratamiento con implantes en las posiciones indicadas y un cantiléver para evitar intervenir el seno maxilar. La cirugía aún no se ha realizado». Corrige puntuación y redacción, pero NO agregues nada que no se haya dicho: ni diagnósticos, ni piezas, ni caras, ni profundidades de caries, ni montos, ni medicamentos, ni negaciones. Si algo no se dijo, deja la sección como cadena vacía "". Conserva los números de pieza tal como se dictaron (si dijo «pieza 30», escribe «pieza 30»). Lo que el paciente cuenta (refiere, relata) va en motivo o anamnesis, nunca en examen. Si el profesional dicta un diagnóstico, va en diagnostico; si no, déjalo vacío. En la convención de esta consulta, periodontología se organiza en seis grupos numerados del 1 al 6: conserva exactamente «grupo 3», «los seis grupos» y «los seis restantes»; no los conviertas a piezas dentarias ni a otra nomenclatura. Si el dictado indica que ya se trató en los seis grupos y también que se tratará en «los seis restantes», marca la contradicción en «dudas» y no adivines qué quiso decir. En español clínico chileno, conserva «destartraje» si esa fue la palabra dictada; no la reemplaces automáticamente por «detartraje». En Endodoncia, diferencia síntomas referidos, resultados de pruebas, hallazgos radiográficos y diagnóstico; coloca el diagnóstico pulpar y el apical o periapical por separado solo si el odontólogo los nombra. No infieras diagnósticos por dolor, respuesta térmica, percusión, palpación o radiografía aislados. Conserva la diferencia entre pulpotomía y pulpectomía, instrumentación y obturación, tratamiento iniciado y realizado, y registra irrigantes, medicación intraconducto, técnica, material y longitud de trabajo solo si se dictaron. En Periodoncia, diferencia gingivitis, periodontitis y enfermedad periimplantaria; conserva profundidad de sondaje, nivel de inserción clínica, sangrado, recesión, furcación, movilidad, supuración y pérdida ósea como hallazgos explícitos. No deduzcas diagnóstico, extensión, estadio ni grado a partir de mediciones parciales. Conserva «grupo 1» a «grupo 6» según la nomenclatura de esta consulta; no los conviertas a sextantes ni a piezas dentales.

La nota debe ordenar las ideas en una secuencia lógica y eliminar muletillas, repeticiones y frases dirigidas al sistema. Conserva expresamente las negaciones y la temporalidad relevantes (por ejemplo, «la cirugía todavía no se ha realizado»); omitirlas cambia el sentido clínico. Explica relaciones causales solo si el profesional las expresó. Diferencia hallazgo, plan futuro y tratamiento realizado: «se planifica colocar implantes» no significa que ya estén instalados. Si el reconocimiento oyó «root» en un contexto explícito de identificación, entiende que se refiere al RUT, pero no reconstruyas un número de identidad dudoso ni lo agregues a la nota clínica. Cuando un término o número sea ambiguo, conserva lo dicho y plantea la duda; no rellenes vacíos con conocimiento general. La evolución clínica es el resultado principal del dictado: cuando haya atención clínica, conserva en la nota el diagnóstico explícitamente indicado y el tratamiento realizado o planificado, con redacción profesional. La falta de abono, medio de pago, presupuesto, cita o respuesta a una duda nunca debe suprimir ni retrasar la nota. Mantén preguntas y datos administrativos separados de la evolución; no inventes un diagnóstico para completar campos.

2) "hallazgos": un elemento por cada pieza y hallazgo de odontograma OBSERVADO HOY en el examen o realizado hoy. No incluyas lo que el paciente relata, lo planificado, presupuestado o negado.
- "pieza": el número tal como se dictó ("30", "3.6", "cuarenta y seis").
- "sistema": "chilena" si dijo pieza 1 a 32 sin etiqueta (p. ej. «pieza 30» = FDI 3.6) o dijo chilena/nacional; "FDI" si dijo FDI/ISO, con punto (2.6, «dos punto seis»), dos dígitos separados (tres seis) o un número sin etiqueta del 33 al 48 o del 51 al 85; "universal" si lo dijo; "sin_etiqueta" si es otro número sin sistema.
- "tipo": "superficie" para caries, obturación, sellante, otra restauración o cara sana; "estado" para Ausente, Implante, Corona, Indicación de exodoncia o Resto radicular con endodoncia.
- "condicion" (solo superficie): caries | obturacion | sellante | otra_restauracion | sana. "estado" (solo estado): Ausente | Implante | Corona | Indicación de exodoncia | Resto radicular con endodoncia. Deja "" lo que no aplique.
- "caras": letras M, O, D, V, P (O también es incisal; P es palatina o lingual) SOLO si se dictaron para ese hallazgo. MOD = M,O,D.
- "profundidad" (solo caries): "esmalte" (caries de esmalte, mancha blanca), "dentina_superficial" (dentina superficial o media), "dentina_profunda" (dentina profunda, caries profunda) o "pulpar" (compromiso pulpar, penetrante); "" si no se dijo. No uses ICDAS.
- «resina», «amalgama» o «ionómero» con una cara (p. ej. «pieza 1.1 resina vestibular») es una obturación existente: condicion "obturacion".
- «indica exodoncia», «exodoncia indicada» o «para exodoncia» de una pieza es el estado "Indicación de exodoncia" aunque sea una indicación. Otros planes («se indica endodoncia») no van en hallazgos.
- Lo negado («sin caries», «no hay caries») no va en hallazgos.
- Una fractura, fisura o cúspide fracturada NO es caries ni obturación: no la pongas en hallazgos; va en la nota (examen).
- "material" y "color" solo para corona, si se dijeron.
- "evidencia": copia EXACTA y continua de la transcripción (mismas palabras, sin corregir) que contenga el número de la pieza y el hallazgo. Si no puedes citar, no incluyas el hallazgo.

3) "procedimientos": lo realizado hoy, cada uno con "texto" y "evidencia" literal. En cirugía bucal, conserva exactamente la técnica, el material y la marca de sutura (por ejemplo, Vicryl / poliglactina 910, Monocryl, PDS, Prolene, nylon o seda), calibre, aguja, material hemostático, injerto, membrana, marca y dimensiones del implante, anestésico, concentración, cantidad de tubetes, dosis y duración de medicamentos, si fueron dictados. Corrige errores claros de reconocimiento y redacta profesionalmente, pero no sustituyas materiales ni completes dosis, calibres, marcas o técnicas por conocimiento general.
4) "presupuesto": prestaciones presupuestadas con "prestacion", el precio total de cada prestación en pesos (0 si no se dijo) y "evidencia" literal. No sustituyas el precio total por el pago, el abono ni el saldo.
5) "ficha": alergias, antecedentes médicos y medicamentos que toma el paciente, con "campo" (alergias | antecedentes | medicamentos), "texto" breve y "evidencia" literal. «Niega alergias» también se registra. Si una frase trae alergia y medicamento («alérgica a la penicilina toma losartán»), son dos elementos separados.
6) "texto_corregido": la misma transcripción con SOLO errores de reconocimiento de voz corregidos (palabras mal oídas: «mecial» → «mesial», «caris» → «caries», «periodo de autograma» → «periodontograma», «de estar traje» → «destartraje», «sub gingival» → «subgingival», «supra gingival» → «supragingival» y «root» → «RUT» solo cuando se pregunta por el RUN/RUT) y números dictados en palabras pasados a cifras («dos cuatro» → «2.4», «cuatro milímetros» → «4 mm», «cincuenta mil» → «50.000»; en implantes: «Flappers» → «flapless», medida «33 × 8» → «3,3 × 8 mm» con coma decimal). En un RUN/RUT explícitamente identificado, escribe cuerpo y dígito verificador en cifras, con puntos de miles y guion, solo si se pueden interpretar sin ambigüedad; para fecha de nacimiento explícita, usa DD/MM/AAAA y acepta números dichos en palabras. Una marca de implante dudosa («Arcis», ¿Arcsys?) no la cambies: pregúntala en dudas. Mantén el orden y las demás palabras; no resumas, no agregues datos, no cambies piezas, caras, cifras, negaciones ni términos clínicos correctos. Si no hay nada que corregir, repite el texto.
7) "periodonto": cada sondaje, sangrado o supuración dictado, con "pieza", "sistema", "sitio" (MV, V, DV, ML, L, DL o "" si no se dijo), "profundidad" en mm (-1 si no se dijo), "sangrado", "supuracion" (true solo si se dijo) y "evidencia" literal.
8) "pagos": dinero que el paciente pagó o abonó HOY (no lo que debe). Si dice «la mitad», «50 %» o una fracción equivalente de un monto total único e inequívoco, calcula el monto abonado en "monto" y conserva la cita literal en "evidencia". El presupuesto mantiene su monto total original; el pago se registra como abono asociado. Si hay más de un total posible, no adivines: deja el pago pendiente de aclaración. Completa "medio" solo si se dictó (efectivo | debito | credito | transferencia | otro | ""), y "concepto" solo si aparece en la cita. No inventes método ni monto.
9) "citas": la próxima cita o control que se dictó, con "motivo" ("" si no se dijo) y "evidencia" literal que contenga la fecha u hora tal como se dijo. No calcules la fecha.
10) "diagnosticos": cada diagnóstico que el PROFESIONAL dictó hoy (no lo que el paciente relata, ni lo sospechado, probable, a descartar, negado o planificado), con "termino" (el diagnóstico tal como se dijo, p. ej. «pulpitis irreversible sintomática», «absceso apical crónico», «gingivitis inducida por placa», «periodontitis estadio III grado B»), "pieza" ("" si no se dijo) y "evidencia" literal que contenga el término. No pongas códigos: el sistema los asigna desde el catálogo CIE-11. Elige el término clínico y código más específico que esté respaldado por las palabras del profesional; normaliza errores evidentes de reconocimiento solo cuando el contexto lo haga inequívoco. No conviertas síntomas («boca seca», «dolor al frío», «sangrado») en diagnósticos. Si se expresa que faltan criterios o no se puede distinguir entre diagnósticos, deja el diagnóstico vacío y formula una pregunta clínica concreta en «dudas». Las caries ya van en hallazgos: no las repitas aquí.
11) "dudas": incluye dudas reales que el odontólogo deba resolver: además de números inválidos, autocorrecciones confusas o caras inciertas, pregunta cuando un término clínico esté mal reconocido o un diagnóstico sea posible/sospechado y el profesional diga que no hay criterios suficientes para confirmarlo. Cita brevemente la frase y pregunta qué término/diagnóstico confirma el clínico o qué dato permitiría distinguirlo. No propongas una respuesta como hecho ni asignes un código mientras no se aclare. Pregunta por la pieza solo si el número no es válido en ningún sistema (sin etiqueta: 1 a 32 es chilena, 33 a 48 y 51 a 85 es FDI; p. ej. «pieza 39» o «pieza 50»): pregunta «¿Qué pieza?» sin suponer ninguna. «pieza 30» es chilena (FDI 3.6): no es una duda. No preguntes por lo que ya falta en pagos, citas o sondajes (medio de pago, hora, sitio): eso se pregunta aparte.

Las líneas que empiezan con «Aclaración:» son respuestas del profesional a preguntas anteriores; completan o corrigen lo dictado antes y tienen prioridad.

Si el profesional se corrige («no, perdón», «mejor dicho»), usa solo lo corregido. Un control de implante («viene a control por un implante», «está conectado con un pilar», «sin sangrado») no es un implante instalado hoy: el relato va en motivo y examen, y la pieza puede ir en hallazgos con estado Implante. Un nombre de persona o un RUT dictado (del paciente, de un doctor o de otra persona) no es un hallazgo ni un dato de ficha; no lo inventes ni lo completes. Los antecedentes médicos (diabetes, hipertensión, etc.) van en anamnesis, no en indicaciones. "indicaciones" es solo lo que se le indica al paciente.`;

const STRING = { type: "string" } as const;

export const AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nota", "hallazgos", "procedimientos", "presupuesto", "ficha", "texto_corregido", "periodonto", "pagos", "citas", "diagnosticos", "dudas"],
  properties: {
    nota: {
      type: "object",
      additionalProperties: false,
      required: NOTE_SECTIONS.map(([key]) => key),
      properties: Object.fromEntries(NOTE_SECTIONS.map(([key]) => [key, STRING])),
    },
    hallazgos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pieza", "sistema", "tipo", "condicion", "estado", "caras", "profundidad", "material", "color", "evidencia"],
        properties: {
          pieza: STRING,
          sistema: { type: "string", enum: ["chilena", "FDI", "universal", "sin_etiqueta"] },
          tipo: { type: "string", enum: ["superficie", "estado"] },
          condicion: { type: "string", enum: ["", "caries", "obturacion", "sellante", "otra_restauracion", "sana"] },
          estado: { type: "string", enum: ["", "Ausente", "Implante", "Corona", "Indicación de exodoncia", "Resto radicular con endodoncia"] },
          caras: { type: "array", items: { type: "string", enum: ["M", "O", "D", "V", "P"] } },
          profundidad: { type: "string", enum: ["", "esmalte", "dentina_superficial", "dentina_profunda", "pulpar"] },
          material: STRING,
          color: STRING,
          evidencia: STRING,
        },
      },
    },
    procedimientos: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["texto", "evidencia"], properties: { texto: STRING, evidencia: STRING } },
    },
    presupuesto: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["prestacion", "monto", "evidencia"], properties: { prestacion: STRING, monto: { type: "integer" }, evidencia: STRING } },
    },
    ficha: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["campo", "texto", "evidencia"],
        properties: { campo: { type: "string", enum: ["alergias", "antecedentes", "medicamentos"] }, texto: STRING, evidencia: STRING },
      },
    },
    texto_corregido: STRING,
    periodonto: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pieza", "sistema", "sitio", "profundidad", "sangrado", "supuracion", "evidencia"],
        properties: {
          pieza: STRING,
          sistema: { type: "string", enum: ["chilena", "FDI", "universal", "sin_etiqueta"] },
          sitio: { type: "string", enum: ["", "MV", "V", "DV", "ML", "L", "DL"] },
          profundidad: { type: "integer" },
          sangrado: { type: "boolean" },
          supuracion: { type: "boolean" },
          evidencia: STRING,
        },
      },
    },
    pagos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["monto", "medio", "concepto", "evidencia"],
        properties: { monto: { type: "integer" }, medio: { type: "string", enum: ["", "efectivo", "debito", "credito", "transferencia", "otro"] }, concepto: STRING, evidencia: STRING },
      },
    },
    citas: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["motivo", "evidencia"], properties: { motivo: STRING, evidencia: STRING } },
    },
    diagnosticos: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["termino", "pieza", "evidencia"], properties: { termino: STRING, pieza: STRING, evidencia: STRING } },
    },
    dudas: { type: "array", items: STRING },
  },
} as const;

/** Modelos que rechazan response_format json_schema (Workers AI 5025): el esquema va en el texto. */
export const NO_JSON_SCHEMA_MODELS: readonly string[] = ["@cf/meta/llama-3.1-8b-instruct-fp8"];

/** Cuerpo de env.AI.run para un modelo de la cadena (lo usan el deploy y el eval). */
export function buildWorkersAiRequest(model: string, input: Parameters<typeof buildModelUserPrompt>[0]): Record<string, unknown> {
  const user = buildModelUserPrompt(input);
  const base = { max_tokens: 3500, temperature: 0 };
  if (NO_JSON_SCHEMA_MODELS.includes(model)) {
    return {
      ...base,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: `${user}\n\nResponde SOLO con un objeto JSON válido (sin texto antes ni después, sin \`\`\`), con TODAS estas claves y este esquema JSON: ${JSON.stringify(AI_JSON_SCHEMA)}` },
      ],
    };
  }
  return {
    ...base,
    messages: [
      { role: "system", content: AI_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
    response_format: { type: "json_schema", json_schema: AI_JSON_SCHEMA },
  };
}

export function buildModelUserPrompt(input: StructureInput): string {
  const chart = input.chart.length
    ? `\n\nEstado previo del odontograma (solo contexto, no lo repitas como hallazgo): ${input.chart.slice(0, 40).map((item) => `FDI ${formatFdi(item.tooth)} ${item.status}`).join("; ")}.`
    : "";
  const minsalContext = buildMinsalClinicalContext(input.transcript);
  const endoPerioContext = buildEndoPerioContext(input.transcript);
  const clinicalContext = [minsalContext, endoPerioContext].filter(Boolean).join("\n\n");
  const toothContext = [...new Set(toothMentions(spokenPunctuation(input.transcript)).flatMap((item) => item.ok ? [item.numberingLabel] : []))];
  return `Transcripción literal del dictado:\n«${input.transcript.trim()}»${chart}\n\nNumeración resuelta por la aplicación (conserva el sistema de origen): ${toothContext.join("; ") || "sin piezas identificadas"}.\n\n${clinicalContext}\n\nDevuelve el JSON.`;
}

/** Normaliza para comparar citas: sin tildes, minúsculas y solo letras o números. */
export function normalizeEvidence(value: string): string {
  return speechText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** La cita debe estar en la transcripción. Partes separadas por «…» deben aparecer en orden. */
export function evidenceInTranscript(evidence: string, transcript: string): boolean {
  const haystack = ` ${normalizeEvidence(spokenPunctuation(transcript))} `;
  const raw = ` ${normalizeEvidence(transcript)} `;
  const parts = evidence.split(/\s*(?:…|\.\.\.)\s*/).map(normalizeEvidence).filter(Boolean);
  if (!parts.length || parts.join(" ").length < 4) return false;
  for (const target of [raw, haystack]) {
    let from = 0;
    let ok = true;
    for (const part of parts) {
      const index = target.indexOf(` ${part} `, from);
      if (index < 0) { ok = false; break; }
      from = index + part.length;
    }
    if (ok) return true;
  }
  return false;
}

function numbersIn(value: string, articlesAsNumbers = true): Set<string> {
  const found = new Set<string>();
  const plain = value.replace(/(\d)\.(?=\d{3}\b)/g, "$1");
  for (const match of plain.matchAll(/\d+(?:[.,]\d+)?/g)) {
    found.add(match[0].replace(",", "."));
    // «la 37» se escribe «3.7» en la notación con punto de la app (FDI 33–48 y 51–85).
    if (/^(?:3[3-9]|4[0-8]|5[1-9]|6\d|7\d|8[0-5])$/.test(match[0])) found.add(`${match[0][0]}.${match[0][1]}`);
  }
  const spoken = speechText(value);
  for (const [phrase, number] of SPOKEN_CARDINALS) {
    if (!new RegExp(String.raw`\b${phrase}\b`).test(spoken)) continue;
    found.add(String(number));
    // «cincuenta y cinco» también se escribe «5.5» en la notación con punto de la app.
    if (number >= 51 && number <= 85) found.add(`${Math.floor(number / 10)}.${number % 10}`);
  }
  for (const match of spoken.matchAll(/\b(\d+)\s+mil\b/g)) found.add(String(Number(match[1]) * 1000));
  // «cero coma doce» se escribe 0.12; «cuatro coma cinco», 4.5.
  for (const match of spoken.matchAll(/\b([a-z]+)\s+coma\s+([a-z]+(?:\s+y\s+[a-z]+)?)\b/g)) {
    const whole = numberRuns(match[1])[0]?.value;
    const decimals = numberRuns(match[2])[0]?.value;
    if (whole !== undefined && decimals !== undefined) found.add(`${whole}.${decimals}`);
  }
  // «ciento diez mil pesos» se escribe 110000; «fase uno», «cada dos meses»: la nota puede usar cifras.
  for (const amount of amountsIn(value)) found.add(String(amount));
  for (const [word, number] of Object.entries({ un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 })) {
    if (!articlesAsNumbers && (word === "un" || word === "una")) continue; // «un monto de…» no es la cifra 1
    if (new RegExp(String.raw`\b${word}\b`).test(spoken)) found.add(String(number));
  }
  for (const match of spoken.matchAll(new RegExp(String.raw`\b${SPOKEN_DIGIT}\s+${SPOKEN_DIGIT_SECOND}\b`, "g"))) {
    const words = match[0].split(/\s+/);
    found.add(`${spokenDigit(words[0])}.${spokenDigit(words[1])}`);
  }
  return found;
}

function amountsIn(value: string): number[] {
  const amounts: number[] = [];
  const spoken = speechText(value);
  for (const match of spoken.matchAll(/\b(\d{1,3}(?:\.\d{3})+|\d{4,9})\b/g)) amounts.push(Number(match[1].replace(/\./g, "")));
  for (const match of spoken.matchAll(/\b(\d{1,3})\s+mil\b/g)) amounts.push(Number(match[1]) * 1000);
  for (const item of spokenAmounts(value)) amounts.push(item.value);
  return [...new Set(amounts.filter((amount) => Number.isSafeInteger(amount) && amount >= 1000 && amount <= 1_000_000_000))];
}

const CONDITION_FROM_AI: Record<string, SurfaceFinding["condition"]> = {
  caries: "caries",
  obturacion: "restored",
  sellante: "sealant",
  otra_restauracion: "other_restoration",
  sana: "sound",
};

const CONDITION_CUE: Record<string, RegExp> = {
  caries: /(?<!\p{L})caries(?!\p{L})/iu,
  restored: /(?<!\p{L})(?:obtura\p{L}*|restaura\p{L}*|resina|amalgama|composite|ion[oó]mero)(?!\p{L})/iu,
  sealant: /(?<!\p{L})(?:sellante|sellad\p{L}*)(?!\p{L})/iu,
  other_restoration: /(?<!\p{L})(?:restaura\p{L}*|incrustaci\p{L}*|onlay|inlay|carilla)(?!\p{L})/iu,
  sound: /(?<!\p{L})(?:san[oa]|sin\s+lesi[oó]n|sin\s+caries)(?!\p{L})/iu,
};

const STATUS_CUE: Record<string, RegExp> = {
  Ausente: /(?<!\p{L})(?:ausente|extra[ií]d\p{L}*|exodonciad\p{L}*|no\s+est[aá]|falta)(?!\p{L})/iu,
  Implante: /(?<!\p{L})implante(?!\p{L})/iu,
  Corona: /(?<!\p{L})(?:corona|pr[oó]tesis\s+fija)(?!\p{L})/iu,
  "Indicación de exodoncia": /(?<!\p{L})(?:indicaci[oó]n\s+de\s+exodoncia|indica\s+(?:la\s+)?exodoncia|exodoncia\s+indicada|para\s+exodoncia)(?!\p{L})/iu,
  "Resto radicular con endodoncia": /(?<!\p{L})resto\s+radicular(?!\p{L})/iu,
};

type AiExtraction = {
  noteBody: string;
  odontogram: OdontogramChange[];
  incomplete: OdontogramChange[];
  budget: BudgetChange[];
  ficha: FichaChange[];
  procedures: ProcedureItem[];
  clarifications: string[];
  rejected: number;
  correctedText?: string;
  perio?: PerioStub[];
  perioPending?: PerioPending[];
  payments?: PaymentChange[];
  appointments?: AppointmentChange[];
  diagnoses?: DiagnosisItem[];
};

function resolveAiTooth(pieza: string, sistema: string, evidence: string): Mention {
  const inQuote = toothMentions(evidence);
  const good = inQuote.filter((item): item is Extract<Mention, { ok: true }> => item.ok);
  const raw = pieza.trim().replace(/^(?:pieza|diente)\s+/i, "");
  let intended: Mention | null = null;
  if (/^\d{1,2}(?:\.\d)?$/.test(raw)) {
    intended = interpretTooth(raw, sistema === "FDI" ? "fdi" : sistema === "universal" ? "universal" : sistema === "chilena" ? "chilena" : undefined);
  } else if (raw) {
    intended = toothMentions(`pieza ${raw}`)[0] ?? null;
  }
  if (good.length === 1) return good[0];
  if (good.length > 1) {
    const hit = intended?.ok ? good.find((item) => item.tooth === intended.tooth) : undefined;
    return hit ?? { ok: false, reason: `La cita «${clip(evidence, 120)}» nombra varias piezas y no se pudo asignar «${raw}».` };
  }
  const failed = inQuote.find((item) => !item.ok);
  if (failed && !failed.ok) return failed;
  if (intended?.ok && raw && numbersIn(evidence).has(raw.replace(",", ".")) && (sistema === "FDI" ? raw.includes(".") : true)) return intended;
  return { ok: false, reason: `La IA propuso la pieza «${raw || "sin número"}», pero la cita no la contiene: «${clip(evidence, 120)}».` };
}


/** Amplía una cita breve a su frase original solo cuando esta cita y una única pieza explícita aparecen juntas. */
function quoteEvidenceWithPiece(evidence: string, pieza: string, sistema: string, transcript: string): string {
  const raw = pieza.trim().replace(/^(?:pieza|diente)\s+/i, "");
  if (!raw) return evidence;
  let expected: Mention | null = null;
  if (/^\d{1,2}(?:\.\d)?$/.test(raw)) expected = interpretTooth(raw, sistema || undefined);
  else expected = toothMentions(`pieza ${raw}`)[0] ?? null;
  if (!expected?.ok) return evidence;

  for (const candidate of transcript.split(/\n+|(?<=[.!?;])\s+/u).map((part) => part.trim()).filter(Boolean)) {
    if (!evidenceInTranscript(evidence, candidate)) continue;
    const mentions = toothMentions(candidate);
    if (mentions.length === 1 && mentions[0].ok && mentions[0].tooth === expected.tooth) return candidate;
  }
  return evidence;
}

/** Segmento de la cita que habla de la pieza indicada, para no tomar caras ni hallazgos de la pieza vecina. */
function segmentFor(evidence: string, tooth: number): string {
  const parts = sentences(evidence);
  return parts.find((part) => toothMentions(part).some((item) => item.ok && item.tooth === tooth)) ?? evidence;
}

/**
 * Una respuesta «Aclaración: <frase>: <respuesta>» completa la cita de la IA que se refiere a esa frase,
 * aunque una esté en palabras («dos cuatro») y la otra en cifras («2.4»): mismas cifras y casi las mismas palabras.
 */
function answerContext(evidence: string, transcript: string): string {
  const words = (text: string) => new Set(fold(applyLexicon(text).text).split(/[^a-z]+/).filter((w) => w.length > 2 && !isNumberWord(w) && !/^(?:mm|milimetros?|con|las?|los?|del?|en)$/.test(w)));
  const same = (a: string, b: string) => {
    if (JSON.stringify(numberSignature(a)) !== JSON.stringify(numberSignature(b))) return false;
    const wa = words(a), wb = words(b);
    const small = wa.size <= wb.size ? wa : wb, big = small === wa ? wb : wa;
    if (!small.size) return false;
    return [...small].filter((w) => big.has(w)).length / small.size >= 0.75;
  };
  const answers: string[] = [];
  for (const line of transcript.split(/\n/)) {
    const match = /^\s*Aclaraci[oó]n:\s*(.+?):\s*(.+?)\.?\s*$/iu.exec(line);
    if (match && same(match[1], evidence) && !answers.includes(match[2])) answers.push(match[2]);
  }
  return answers.length ? `${evidence.replace(/[.;\s]+$/, "")}, ${answers.map((answer) => answer.replace(/[.;]+/g, ",")).join(", ")}` : evidence;
}

/** Si el odontólogo dijo «dentinaria superficial», repara la sustitución inválida del modelo por «terminal». */
/** Normaliza la denominación del material restaurador sin duplicar sinónimos. */
function normalizeCompositeTerm(value: string): string {
  return value
    .replace(/\bcomp[oó]sito(s)?\b/giu, (match, plural: string | undefined) => `${/^[A-ZÁÉÍÓÚ]/u.test(match) ? "C" : "c"}omposite${plural ? "s" : ""}`)
    .replace(/\bcomposite\s+o\s+resina\s+compuesta\b/giu, "resina compuesta")
    .replace(/\bresina\s+compuesta\s+o\s+composite\b/giu, "resina compuesta");
}

function preserveDentinariaSuperficial(text: string, transcript: string): string {
  if (!/\b(?:dentina|dentinaria)\s+superficial\b/u.test(normalizeEvidence(transcript))) return text;
  return text
    .replace(/\blesi[oó]n\s+cariosa\s+terminal[\s,]+superficial\b/giu, "lesión cariosa dentinaria superficial")
    .replace(/\bcaries?\s+terminal[\s,]+superficial\b/giu, "caries dentinaria superficial")
    .replace(/\bcaries?\s+superficial\b/giu, "caries dentinaria superficial");
}

/** Repara únicamente equivalencias inequívocas, usando el sistema del dictado como autoridad. */
function preserveNarrativeNumbering(text: string, transcript: string): string {
  const source = toothMentions(spokenPunctuation(transcript)).filter((item): item is Extract<Mention, { ok: true }> => item.ok);
  const national = source.filter((item) => item.numbering === "chilena" && /nacional chilena \d+/.test(item.numberingLabel));
  return text.replace(/\b(?:(pieza|diente)\s+(?:(FDI|ISO)\s+)?|(FDI|ISO)\s+)(\d{1,2}(?:\.\d)?)(?!\d|\.\d)/gi, (whole, noun, system, bareSystem, raw) => {
    const interpreted = interpretTooth(raw, system || bareSystem);
    if (!interpreted.ok) return whole;
    let original = national.find((item) => item.tooth === interpreted.tooth);
    // No reinterpretar un FDI que también fue dictado explícitamente.
    if (!original && !source.some((item) => item.tooth === interpreted.tooth) && raw.includes(".")) {
      original = national.find((item) => item.numberingLabel.match(/nacional chilena (\d+)/)?.[1] === raw.replace(".", ""));
    }
    if (!original) return whole;
    const number = original.numberingLabel.match(/nacional chilena (\d+)/)![1];
    return `${noun || "pieza"} ${number}`;
  });
}

export function validateAiExtraction(input: unknown, transcript: string, options: { today?: string } = {}): AiExtraction {
  const today = options.today ?? santiagoToday();
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("La IA no devolvió un objeto JSON.");
  const record = input as Record<string, unknown>;
  if (!record.nota || typeof record.nota !== "object") throw new Error("La IA no devolvió la nota.");
  const clarifications: string[] = [];
  let rejected = 0;
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-ia-${++counter}`;
  const reject = (message: string) => { rejected += 1; clarifications.push(message); };
  const str = (value: unknown, max = 600) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max) : []);

  // Nota
  const nota = record.nota as Record<string, unknown>;
  for (const [key, value] of Object.entries(nota)) {
    if (typeof value === "string") nota[key] = preserveNarrativeNumbering(normalizeCompositeTerm(preserveDentinariaSuperficial(value, transcript)), transcript);
  }
  // Un ejemplo del prompt no constituye un motivo informado para esta atención.
  if (typeof nota.motivo === "string" && /^(?:control|evaluaci[oó]n)(?:\s+(?:dental|odontol[oó]gic[oa]|cl[ií]nic[oa]|de rutina))?[.!]?$/iu.test(nota.motivo.trim())
    && !sentences(transcript).some((line) => /\b(?:control|evaluaci[oó]n)\b/iu.test(line) && !isAppointmentText(line) && !isPlan(line))) {
    nota.motivo = "";
  }
  if (typeof nota.procedimientos === "string") nota.procedimientos = deduplicateProcedureSentences(nota.procedimientos);
  // Una negación explícita de un procedimiento pendiente no puede desaparecer en la redacción.
  // Se repone literalmente desde el dictado, sin inferir fecha, pieza ni motivo.
  const notDone = transcript.match(/\b(?:la\s+cirug[ií]a|el\s+tratamiento|el\s+procedimiento|la\s+exodoncia|la\s+endodoncia)\s+(?:(?:a[uú]n|todav[ií]a)\s+)?no\s+(?:se\s+)?(?:(?:ha|hab[ií]a)\s+)?(?:realizad[oa]|efectuad[oa]|iniciad[oa])\b/iu);
  // La IA a veces pone lo planificado bajo «procedimientos»: si el dictado no dice que algo se hizo, es plan.
  if (typeof nota.procedimientos === "string" && nota.procedimientos.trim()) {
    const plannedOnly = /(?<!\p{L})(?:se\s+(?:planifica|plantea|propone|indica|eval[uú]a)|plan\s+de\s+tratamiento)(?!\p{L})/iu.test(nota.procedimientos)
      && !sentences(transcript).some((line) => PERFORMED_TODAY.test(line) && !isPlan(line) && !planContextOfSegment(line, transcript));
    if (plannedOnly) {
      const moved = nota.procedimientos.trim();
      const plan = typeof nota.plan === "string" ? nota.plan.trim() : "";
      nota.plan = normalizeEvidence(plan).includes(normalizeEvidence(moved)) ? plan : [plan, moved].filter(Boolean).join(" ");
      nota.procedimientos = "";
    }
  }
  const noteText = Object.values(nota).filter((value): value is string => typeof value === "string").join(" ");
  if (notDone && !/\b(?:no\s+(?:(?:se\s+)?(?:ha\s+)?)?(?:realiz|efectu|inici)|sin\s+(?:realizar|efectuar|iniciar)|pendiente\s+de\s+(?:realizar|efectuar|iniciar))/iu.test(noteText)) {
    nota.plan = [typeof nota.plan === "string" ? nota.plan : "", ensurePeriod(capitalize(notDone[0]))].filter(Boolean).join(" ");
  }
  const noteLines: string[] = [];
  for (const [key, label] of NOTE_SECTIONS) {
    const body = typeof nota[key] === "string" ? (nota[key] as string).trim().slice(0, 4000) : "";
    if (body && !/^(?:-|—|no\s+(?:se\s+)?(?:dict[oó]|refiere|consigna|menciona)\p{L}*|sin\s+datos|n\/a)\.?$/iu.test(body)) noteLines.push(label, ensurePeriod(capitalize(body)), "");
  }
  const noteBody = noteLines.join("\n").trim();
  const known = numbersIn(transcript);
  const strange = [...numbersIn(noteBody, false)].filter((value) => !known.has(value) && !/^0+$/.test(value));
  for (const value of strange.slice(0, 6)) clarifications.push(`La nota redactada menciona «${value}», que no aparece en el dictado. Revísalo antes de guardar.`);

  // Hallazgos
  const odontogram: OdontogramChange[] = [];
  const incomplete: OdontogramChange[] = [];
  for (const raw of list(record.hallazgos, 64)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let evidence = str(item.evidencia, 400);
    const pieza = str(item.pieza, 40);
    const what = str(item.tipo) === "estado" ? str(item.estado) : str(item.condicion);
    if (!evidence || !evidenceInTranscript(evidence, transcript)) {
      reject(`La IA propuso «${what || "hallazgo"}» en pieza ${pieza || "?"} sin una cita literal del dictado. No se aplicó.`);
      continue;
    }
    evidence = quoteEvidenceWithPiece(evidence, pieza, str(item.sistema), transcript);
    evidence = answerContext(evidence, transcript);
    const mention = resolveAiTooth(pieza, str(item.sistema), evidence);
    if (!mention.ok) { reject(mention.reason); continue; }
    const segment = segmentFor(evidence, mention.tooth);
    const scope = surfaceScope(segment);
    const base = { tooth: mention.tooth, numbering: mention.numbering, numberingLabel: mention.numberingLabel, sourceText: clip(segment, 400), evidence: clip(evidence, 400), origin: "ia" as const };
    const heading = `FDI ${formatFdi(mention.tooth)}`;
    if (isPatient(segment)) { reject(`Relato del paciente, no hallazgo del examen: «${clip(segment)}».`); continue; }
    if (str(item.tipo) === "estado") {
      const status = str(item.estado, 48) as ToothStatus;
      const cue = STATUS_CUE[status];
      if (!status) continue;
      if (!cue || !TOOTH_STATUSES.includes(status)) { reject(`Estado «${status}» no reconocido en ${heading}.`); continue; }
      if (!cue.test(segment)) { reject(`La cita de ${heading} no dice «${status.toLowerCase()}»: «${clip(segment)}».`); continue; }
      if (status !== "Indicación de exodoncia" && (isPlan(segment) || planContextOfSegment(segment, transcript)) && !isPerformed(segment)) { continue; }
      if (isNegatedFinding(segment)) { reject(`Hallazgo negado, sin cambio de odontograma: «${clip(segment)}».`); continue; }
      if (status === "Resto radicular con endodoncia" && !/endodoncia/i.test(segment)) { reject(`${heading}: resto radicular sin decir si tiene endodoncia.`); continue; }
      // Corona provisoria: aún no es la definitiva, no cambia el estado general.
      if (status === "Corona" && /\bprovisori[ao]s?\b/i.test(segment) && !/\bdefinitiv[ao]s?\b/i.test(segment)) continue;
      if (status === "Corona" || (status === "Implante" && crownOnImplantSentence(segment))) {
        const onImplant = crownOnImplantSentence(segment);
        const material = materialFrom(segment);
        const aiMaterial = str(item.material, 40);
        if (aiMaterial && !material) clarifications.push(`${heading}: la IA indicó material «${aiMaterial}», pero no se dictó. Se dejó sin material.`);
        if (onImplant) odontogram.push({ ...base, id: nextId("odo"), kind: "status", status: "Implante" });
        odontogram.push({ ...base, id: nextId("odo"), kind: "crown", status: "Corona", foundation: onImplant ? "implant" : "tooth", material, shade: shadeFrom(segment) });
        continue;
      }
      const change: OdontogramChange = { ...base, id: nextId("odo"), kind: "status", status };
      const reason = missingReasonFrom(segment);
      if ((status === "Ausente" || status === "Indicación de exodoncia") && reason) change.missingReason = reason;
      odontogram.push(change);
      continue;
    }
    const condition = CONDITION_FROM_AI[str(item.condicion)];
    // Sin condición (p. ej. un sondaje o un dolor que la IA listó como superficie): no hay hallazgo que registrar y no se pregunta.
    if (!condition && !str(item.condicion)) continue;
    if (!condition) { reject(`Hallazgo de superficie no reconocido en ${heading}.`); continue; }
    if (!CONDITION_CUE[condition].test(scope)) {
      reject(`La cita de ${heading} no respalda «${str(item.condicion)}» (o lo dice junto a una fractura u otro hallazgo): «${clip(segment)}».`);
      continue;
    }
    if (condition !== "sound" && isNegatedFinding(segment)) { reject(`Hallazgo negado, sin cambio de odontograma: «${clip(segment)}».`); continue; }
    if ((isPlan(segment) || planContextOfSegment(segment, transcript)) && !isPerformed(segment)) { continue; }
    const resolved = resolveDictatedSurfaces(scope, mention.tooth);
    for (const note of resolved.notes) clarifications.push(note);
    const aiFaces = list(item.caras, 5).filter((face): face is OdontogramSurface => typeof face === "string" && ODONTOGRAM_SURFACES.includes(face as OdontogramSurface));
    const faces = aiFaces.length ? aiFaces.filter((face) => resolved.surfaces.includes(face)) : resolved.surfaces;
    const dropped = aiFaces.filter((face) => !resolved.surfaces.includes(face));
    if (dropped.length) clarifications.push(`${heading}: la IA marcó la cara ${dropped.join(", ")}, que no está en la cita. No se marcó.`);
    if (!faces.length) { reject(`Falta la cara del hallazgo en ${heading}: «${clip(segment)}».`); continue; }
    let finding: SurfaceFinding = { condition, depth: null, icdas: null, activity: null };
    if (condition === "caries") {
      // La profundidad sale de lo dictado (y de su «Aclaración:»); la de la IA solo se compara.
      const reading = cariesDepthFrom(scope);
      const aiDepth = isCariesDepth(item.profundidad) ? item.profundidad : null;
      if (aiDepth && aiDepth !== reading.depth) clarifications.push(`${heading}: la IA indicó ${CARIES_DEPTH_LABEL[aiDepth].toLowerCase()}, pero el dictado ${reading.depth ? `dice ${CARIES_DEPTH_LABEL[reading.depth].toLowerCase()}` : "no dice la profundidad"}. Se usó lo dictado.`);
      finding = { condition: "caries", depth: reading.depth, icdas: (icdasFrom(scope) ?? null) as SurfaceFinding["icdas"], activity: activityFrom(scope) };
      if (!reading.depth) clarifications.push(depthQuestion(heading, reading.ambiguous, segment));
    }
    for (const surface of faces) {
      const earlier = condition === "caries" ? odontogram.find((done) => done.kind === "surface" && done.tooth === mention.tooth && done.surface === surface && done.finding?.condition === "caries") : undefined;
      if (earlier?.finding) {
        earlier.finding = { ...earlier.finding, depth: finding.depth ?? earlier.finding.depth ?? null, activity: finding.activity ?? earlier.finding.activity ?? null };
        continue;
      }
      odontogram.push({ ...base, id: nextId("odo"), kind: "surface", surface, finding });
    }
  }

  // Procedimientos
  const procedures: ProcedureItem[] = [];
  for (const raw of list(record.procedimientos, 24)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const textValue = preserveNarrativeNumbering(str(item.texto, 300), transcript);
    const evidence = str(item.evidencia, 400);
    if (!textValue) continue;
    // Un plan o una indicación no es un procedimiento realizado.
    if (evidence && (isPlan(evidence) || planContextOfSegment(evidence, transcript)) && !isPerformed(evidence) && !PERFORMED_TODAY.test(textValue)) continue;
    procedures.push({ id: nextId("proc"), text: textValue, evidence, verified: Boolean(evidence) && evidenceInTranscript(evidence, transcript) });
  }

  // Presupuesto
  const budget: BudgetChange[] = [];
  for (const raw of list(record.presupuesto, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const label = clip(str(item.prestacion, 180).replace(/^\s*(?:(?:fase|etapa)\s+(?:\d+|uno|dos|tres|cuatro|cinco)|opci[oó]n\s+(?:[abc]|be|ce|\d))\s*[:,.\-]?\s*/iu, ""), 180);
    const evidence = str(item.evidencia, 400);
    if (!label) continue;
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { reject(`Presupuesto «${label}» sin cita literal del dictado. No se propuso.`); continue; }
    // La prestación tiene que estar en la cita (al menos una palabra con contenido).
    const labelWords = normalizeEvidence(label).split(" ").filter((word) => word.length > 3 && !/^\d+$/.test(word));
    const quoted = `${normalizeEvidence(evidence)} ${sentences(transcript).filter((line) => normalizeEvidence(line).includes(normalizeEvidence(evidence)) || normalizeEvidence(evidence).includes(normalizeEvidence(line))).map(normalizeEvidence).join(" ")}`;
    if (labelWords.length && !labelWords.some((word) => quoted.includes(word.slice(0, Math.max(4, word.length - 2))))) { reject(`Presupuesto «${label}»: la prestación no está en la cita. No se propuso.`); continue; }
    const said = amountsIn(evidence);
    const aiAmount = Number(item.monto);
    const paymentDetails = paymentAmountDetails(evidence, paymentContextAmounts(evidence, transcript));
    if (isPaymentText(evidence) && !isFuturePayment(evidence) && aiAmount && aiAmount === paymentDetails?.amount) { clarifications.push(`«${clip(evidence)}» es un pago, no una prestación del presupuesto. Va en pagos.`); continue; }
    let amount = 0;
    if (Number.isSafeInteger(aiAmount) && aiAmount > 0 && said.includes(aiAmount)) amount = aiAmount;
    else if (said.length === 1) amount = said[0];
    if (!amount) clarifications.push(`Falta el monto en pesos de «${label}». Complétalo antes de guardar.`);
    else if (aiAmount && aiAmount !== amount) clarifications.push(`«${label}»: la IA indicó ${aiAmount} y el dictado dice ${amount}. Se usó lo dictado.`);
    budget.push({ id: nextId("pre"), title: "Presupuesto dictado", label: capitalize(label), amount, sourceText: clip(evidence, 400), evidence: clip(evidence, 400), origin: "ia" });
  }

  // Ficha
  const ficha: FichaChange[] = [];
  const fieldMap: Record<string, FichaField> = { alergias: "allergies", antecedentes: "history", medicamentos: "medications" };
  for (const raw of list(record.ficha, 16)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const field = fieldMap[str(item.campo)];
    const textValue = str(item.texto, 300);
    const evidence = str(item.evidencia, 400);
    if (!field || !textValue) continue;
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { reject(`Dato de ficha «${clip(textValue, 80)}» sin cita literal del dictado. No se propuso.`); continue; }
    if (field === "allergies" && !/al[eé]rg/i.test(evidence)) { reject(`La cita no habla de alergias: «${clip(evidence)}».`); continue; }
    const extra = [...numbersIn(textValue)].filter((value) => !numbersIn(evidence).has(value));
    if (extra.length) { reject(`Dato de ficha con cifras que no están en la cita: «${clip(textValue, 80)}».`); continue; }
    ficha.push({ id: nextId("fic"), field, text: ensurePeriod(capitalize(textValue)), evidence: clip(evidence, 400), origin: "ia" });
  }

  // Periodonto: la profundidad, el sitio y el sangrado tienen que estar en la cita.
  const perio: PerioStub[] = [];
  const perioPending: PerioPending[] = [];
  for (const raw of list(record.periodonto, 64)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let evidence = str(item.evidencia, 400);
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { reject(`Sondaje propuesto sin cita literal del dictado. No se anotó.`); continue; }
    const pieza = str(item.pieza, 40);
    evidence = quoteEvidenceWithPiece(evidence, pieza, str(item.sistema), transcript);
    evidence = answerContext(evidence, transcript);
    const mention = resolveAiTooth(pieza, str(item.sistema), evidence);
    if (!mention.ok) { reject(mention.reason); continue; }
    const segment = segmentFor(evidence, mention.tooth);
    const reading = perioReading(segment);
    const aiDepth = Number(item.profundidad);
    const depth = reading.depth;
    if (Number.isInteger(aiDepth) && aiDepth >= 0 && aiDepth !== depth) clarifications.push(`FDI ${formatFdi(mention.tooth)}: la IA indicó ${aiDepth} mm, pero la cita ${depth === null ? "no dice los mm" : `dice ${depth} mm`}. Se usó lo dictado.`);
    if (depth !== null && depth > 15) { reject(`Sondaje fuera de 0 a 15 mm: «${clip(segment)}».`); continue; }
    const aiSite = str(item.sitio) as PerioSite | "";
    const site = reading.site;
    if (aiSite && aiSite !== site) clarifications.push(`FDI ${formatFdi(mention.tooth)}: la IA indicó el sitio ${aiSite}, que no está en la cita. ${site ? `Se usó ${site}.` : "Queda sin sitio."}`);
    const bleeding = item.sangrado === true && reading.bleeding;
    const suppuration = item.supuracion === true && reading.suppuration;
    if (depth === null && !bleeding && !suppuration) continue;
    if (depth === null || !site) {
      perioPending.push({ id: nextId("pen"), tooth: mention.tooth, numberingLabel: mention.numberingLabel, site, depth, bleeding, suppuration, evidence: clip(evidence, 400), origin: "ia" });
      continue;
    }
    perio.push({ id: nextId("per"), tooth: mention.tooth, numberingLabel: mention.numberingLabel, site, siteLabel: SITE_LABEL[site], depth, sourceText: clip(segment), persisted: false, bleeding, suppuration, evidence: clip(evidence, 400), origin: "ia" });
  }

  // Pagos: el monto tiene que estar dicho y ser un pago hecho hoy.
  const payments: PaymentChange[] = [];
  for (const raw of list(record.pagos, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let evidence = str(item.evidencia, 400);
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { reject("Pago propuesto sin cita literal del dictado. No se anotó."); continue; }
    evidence = answerContext(evidence, transcript);
    if (!isPaymentText(evidence) || isFuturePayment(evidence)) { reject(`La cita no dice que pagó hoy: «${clip(evidence)}». No se anotó como pago.`); continue; }
    const details = paymentAmountDetails(evidence, paymentContextAmounts(evidence, transcript));
    const said = details?.amount ?? null;
    const aiAmount = Number(item.monto);
    if (!said) { reject(`Pago sin monto base inequívoco: «${clip(evidence)}». ¿Cuál es el monto total al que corresponde el abono?`); continue; }
    if (aiAmount && aiAmount !== said) clarifications.push(`Pago: la IA indicó ${money(aiAmount)} y el cálculo desde el dictado da ${money(said)}. Se usó el dictado.`);
    const aiMethod = str(item.medio) as PaymentMethod | "";
    const method = paymentMethodFrom(evidence);
    if (aiMethod && aiMethod !== method) clarifications.push(`Pago de ${money(said)}: la IA indicó «${aiMethod}», que no está en la cita.`);
    const concept = str(item.concepto, 120);
    const conceptOk = concept && normalizeEvidence(concept).split(" ").filter((word) => word.length > 3).every((word) => normalizeEvidence(evidence).includes(word.slice(0, Math.max(4, word.length - 2))));
    payments.push({
      id: nextId("pag"),
      amount: said,
      method,
      concept: conceptOk ? capitalize(concept) : paymentConcept(evidence),
      evidence: clip(evidence, 400),
      origin: "ia",
      ...(details?.baseAmount ? { baseAmount: details.baseAmount, percentage: details.percentage } : {}),
    });
  }

  // Citas: la fecha y la hora se calculan desde la cita literal, no desde la IA.
  const appointments: AppointmentChange[] = [];
  for (const raw of list(record.citas, 4)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let evidence = str(item.evidencia, 400);
    if (!evidence || !evidenceInTranscript(evidence, transcript)) { reject("Cita propuesta sin cita literal del dictado. No se agendó."); continue; }
    evidence = answerContext(evidence, transcript);
    const appointment = appointmentFrom(evidence, today, nextId("cit"), "ia");
    const motivo = str(item.motivo, 120);
    if (appointment.reason === "Control" && motivo && normalizeEvidence(evidence).includes(normalizeEvidence(motivo).split(" ")[0] ?? "")) appointment.reason = capitalize(motivo);
    appointments.push(appointment);
  }

  for (const doubt of list(record.dudas, 12)) {
    const value = str(doubt, 300);
    // Sistema de numeración, profundidad de caries, medio de pago, hora y sitio ya los preguntan las reglas.
    const asksPerio = /sondaje|sangrado|supuraci|bolsa\s+periodontal/i.test(value);
    const perioDictated = /sondaj|sangrad|supuraci|bolsa|profundidad|periodontograma|inserci/i.test(transcript);
    // La IA ve la ficha y a veces pregunta por una pieza que este dictado no menciona: esa duda no corresponde.
    const dictatedNumbers = new Set([...numbersIn(transcript)].map((number) => number.replace(".", "")));
    const askedTeeth = [...value.matchAll(/\b(?:pieza|fdi)\s+(\d(?:\.\d)?|\d{2})\b/gi)].map((match) => match[1].replace(".", ""));
    const offTopicTooth = askedTeeth.some((number) => !dictatedNumbers.has(number));
    if (value && !offTopicTooth && !(asksPerio && !perioDictated) && !/sistema|numeraci|etiqueta|icdas|actividad|profundidad|esmalte|dentina|medio de pago|forma de pago|hora|sitio|temporal o permanente|permanente o temporal/i.test(value)) clarifications.push(`IA: ${value}`);
  }
  // Diagnósticos: la IA elige el concepto y cita la frase; el código lo pone el catálogo, nunca la IA.
  const diagnoses: DiagnosisItem[] = [];
  for (const raw of list(record.diagnosticos, 16)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const term = str(item.termino, 120);
    let evidence = str(item.evidencia, 400);
    if (!term || !evidence || !evidenceInTranscript(evidence, transcript)) continue;
    const pieza = str(item.pieza, 40);
    evidence = quoteEvidenceWithPiece(evidence, pieza, "", transcript);
    // Ni relatos del paciente, ni planes, ni negaciones, ni sospechas.
    if (isPatient(evidence) || isPlan(evidence) || isNegatedFinding(evidence) || DIAGNOSIS_DOUBT.test(fold(evidence))) continue;
    const literal = normalizeEvidence(evidence).includes(normalizeEvidence(term));
    // Un diagnóstico que la CIE-11 no trae queda como etiqueta sin código solo si el profesional lo nombró
    // con una fórmula diagnóstica y el término está tal cual en su frase: nunca se inventa un código.
    const mapped = diagnosisFromTerm(term)
      ?? (literal && DIAGNOSIS_CUE.test(fold(evidence)) && term.length >= 5 ? { code: "", title: capitalize(term) } : null);
    if (!mapped) continue;
    // El concepto debe estar en la cita: literal, o reconocido por las reglas en ella.
    const said = literal || diagnosisMatches(evidence).some((m) => m.code === mapped.code && m.title === mapped.title);
    if (!said) continue;
    const mention = pieza ? resolveAiTooth(pieza, "", evidence) : toothMentions(evidence).find((m) => m.ok);
    let tooth = mention && mention.ok ? mention.tooth : undefined;
    // Un diagnóstico pulpar o de caries dictado sin pieza en su frase pertenece a la única pieza que nombra el dictado.
    if (tooth === undefined && /^DA0[89]/.test(mapped.code)) {
      const named = new Set(sentences(transcript).flatMap((text) => toothMentions(text).filter((m) => m.ok).map((m) => (m as { tooth: number }).tooth)));
      if (named.size === 1) tooth = [...named][0];
    }
    if (diagnoses.some((done) => done.code === mapped.code && done.title === mapped.title && done.tooth === tooth)) continue;
    const dx: DiagnosisItem = { id: nextId("dx"), tooth, code: mapped.code, title: mapped.title, label: "", evidence: clip(evidence, 400), findings: "", origin: "ia", term, ...(mapped.suggested ? { suggested: mapped.suggested } : {}) };
    dx.label = diagnosisLabel(dx);
    diagnoses.push(dx);
  }
  const correctedText = typeof record.texto_corregido === "string" ? record.texto_corregido.slice(0, 10000) : undefined;
  return { noteBody, odontogram, incomplete, budget, ficha, procedures, clarifications, rejected, correctedText, perio, perioPending, payments, appointments, diagnoses };
}

function sameFinding(a: OdontogramChange, b: OdontogramChange): boolean {
  return dedupeKey({ ...a, material: undefined }) === dedupeKey({ ...b, material: undefined }) && (a.kind !== "surface" || (a.finding?.activity ?? null) === (b.finding?.activity ?? null));
}

function collides(a: OdontogramChange, b: OdontogramChange): boolean {
  if (a.tooth !== b.tooth) return false;
  if (a.kind === "surface" && b.kind === "surface") return a.surface === b.surface;
  return a.kind !== "surface" && b.kind !== "surface" && a.kind === b.kind;
}

/** Une IA y reglas. Coincidencias suben de confianza; diferencias en la misma pieza quedan en conflicto para que decida el odontólogo. */
export const PROCEDURE_SECTION = "Procedimientos realizados";
const NOTE_SECTION_HEADINGS = new Set([...NOTE_SECTIONS.map(([, label]) => label), "Condición al egreso"]);

function noteSectionLines(body: string, heading: string): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && lines[end].trim() && !NOTE_SECTION_HEADINGS.has(lines[end].trim())) end += 1;
  return lines.slice(start + 1, end).map((line) => line.trim()).filter(Boolean);
}

const procedureTextMatches = procedureCovered;

function professionalizeProcedureText(value: string): string {
  let text = normalizeCompositeTerm(value.replace(/\s+/g, " ").trim());
  text = text
    .replace(/^se hace\b/i, "Se realiza")
    .replace(/^se efectu[oó]\b/i, "Se realizó")
    .replace(/^se realiz[oó]\b/i, "Se realizó")
    .replace(/\b(?:destartraje|detartraje) supra(?:gingival)?\s*(?:y|e)\s*sub\s*gingival\b/giu, "destartraje supragingival y subgingival")
    .replace(/\bsupra\s+gingival\b/giu, "supragingival")
    .replace(/\bsub\s+gingival\b/giu, "subgingival");
  return ensurePeriod(capitalize(text));
}

function insertProcedureLines(body: string, additions: string[]): string {
  const unique = additions.filter((line, index) => line && !additions.slice(0, index).some((prior) => procedureTextMatches(line, prior)));
  if (!unique.length) return body;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === PROCEDURE_SECTION);
  if (start >= 0) {
    let end = start + 1;
    while (end < lines.length && lines[end].trim() && !NOTE_SECTION_HEADINGS.has(lines[end].trim())) end += 1;
    const current = lines.slice(start + 1, end).map((line) => line.trim()).filter(Boolean);
    const missing = unique.filter((line) => !current.some((existing) => procedureTextMatches(line, existing)));
    if (!missing.length) return body;
    lines.splice(end, 0, ...missing);
  } else {
    const rank = NOTE_SECTIONS.findIndex(([, label]) => label === PROCEDURE_SECTION);
    let insertAt = lines.findIndex((line) => {
      const nextRank = NOTE_SECTIONS.findIndex(([, label]) => label === line.trim());
      return nextRank > rank;
    });
    if (insertAt < 0) {
      if (lines.length && lines[lines.length - 1].trim()) lines.push("");
      insertAt = lines.length;
    }
    lines.splice(insertAt, 0, PROCEDURE_SECTION, ...unique, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function completeProcedureSection(noteBody: string, aiProcedures: ProcedureItem[], localBody: string, clarifications: string[]): string {
  const localProcedures = noteSectionLines(localBody, PROCEDURE_SECTION);
  if (!localProcedures.length) return noteBody;
  const existingNote = noteSectionLines(noteBody, PROCEDURE_SECTION);
  const verifiedProcedures = aiProcedures.filter((item) =>
    item.verified && item.text.trim() && item.evidence.trim()
    && localProcedures.some((line) => procedureTextMatches(item.evidence, line)),
  );
  const additions: string[] = [];
  for (const item of verifiedProcedures) {
    if (existingNote.some((line) => procedureTextMatches(item.evidence, line) || procedureTextMatches(item.text, line))) continue;
    additions.push(professionalizeProcedureText(item.text));
  }
  for (const line of localProcedures) {
    if (verifiedProcedures.some((item) => procedureTextMatches(line, item.evidence))) continue;
    if (existingNote.some((noteLine) => procedureTextMatches(line, noteLine))) continue;
    if (additions.some((addition) => procedureTextMatches(line, addition))) continue;
    // La comparación léxica no demuestra que falte un hecho: no pegar dictado crudo en una nota redactada.
    clarifications.push(`Revisa que la evolución incluya este procedimiento y sus detalles: «${line}». No se añadió automáticamente para evitar duplicaciones.`);
  }
  return insertProcedureLines(noteBody, additions);
}

function vagueSurfaceClarifications(transcript: string): string[] {
  const explicitSurface = /(?<!\p{L})(?:oclusal|incisal|vestibular|bucal|palatin[ao]|lingual|mesial|distal)(?!\p{L})/iu;
  return sentences(transcript)
    .filter((sentence) =>
      /(?<!\p{L})(?:por arriba|parte de arriba|por encima)(?!\p{L})/iu.test(sentence)
      && /(?<!\p{L})(?:caries|lesi[oó]n|cavidad)(?!\p{L})/iu.test(sentence)
      && !explicitSurface.test(sentence),
    )
    .map((sentence) => "¿Qué superficie clínica quiso indicar con «por arriba»? «" + clip(sentence, 180) + "»");
}

function completeDischargeCondition(body: string, localBody: string): string {
  const localOthers = noteSectionLines(localBody, "Otros dichos");
  const explicitGoodEgress = localOthers.some((line) => {
    const normalized = normalizeEvidence(line);
    return /^(?:paciente )?(?:se va|se retira|egresa)(?: bien| en buenas condiciones(?: generales)?)$/.test(normalized);
  });
  if (!explicitGoodEgress) return body;
  const normalizedBody = body.replace(/\b(?:el )?paciente se va bien\b/giu, "Finaliza la atención en buenas condiciones");
  const alreadyRecorded = /\b(?:finaliza|concluye)\b.{0,60}\b(?:bien|buenas condiciones)\b|\b(?:egresa|se retira|se va)\b.{0,60}\b(?:bien|buenas condiciones)\b/iu.test(normalizedBody);
  if (alreadyRecorded) return normalizedBody.trim();
  const section = "Condición al egreso\nFinaliza la atención en buenas condiciones.";
  return normalizedBody.trim() ? normalizedBody.trim() + "\n\n" + section : section;
}

export function mergeProposals(ai: AiExtraction, local: DictationProposal, transcript: string): DictationProposal {
  const odontogram: OdontogramChange[] = [];
  const clarifications = [...ai.clarifications];
  const conflicts = new Set<string>();
  for (const candidate of ai.odontogram) {
    const same = odontogram.find((item) => sameFinding(item, candidate));
    if (same) {
      if (same.origin && candidate.origin) same.origin = originUnion(same.origin, candidate.origin);
      else same.origin = same.origin ?? candidate.origin;
      if (!same.material && candidate.material) same.material = candidate.material;
      if (!same.shade && candidate.shade) same.shade = candidate.shade;
      continue;
    }
    const rivals = odontogram.filter((item) => collides(item, candidate));
    if (rivals.length) {
      for (const item of rivals) item.conflict = true;
      odontogram.push({ ...candidate, conflict: true });
      const key = candidate.kind === "surface"
        ? `surface:${candidate.tooth}:${candidate.surface}`
        : `${candidate.kind}:${candidate.tooth}`;
      if (!conflicts.has(key)) {
        conflicts.add(key);
        const location = candidate.kind === "surface" && candidate.surface
          ? `la superficie ${candidate.surface}`
          : candidate.kind === "crown" ? "la corona" : "el estado general";
        clarifications.push(`La IA entregó propuestas incompatibles para ${location} de FDI ${formatFdi(candidate.tooth)}. Elige una antes de guardar.`);
      }
      continue;
    }
    odontogram.push({ ...candidate });
  }
  for (const rule of local.odontogram) {
    const same = odontogram.find((item) => item.origin !== "reglas" && sameFinding(item, rule));
    if (same) {
      same.origin = "ia+reglas";
      if (!same.material && rule.material) same.material = rule.material;
      if (!same.shade && rule.shade) same.shade = rule.shade;
      continue;
    }
    const rival = odontogram.filter((item) => item.origin !== "reglas" && collides(item, rule));
    if (rival.length) {
      for (const item of rival) item.conflict = true;
      odontogram.push({ ...rule, origin: "reglas", conflict: true });
      clarifications.push(`FDI ${formatFdi(rule.tooth)}: la IA y las reglas no coinciden. Elige una de las dos propuestas.`);
      continue;
    }
    odontogram.push({ ...rule, origin: "reglas" });
  }
  // Caries dictada y luego restaurada en la misma superficie: queda la restauración y la caries sigue como diagnóstico.
  const folded = new Set<number>();
  for (const restored of odontogram) {
    if (restored.kind !== "surface" || restored.finding?.condition !== "restored") continue;
    const caries = odontogram.find((item) => item !== restored && item.kind === "surface" && item.tooth === restored.tooth && item.surface === restored.surface && item.finding?.condition === "caries");
    if (!caries?.finding) continue;
    restored.treatedCaries = caries.finding;
    restored.origin = originUnion(restored.origin ?? "reglas", caries.origin ?? "reglas");
    odontogram.splice(odontogram.indexOf(caries), 1);
    folded.add(restored.tooth);
  }
  for (const tooth of folded) {
    for (const item of odontogram) if (item.tooth === tooth && !odontogram.some((other) => other !== item && collides(other, item))) item.conflict = undefined;
    if (!odontogram.some((item) => item.tooth === tooth && item.conflict)) {
      const note = `FDI ${formatFdi(tooth)}: la IA y las reglas no coinciden. Elige una de las dos propuestas.`;
      for (let index = clarifications.length - 1; index >= 0; index--) if (clarifications[index] === note) clarifications.splice(index, 1);
    }
  }
  // Una caries completa no debe quedar además como incompleta.
  const incomplete: OdontogramChange[] = [];
  for (const item of [...ai.incomplete, ...(local.incomplete ?? [])]) {
    if (odontogram.some((done) => done.tooth === item.tooth && done.surface === item.surface && done.kind === "surface")) continue;
    if (incomplete.some((done) => done.tooth === item.tooth && done.surface === item.surface)) continue;
    incomplete.push(item);
  }
  const budget = [...ai.budget];
  const skipNotes = new Set<string>();
  const aiQuotes = ai.clarifications.map((note) => note.match(/«([^»]+)»/)?.[1]).filter((quote): quote is string => Boolean(quote)).map((quote) => normalizeEvidence(quote.replace(/…$/, "")));
  for (const rule of local.budget) {
    const ruleText = normalizeEvidence(rule.sourceText);
    const overlaps = (item: BudgetChange) => {
      const text = normalizeEvidence(item.evidence ?? item.sourceText);
      return Boolean(text) && (ruleText.includes(text) || text.includes(ruleText));
    };
    const ruleLabelText = normalizeEvidence(rule.label);
    const same = budget.find((item) => {
      if (rule.amount === 0) return overlaps(item) || (item.amount === 0 && ruleText.includes(ruleLabelText.split(" ")[0] ?? ""));
      if (item.amount !== rule.amount) return false;
      const itemLabelText = normalizeEvidence(item.label);
      return overlaps(item) || itemLabelText === ruleLabelText || itemLabelText.includes(ruleLabelText) || ruleLabelText.includes(itemLabelText);
    });
    // La IA dejó en 0 un monto dicho en palabras que las reglas sí leyeron: se completa en vez de duplicar.
    const zero = rule.amount > 0 ? budget.find((item) => item.amount === 0 && overlaps(item)) : undefined;
    if (!same && zero) {
      zero.amount = rule.amount;
      zero.origin = "ia+reglas";
      continue;
    }
    if (same) {
      same.origin = "ia+reglas";
      // La IA leyó el monto que las reglas no pudieron leer: no se pide de nuevo.
      if (rule.amount === 0 && same.amount > 0) skipNotes.add(`Falta el monto en pesos de «${rule.label}». Complétalo antes de guardar.`);
      continue;
    }
    budget.push({ ...rule, origin: "reglas" });
  }
  const ficha = [...ai.ficha];
  for (const rule of local.ficha ?? []) {
    const same = ficha.find((item) => item.field === rule.field && (normalizeEvidence(rule.evidence).includes(normalizeEvidence(item.evidence)) || normalizeEvidence(item.evidence).includes(normalizeEvidence(rule.evidence))));
    if (same) { same.origin = "ia+reglas"; continue; }
    ficha.push({ ...rule, origin: "reglas" });
  }
  // Una cara que la IA no pudo citar pero que las reglas sí resolvieron no queda como duda.
  for (let index = clarifications.length - 1; index >= 0; index -= 1) {
    const fdi = clarifications[index].match(/^(?:Falta la cara del hallazgo en|Hallazgo de superficie no reconocido en|FDI) (\d\.\d)/)?.[1];
    if (fdi && /cara|no reconocido/.test(clarifications[index]) && odontogram.some((item) => item.kind === "surface" && formatFdi(item.tooth) === fdi)) clarifications.splice(index, 1);
  }
  for (const note of local.clarifications) {
    // Lo que las reglas no resolvieron pero la IA sí (con cita validada) no se repite como duda.
    const quoted = note.match(/«([^»]+)»/)?.[1];
    if (skipNotes.has(note)) continue;
    if (quoted && /caries/i.test(note) && aiQuotes.includes(normalizeEvidence(quoted.replace(/…$/, "")))) continue;
    if (quoted && /ICDAS|profundidad de la caries|superficie|mezcla/i.test(note) && odontogram.some((item) => item.origin !== "reglas" && normalizeEvidence(item.evidence ?? "").includes(normalizeEvidence(quoted.replace(/…$/, ""))))) continue;
    clarifications.push(note);
  }
  const ids = new Map<string, number>();
  const renumber = <T extends { id: string }>(items: T[], prefix: string) => items.map((item) => {
    const next = (ids.get(prefix) ?? 0) + 1;
    ids.set(prefix, next);
    return { ...item, id: `${prefix}-${next}` };
  });
  const sure = odontogram.filter((item) => !item.conflict);
  const exam = examLines(sure);
  const noteBody = completeProcedureSection(ai.noteBody, ai.procedures, local.evolution?.body ?? "", clarifications);
  const body = [
    noteBody,
    exam.length ? `\n${EXAM_REGISTRY_HEADER}\n${exam.join("\n")}` : "",
  ].join("\n").trim();
  const completedBody = completeDischargeCondition(body, local.evolution?.body ?? "");
  const routed = finishRouting({
    evolution: completedBody ? { title: "Evolución dictada", body: completedBody } : local.evolution,
    odontogram: renumber(odontogram, "odo"),
    budget,
    perio: [...(ai.perio ?? []), ...local.perio.map((item) => ({ ...item, origin: item.origin ?? ("reglas" as const) }))],
    clarifications: [...new Set(clarifications)],
    incomplete: renumber(incomplete, "inc"),
    ficha: renumber(ficha, "fic"),
    procedures: ai.procedures,
    transcript: transcript.trim(),
    perioPending: [...(ai.perioPending ?? []), ...(local.perioPending ?? [])],
    mobility: local.mobility ?? [],
    payments: [...(ai.payments ?? []), ...(local.payments ?? [])],
    appointments: [...(ai.appointments ?? []), ...(local.appointments ?? [])],
  });
  const finalBudget = renumber(routed.budget, "pre");
  const finalPayments = renumber(routed.payments ?? [], "pag").map((item) => {
    const budget = paymentBudgetMatch(item, finalBudget);
    return budget ? { ...item, budgetRef: budget.id } : { ...item, budgetRef: undefined };
  });
  // Propuestas de la IA que no pasaron la verificación y no se aplicaron: si las reglas ya registraron esa pieza, el aviso solo ensucia.
  const handledTeeth = new Set<string>([
    ...routed.odontogram.map((item) => formatFdi(item.tooth)),
    ...routed.perio.map((item) => formatFdi(item.tooth)),
    ...(routed.mobility ?? []).map((item) => formatFdi(item.tooth)),
  ]);
  const aiDiscard = /^(?:La cita de FDI ([\d.]+) no |La IA propuso «[^»]+» en pieza ([\d.]+) sin una cita|FDI ([\d.]+): la IA indic[oó] (?:el sitio|\d+ mm))/;
  const tidyNotices = routed.clarifications.filter((note) => {
    const match = note.match(aiDiscard);
    if (match?.[1] || match?.[2]) return false; // propuesta de la IA sin cita: nada se aplicó, el aviso solo ensucia
    const tooth = match?.[3];
    return !(tooth && handledTeeth.has(tooth));
  });
  return withCatalogCodes({
    ...routed,
    clarifications: tidyNotices,
    budget: finalBudget,
    perio: renumber(routed.perio, "per"),
    perioPending: renumber(routed.perioPending ?? [], "pen"),
    payments: finalPayments,
    appointments: renumber(routed.appointments ?? [], "cit"),
    mobility: renumber(routed.mobility ?? [], "mov"),
  });
}

export function sanitizeChart(value: unknown): StructureInput["chart"] {
  if (!Array.isArray(value)) return [];
  const chart: StructureInput["chart"] = [];
  for (const item of value.slice(0, 80)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const tooth = Number(record.tooth);
    const status = typeof record.status === "string" ? record.status : "";
    if (!isValidFdi(tooth) || !TOOTH_STATUSES.includes(status as ToothStatus)) continue;
    chart.push({ tooth, status });
  }
  return chart;
}

export type DictationLog = (event: string, detail: Record<string, string | number>) => void;

const defaultDictationLog: DictationLog = (event, detail) => {
  console.error(event, detail);
};

/** Resultado de un modelo con el nombre del que respondió (cadena de respaldo). */
export type ModelAnswer = { usedModel: string; output: unknown; /** Aviso discreto, p. ej. «Corregido con OpenAI (cupo de Workers AI agotado)». */ note?: string };

function isModelAnswer(value: unknown): value is ModelAnswer {
  return Boolean(value) && typeof value === "object" && typeof (value as ModelAnswer).usedModel === "string" && "output" in (value as object);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (cause) => { clearTimeout(timer); reject(cause); });
  });
}

/** Tema y destino de una pregunta: así IA y reglas no preguntan lo mismo dos veces. */
function clarificationKey(note: string): string {
  const notFdi = note.match(/«pieza (\d{1,2})» no es una pieza válida/);
  if (notFdi) return `pieza-no-fdi:${notFdi[1]}`;
  const plain = normalizeEvidence(note.replace(/^IA:\s*/i, ""));
  const tooth = note.match(/FDI (\d\.\d)/)?.[1];
  if (tooth && /profundidad de la caries/i.test(note)) return `profundidad:${tooth}`;
  if (/medio (?:de pago|se pagaron)|forma de pago/i.test(note)) return `pago:${note.match(/\$\s?[\d.]+/)?.[0] ?? plain}`;
  return plain;
}

/** Quita preguntas repetidas y las de profundidad ya respondidas (la caries de esa pieza ya tiene profundidad). */
export function tidyClarifications(notes: string[], odontogram: OdontogramChange[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const note of notes) {
    const tooth = note.match(/^(?:IA:\s*)?FDI (\d)\.(\d)/);
    if (tooth && /profundidad de la caries/i.test(note)) {
      const fdi = Number(`${tooth[1]}${tooth[2]}`);
      const caries = odontogram.filter((item) => item.tooth === fdi && item.finding?.condition === "caries");
      if (caries.length && caries.every((item) => item.finding?.depth)) continue;
    }
    const key = clarificationKey(note);
    if (seen.has(key)) {
      // La versión con «Primera opción» reemplaza a la pregunta simple de la misma pieza.
      if (key.startsWith("pieza-no-fdi:") && /Primera opción/.test(note)) {
        const at = out.findIndex((item) => clarificationKey(item) === key);
        if (at >= 0 && !/Primera opción/.test(out[at])) out[at] = note;
      }
      continue;
    }
    seen.add(key);
    out.push(note);
  }
  return out;
}

/** Contexto de procedimiento que comparten dos menciones de pieza (implante, corona, caries…). */
const PROCEDURE_CONTEXT: Array<[string, RegExp]> = [
  ["implante", /\bimplantes?\b|\bpilar(?:es)?\b/iu],
  ["corona", /\bcoronas?\b/iu],
  ["endodoncia", /\bendodoncia|\bconductos?\b/iu],
  ["obturación", /\bobturaci|\bresina|\bamalgama/iu],
  ["caries", /\bcaries\b/iu],
  ["exodoncia", /\bexodoncia|\bextracci/iu],
];

function contextsIn(slice: string): string[] {
  return PROCEDURE_CONTEXT.filter(([, re]) => re.test(slice)).map(([name]) => name);
}

/**
 * Contexto de una mención: lo que se dice desde la pieza hasta la siguiente pieza. Si ahí no hay procedimiento,
 * lo que se dijo antes en la misma frase, siempre que no haya otra pieza entremedio («implante en pieza 2.6»).
 */
function mentionContext(text: string, mention: { index: number; length: number }, all: Array<{ index: number; length: number }>): string[] {
  const next = all.filter((item) => item.index > mention.index).map((item) => item.index).sort((a, b) => a - b)[0] ?? text.length;
  const after = contextsIn(text.slice(mention.index, next));
  if (after.length) return after;
  const sentenceStart = Math.max(text.lastIndexOf(".", mention.index - 1), text.lastIndexOf("\n", mention.index - 1)) + 1;
  const earlier = all.some((item) => item.index < mention.index && item.index >= sentenceStart);
  return earlier ? [] : contextsIn(text.slice(sentenceStart, mention.index));
}

/** Piezas válidas dictadas en el texto, con su posición (3.6, «pieza 30» chilena = 3.6, «pieza 36» FDI, «dos seis» ya corregido a 2.6). */
function fdiMentionsWithIndex(text: string): Array<{ tooth: number; index: number; length: number }> {
  const out: Array<{ tooth: number; index: number; length: number }> = [];
  for (const match of text.matchAll(/(?<![\d.,])([1-8])[.,]([1-8])(?![\d.,]?\d)(?!\s*(?:mm|mil[ií]metros?|cm|%|[x×]))/gu)) {
    const tooth = Number(`${match[1]}${match[2]}`);
    if (isValidFdi(tooth)) out.push({ tooth, index: match.index ?? 0, length: match[0].length });
  }
  for (const match of text.matchAll(/(?<!\p{L})(?:pieza|diente)(?:\s+(fdi))?:?\s+(\d{1,2})(?![\d.,]\d)(?!\p{L})/giu)) {
    const value = Number(match[2]);
    const tooth = match[1] ? (isValidFdi(value) ? value : null) : bareToothNumber(value);
    if (tooth) out.push({ tooth, index: match.index ?? 0, length: match[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * «pieza N» sin sistema que no existe ni en numeración chilena (1–32) ni en FDI (33–48, 51–85): no se asume.
 * Si el dictado nombra otra pieza válida en el mismo contexto (p. ej. «implante 2.6» antes), se sugiere
 * como primera opción, sin marcarla.
 */
export function numberingDoubts(text: string, chart: StructureInput["chart"] = []): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  const valid = fdiMentionsWithIndex(text);
  const implantsInChart = [...new Set(chart.filter((item) => /^Implante/.test(item.status)).map((item) => item.tooth))];
  const invalid: Array<{ value: number; index: number; length: number }> = [];
  for (const match of text.matchAll(/(?<!\p{L})(?:pieza|diente):?\s+(\d{1,2})(?![\d.,]\d|\s*(?:mm|mil[ií]metros?))(?!\p{L})/giu)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    if (/(?:fdi|iso|chilena|nacional|universal)\s*$/i.test(before)) continue;
    const value = Number(match[1]);
    if (bareToothNumber(value)) continue;
    invalid.push({ value, index: match.index ?? 0, length: match[0].length });
  }
  const all = [...valid, ...invalid];
  for (const mention of invalid) {
    if (seen.has(mention.value)) continue;
    seen.add(mention.value);
    const context = mentionContext(text, mention, all);
    let candidate: { tooth: number; shared: string } | undefined;
    for (const item of [...valid].sort((x, y) => Math.abs(x.index - mention.index) - Math.abs(y.index - mention.index))) {
      const shared = mentionContext(text, item, all).find((name) => context.includes(name));
      if (shared) { candidate = { tooth: item.tooth, shared }; break; }
    }
    // Sin otra pieza en el dictado: si se habla de un implante y el odontograma tiene uno solo, se sugiere ese.
    const fromChart = !candidate && context.includes("implante") && implantsInChart.length === 1 ? implantsInChart[0] : null;
    const suggestion = candidate
      ? `FDI ${formatFdi(candidate.tooth)} (${candidate.shared} dicho en este mismo dictado)`
      : fromChart ? `FDI ${formatFdi(fromChart)} (único implante en el odontograma)` : undefined;
    out.push(invalidToothQuestion(String(mention.value), suggestion));
  }
  return out;
}

/** Pieza principal de la evolución para el título: la primera del odontograma o la primera dictada. */
function mainToothLabel(text: string, odontogram: OdontogramChange[]): string | null {
  const first = odontogram[0];
  if (first) return first.numberingLabel || `FDI ${formatFdi(first.tooth)}`;
  const mention = toothMentions(text).find((item): item is Extract<Mention, { ok: true }> => item.ok);
  return mention ? mention.numberingLabel : null;
}

/**
 * Aplica el tipo de evolución al odontograma. Un control no vuelve a marcar lo que ya está registrado
 * (control de un implante que ya figura como implante = sin cambio). Si el odontograma no lo muestra,
 * queda propuesto pero sin marcar, con el aviso. Nada se borra de la ficha: solo se deja de proponer.
 */
export function applyEvolutionPolicy(proposal: DictationProposal, chart: StructureInput["chart"], text: string): DictationProposal {
  const current = new Map(chart.map((item) => [item.tooth, item.status] as const));
  const isImplant = (status: string | undefined) => status === "Implante" || status === "Implante con pilar";
  const notes: string[] = [];
  const mentioned = [...new Set(toothMentions(text).flatMap((item) => (item.ok ? [item.tooth] : [])))];
  const implantInChart = mentioned.some((tooth) => isImplant(current.get(tooth)));
  const kind = classifyEvolution(text, null, implantInChart);
  // Pilar protésico instalado o conectado hoy (el de cicatrización es transitorio y queda solo en la evolución).
  const pilarToday = kind.type === "implante-rehabilitacion" && kind.detail === "pilar";
  const pilarTeeth = pilarToday
    ? (mentioned.filter((tooth) => isImplant(current.get(tooth))).length ? mentioned.filter((tooth) => isImplant(current.get(tooth))) : mentioned.slice(0, 1))
    : [];
  const odontogram: OdontogramChange[] = [];
  for (const item of proposal.odontogram) {
    if (pilarTeeth.includes(item.tooth) && item.kind === "status" && item.status === "Implante") continue;
    if (item.kind === "status" && item.status && current.get(item.tooth) === item.status) {
      notes.push(`FDI ${formatFdi(item.tooth)} ya figura como ${item.status.toLowerCase()} en el odontograma: no se vuelve a marcar.`);
      continue;
    }
    if (item.kind === "status" && item.status === "Implante" && current.get(item.tooth) === "Implante con pilar") {
      const crownToo = proposal.odontogram.some((other) => other.tooth === item.tooth && other.kind === "crown" && other.foundation === "implant");
      notes.push(crownToo
        ? `FDI ${formatFdi(item.tooth)} figura como implante con pilar: al guardar la corona queda como implante con corona.`
        : `FDI ${formatFdi(item.tooth)} ya figura como implante con pilar en el odontograma: no se cambia.`);
      continue;
    }
    if (kind.type === "implante-control" && item.kind === "status" && item.status === "Implante") {
      odontogram.push({ ...item, advisory: `Es un control: el odontograma no muestra implante en FDI ${formatFdi(item.tooth)}. Márcalo solo si faltaba registrarlo.` });
      continue;
    }
    if (kind.type === "implante-rehabilitacion" && kind.detail !== "corona" && !pilarToday && item.kind === "status" && item.status === "Implante") {
      odontogram.push({ ...item, advisory: `Se instaló un pilar de cicatrización: queda en la evolución. Marca «Implante» solo si faltaba registrarlo.` });
      continue;
    }
    odontogram.push(item);
  }
  const pilarItems: OdontogramChange[] = [];
  for (const tooth of pilarTeeth) {
    const status = current.get(tooth);
    if (status === "Implante con pilar") {
      notes.push(`FDI ${formatFdi(tooth)} ya figura como implante con pilar en el odontograma: no se vuelve a marcar.`);
      continue;
    }
    const mention = toothMentions(text).find((item): item is Extract<Mention, { ok: true }> => item.ok && item.tooth === tooth);
    const sentence = sentences(text).find((line) => /pilar/i.test(line) && toothMentions(line).some((item) => item.ok && item.tooth === tooth))
      ?? sentences(text).find((line) => /pilar/i.test(line)) ?? text;
    const item: OdontogramChange = {
      id: `odo-pilar-${tooth}`,
      tooth,
      numbering: mention?.numbering ?? "FDI",
      numberingLabel: mention?.numberingLabel ?? `FDI ${formatFdi(tooth)}`,
      sourceText: clip(sentence, 400),
      evidence: clip(sentence, 400),
      origin: "reglas",
      kind: "status",
      status: "Implante con pilar",
    };
    pilarItems.push(status === "Implante"
      ? item
      : { ...item, advisory: `El odontograma no muestra implante en FDI ${formatFdi(tooth)}. Márcalo como implante con pilar solo si faltaba registrar el implante.` });
  }
  odontogram.unshift(...pilarItems);
  const finalKind = classifyEvolution(text, mainToothLabel(text, odontogram.length ? odontogram : proposal.odontogram), implantInChart);
  if (finalKind.type === "implante-rehabilitacion" && finalKind.detail === "pilar de cicatrización") {
    notes.push("Pilar de cicatrización: queda en la evolución. El estado «Implante con pilar» es para el pilar protésico.");
  }
  const changed = odontogram.length !== proposal.odontogram.length || odontogram.some((item) => item.advisory) || pilarItems.length > 0;
  const evolution = proposal.evolution ? { ...proposal.evolution, title: finalKind.title, ...(changed ? { body: replaceExamSection(proposal.evolution.body, odontogram.filter((item) => !item.advisory)) } : {}) } : null;
  return { ...proposal, odontogram, evolution, evolutionKind: finalKind, policyNotes: notes };
}

/** Motivo de la falla de la IA en palabras simples (el cupo diario gratuito de Workers AI se renueva a las 00:00 UTC). */
export function aiFailureReason(message: string): string {
  const text = message.replace(/\s+/g, " ");
  const openAi = /openai: OpenAI respondió HTTP (\d{3})/.exec(text);
  if (openAi || /openai:/.test(text)) {
    const base = aiFailureReason(text.replace(/;?\s*openai:.*$/, "")) ;
    const detail = `el respaldo OpenAI tampoco respondió${openAi ? ` (HTTP ${openAi[1]})` : ""}`;
    return /^(error|sin tiempo para la IA)$/.test(base) || !text.replace(/;?\s*openai:.*$/, "").trim() ? detail : `${base}; ${detail}`;
  }
  if (/\b4006\b|daily free allocation|neurons/i.test(text)) return "se agotó el cupo diario gratuito de Workers AI; se renueva a las 00:00 UTC (21:00 hora de Chile en horario de verano, 20:00 en invierno)";
  if (/tard[oó]|timeout|timed out/i.test(text)) return "la IA tardó demasiado en responder";
  return text.replace(/[«»"].*$/, "").trim().slice(0, 160) || "error";
}

export async function proposeFromTranscript(
  input: StructureInput,
  model: ClinicalModel | null,
  log: DictationLog = defaultDictationLog,
  options: { timeoutMs?: number; today?: string } = {},
): Promise<StructureOutcome> {
  const transcript = input.transcript.trim();
  if (transcript.length < 3) throw new Error("El dictado está vacío.");
  if (transcript.length > 8000) throw new Error("El dictado es demasiado largo para este prototipo.");
  const today = options.today ?? santiagoToday();
  // 1) Diccionario de errores típicos del reconocimiento de voz (mecial → mesial…).
  // y autocorrecciones dichas en voz alta («la 2.4, no, perdón, la 2.5» → «la 2.5»), visibles en «Texto corregido».
  // 0) Saludo y cierre («Hola, quiero evolucionar la ficha de…», «eso es todo») no van a la nota ni a la IA.
  const frame = stripDictationFrame(transcript);
  const dictionary = applyLexicon(frame.text);
  const selfFix = applySelfCorrections(dictionary.text);
  const lexicon = { text: selfFix.text, corrections: [...frame.corrections, ...dictionary.corrections, ...selfFix.corrections] };
  const fixed = lexicon.text;
  const localOnly = structureTranscript(fixed, { today });
  const withText = (proposal: DictationProposal, text: string, corrections: TranscriptCorrection[], aiDiagnoses: DiagnosisItem[] = []): DictationProposal => {
    // En la nota solo entran los diagnósticos no sugeridos; las equivalencias sugeridas esperan confirmación.
    const diagnoses = mergeDiagnoses(cariesDiagnoses(proposal.odontogram), textDiagnoses(text), aiDiagnoses);
    const doubts = [...lexiconDoubts(text), ...numberingDoubts(text, input.chart ?? []), ...vagueSurfaceClarifications(text)];
    const clarifications = tidyClarifications([...proposal.clarifications, ...doubts.filter((item) => !proposal.clarifications.includes(item))], proposal.odontogram);
    const evolution = proposal.evolution ? { ...proposal.evolution, body: withDiagnosesSection(proposal.evolution.body, diagnoses.filter((item) => !item.suggested)) } : null;
    const typed = applyEvolutionPolicy({ ...proposal, evolution, clarifications, diagnoses }, input.chart ?? [], text);
    const normalizedText = normalizeIdentityNumbers(text);
    const normalizedEvolution = typed.evolution ? normalizeIdentityNumbers(typed.evolution.body) : null;
    return withCatalogCodes({
      ...typed,
      ...(normalizedEvolution ? { evolution: { ...typed.evolution!, body: normalizedEvolution.text } } : {}),
      transcript,
      corrected: { text: normalizedText.text, corrections: [...corrections, ...normalizedText.corrections] },
      ...(frame.spokenName ? { spokenName: frame.spokenName } : {}),
    });
  };
  if (!model) return { engine: "reglas-locales", model: null, notice: LOCAL_NOTICE, proposal: withText(localOnly, fixed, lexicon.corrections) };
  const started = Date.now();
  try {
    const raw = await withTimeout(Promise.resolve(model.complete({ transcript: fixed, chart: input.chart })), options.timeoutMs ?? 50_000);
    const usedModel = isModelAnswer(raw) ? raw.usedModel : model.model;
    const aiNote = isModelAnswer(raw) && typeof raw.note === "string" && raw.note ? raw.note : undefined;
    const json = modelOutputToJson(isModelAnswer(raw) ? raw.output : raw);
    const aiText = json && typeof json === "object" && typeof (json as Record<string, unknown>).texto_corregido === "string" ? (json as Record<string, string>).texto_corregido : "";
    // 2) La corrección de la IA se acepta palabra por palabra solo si no cambia cifras ni términos clínicos.
    const reconciled = aiText.trim() ? reconcileCorrection(fixed, aiText) : { text: fixed, corrections: [] };
    const corrected = reconciled.text;
    const local = corrected === fixed ? localOnly : structureTranscript(corrected, { today });
    // Las citas de la IA pueden venir del texto corregido o de lo dictado.
    const haystack = [...new Set([corrected, fixed, transcript])].join("\n");
    const ai = validateAiExtraction(json, haystack, { today });
    const proposal = mergeProposals(ai, local, corrected);
    const aiMs = Date.now() - started;
    log("dictation.ai_ok", { model: usedModel, ms: aiMs, items: ai.odontogram.length, rejected: ai.rejected, corrections: reconciled.corrections.filter((item) => item.applied).length });
    return { engine: "ia+reglas", model: usedModel, notice: AI_NOTICE, proposal: withText(proposal, corrected, [...lexicon.corrections, ...reconciled.corrections], ai.diagnoses ?? []), aiMs, ...(aiNote ? { aiNote } : {}) };
  } catch (cause) {
    const aiMs = Date.now() - started;
    const reason = cause instanceof Error ? cause.message.replace(/\s+/g, " ").slice(0, 120) : "error";
    log("dictation.ai_failed", { model: model.model, ms: aiMs, reason: reason.replace(/[«»"].*$/, "") });
    const aiError = aiFailureReason(cause instanceof Error ? cause.message : String(cause));
    return { engine: "reglas-locales", model: null, notice: `${AI_FAILED_NOTICE} (${aiError}).`, aiError, proposal: withText(localOnly, fixed, lexicon.corrections), aiMs };
  }
}

export function reviewIssue(item: OdontogramChange): string | null {
  const normalized = coerceOdontogram(item);
  return "error" in normalized ? normalized.error : null;
}

export function parseDisplayedFdi(value: string): number | null {
  const match = value.trim().match(/^([1-8])\.([1-8])$/);
  if (!match) return null;
  const tooth = Number(match[1]) * 10 + Number(match[2]);
  return isValidFdi(tooth) ? tooth : null;
}

function statusOf(chart: ChartSnapshot, tooth: number): string {
  return chart.teeth[tooth] ?? chart.teeth[String(tooth) as unknown as number] ?? "Sin hallazgos";
}

function readTeeth(chart: ChartSnapshot): Map<number, string> {
  const teeth = new Map<number, string>();
  for (const [key, value] of Object.entries(chart.teeth ?? {})) teeth.set(Number(key), value);
  return teeth;
}

function cariesBeforeRestoration(item: OdontogramChange): SurfaceFinding | null {
  if (item.kind !== "surface" || !item.surface || item.finding?.condition !== "restored") return null;
  const source = item.sourceText;
  const treatmentAt = source.search(TREATED_RESTORATION);
  if (treatmentAt < 0 || !/\bcaries\b/i.test(source)) return null;
  const mentions = fdiMentionsWithIndex(source);
  if (mentions.length !== 1 || mentions[0].tooth !== item.tooth) return null;
  const beforeTreatment = source.slice(0, treatmentAt);
  const treatment = source.slice(treatmentAt);
  const diagnosisSurfaces = resolveDictatedSurfaces(beforeTreatment, item.tooth).surfaces;
  const treatmentSurfaces = resolveDictatedSurfaces(treatment, item.tooth).surfaces;
  const allSurfaces = resolveDictatedSurfaces(source, item.tooth).surfaces;
  if (diagnosisSurfaces.length && !diagnosisSurfaces.includes(item.surface)) return null;
  if (treatmentSurfaces.length && !treatmentSurfaces.includes(item.surface)) return null;
  if (!diagnosisSurfaces.length && !allSurfaces.includes(item.surface)) return null;
  const reading = cariesDepthFrom(source);
  return {
    condition: "caries",
    depth: reading.depth ?? null,
    icdas: (icdasFrom(source) ?? null) as SurfaceFinding["icdas"],
    activity: activityFrom(source),
  };
}

function surfaceHistoryTitle(item: OdontogramChange, finding: SurfaceFinding): string {
  const detail = describeFinding(item.tooth, finding, item.surface ? [item.surface] : []);
  const kind = finding.condition === "caries" ? "Diagnóstico" : finding.condition === "restored" ? "Tratamiento" : "Hallazgo";
  return kind + " · " + detail;
}

export function planChartWrites(patientId: number, before: ChartSnapshot, after: ChartSnapshot, accepted: OdontogramChange[]): ChartAction[] {
  const actions: ChartAction[] = [];
  const acceptedGeneral = new Map<number, string>();
  for (const item of accepted) {
    if (item.kind === "status" && item.status) acceptedGeneral.set(item.tooth, item.status);
    else if (item.kind === "crown" && item.foundation === "implant") {
      if (!acceptedGeneral.has(item.tooth)) acceptedGeneral.set(item.tooth, "Implante");
    } else if (item.kind === "crown") acceptedGeneral.set(item.tooth, "Corona");
  }
  const acceptedSurfaces = new Set(accepted.filter((item) => item.kind === "surface" && item.surface).map((item) => `${item.tooth}:${item.surface}`));
  const toothIds = new Set<number>([...readTeeth(before).keys(), ...readTeeth(after).keys(), ...accepted.map((item) => item.tooth)]);

  for (const tooth of [...toothIds].sort((a, b) => a - b)) {
    if (acceptedGeneral.has(tooth)) continue;
    const previous = statusOf(before, tooth);
    const current = statusOf(after, tooth);
    if (previous !== current) actions.push({ action: "setToothStatus", patientId, tooth, status: previous });
    const crown = before.crowns?.[tooth];
    if (crown && CROWN_MATERIALS.includes(crown.material as CrownMaterial) && ((previous === "Corona" && current !== "Corona") || (previous === "Implante" && crown.foundation === "implant" && current !== "Implante"))) {
      actions.push({ action: "setCrownDetails", patientId, tooth, material: crown.material, shade: crown.shade || "", foundation: crown.foundation === "implant" ? "implant" : "tooth" });
    }
  }

  for (const item of accepted) {
    if (item.kind === "crown" && item.foundation === "implant") {
      actions.push({ action: "setToothStatus", patientId, tooth: item.tooth, status: "Implante" });
      actions.push({ action: "setCrownDetails", patientId, tooth: item.tooth, material: item.material || "", shade: item.shade || "", foundation: "implant" });
      continue;
    }
    if (item.kind !== "status" && item.kind !== "crown") continue;
    const status = item.kind === "crown" ? "Corona" : item.status;
    if (!status) continue;
    actions.push({ action: "setToothStatus", patientId, tooth: item.tooth, status });
    if (item.missingReason && (status === "Ausente" || status === "Indicación de exodoncia")) {
      actions.push({ action: "setToothMissingReason", patientId, tooth: item.tooth, reason: item.missingReason });
    }
    if (status === "Corona" && item.material) {
      actions.push({ action: "setCrownDetails", patientId, tooth: item.tooth, material: item.material, shade: item.shade || "", foundation: "tooth" });
    }
  }

  const blocksSurfaces = (tooth: number) => {
    const status = acceptedGeneral.get(tooth) ?? statusOf(before, tooth);
    return status === "Implante" || status === "Implante con pilar" || status === "Ausente";
  };

  for (const tooth of [...toothIds].sort((a, b) => a - b)) {
    if (blocksSurfaces(tooth)) continue;
    const previous = before.surfaces?.[tooth] ?? before.surfaces?.[String(tooth) as unknown as number] ?? {};
    const current = after.surfaces?.[tooth] ?? after.surfaces?.[String(tooth) as unknown as number] ?? {};
    for (const surface of ODONTOGRAM_SURFACES) {
      if (acceptedSurfaces.has(`${tooth}:${surface}`)) continue;
      const prior = previous[surface];
      const next = current[surface];
      if (prior && JSON.stringify(prior) !== JSON.stringify(next ?? null)) {
        // Se restaura tal cual, incluida una caries antigua con ICDAS.
        const finding: SurfaceFinding = prior.condition === "caries"
          ? { condition: "caries", depth: prior.depth ?? null, icdas: prior.icdas ?? null, activity: prior.activity ?? null }
          : {
              condition: prior.condition, depth: null, icdas: null, activity: null,
              ...(prior.restorationStage ? { restorationStage: prior.restorationStage } : {}),
              ...(prior.restorationMaterial ? { restorationMaterial: prior.restorationMaterial } : {}),
            };
        actions.push({ action: "setToothSurface", patientId, tooth, surface, finding });
      }
    }
  }

  for (const item of accepted) {
    if (item.kind === "surface" && item.surface && item.finding && !blocksSurfaces(item.tooth)) {
      const priorCaries = cariesBeforeRestoration(item);
      if (priorCaries) {
        actions.push({
          action: "setToothSurface", patientId, tooth: item.tooth, surface: item.surface, finding: priorCaries,
          sourceActionId: item.id + ":diagnosis", historyTitle: surfaceHistoryTitle(item, priorCaries),
        });
      }
      const details = item.finding.condition === "restored" ? restorationDetailsFrom(item.sourceText) : null;
      const finalFinding: SurfaceFinding = item.finding.condition === "restored" ? {
        ...item.finding,
        restorationStage: details?.restorationStage ?? null,
        restorationMaterial: details?.restorationMaterial ?? null,
      } : item.finding;
      actions.push({
        action: "setToothSurface", patientId, tooth: item.tooth, surface: item.surface, finding: finalFinding,
        sourceActionId: item.id + ":state", historyTitle: surfaceHistoryTitle(item, finalFinding),
      });
    }
  }
  return actions;
}

export type SavedNote = { id?: number; patientId: number; title: string; body: string };
export type SavedBudget = { id?: number; patientId: number; title: string; items: { label: string; amount: number }[]; isAlternative?: boolean; parentBudgetId?: number | null };

export function verifyDictationSave(input: {
  patientId: number;
  before: ChartSnapshot;
  note: { id?: number; title: string; body: string } | null;
  accepted: OdontogramChange[];
  budgets: BudgetChange[];
  /** Id del plan guardado de cada presupuesto aceptado, en el mismo orden (varias prestaciones comparten plan). */
  savedBudgetIds?: Array<number | undefined>;
  payments?: { amount: number; method: string; savedId?: number }[];
  appointments?: { day: string; time: string; reason: string; savedId?: number }[];
  perio?: { examId?: number; readings: { tooth: number; site: PerioSite; depth: number; bleeding: boolean; suppuration: boolean }[]; mobility: { tooth: number; grade: string }[] } | null;
}, snapshot: {
  notes: SavedNote[];
  budgets: SavedBudget[];
  toothStatuses: Record<number, ChartSnapshot | undefined>;
  payments?: { id: number; patientId: number; amount: number; method: string }[];
  appointments?: { id: number; patientId: number; day: string; time: string; reason: string }[];
  periodontalExams?: Record<number, { id: number; teeth: Record<number, { sites?: Partial<Record<PerioSite, { depth: number | null; bleeding: boolean; suppuration: boolean }>>; mobility?: string }> }[] | undefined>;
}): { ok: boolean; messages: string[] } {
  const messages: string[] = [];
  const errors: string[] = [];
  if (input.note) {
    const found = snapshot.notes.find((note) => note.patientId === input.patientId && (input.note?.id ? note.id === input.note.id : note.title === input.note?.title && note.body === input.note?.body));
    if (!found || found.title !== input.note.title || found.body !== input.note.body) errors.push("La evolución releída no coincide con el texto confirmado.");
    else messages.push("Evolución releída y coincide con el texto confirmado.");
  }
  const chart = snapshot.toothStatuses[input.patientId] ?? { teeth: {}, surfaces: {} };
  const acceptedStatus = new Map<number, string>();
  for (const item of input.accepted) {
    if (item.kind === "status" && item.status) acceptedStatus.set(item.tooth, item.status);
    if (item.kind === "crown" && item.foundation === "implant") {
      if (!acceptedStatus.has(item.tooth)) acceptedStatus.set(item.tooth, "Implante");
    } else if (item.kind === "crown") acceptedStatus.set(item.tooth, "Corona");
  }
  const toothIds = new Set<number>([...readTeeth(input.before).keys(), ...readTeeth(chart).keys(), ...acceptedStatus.keys()]);
  for (const tooth of toothIds) {
    const actual = statusOf(chart, tooth);
    const expected = acceptedStatus.get(tooth) ?? statusOf(input.before, tooth);
    if (actual !== expected) errors.push(`FDI ${formatFdi(tooth)} quedó «${actual}» y se esperaba «${expected}».`);
  }
  const checkedSurfaces = new Map<string, string>();
  for (const item of input.accepted) {
    if (item.kind === "crown" && item.material) {
      const crown = chart.crowns?.[item.tooth];
      if (!crown || crown.material !== item.material || (crown.shade || "") !== (item.shade || "") || (item.foundation === "implant" && crown.foundation !== "implant") || (item.foundation !== "implant" && crown.foundation === "implant")) errors.push(`La corona de FDI ${formatFdi(item.tooth)} no coincide al releer.`);
      else messages.push(`Corona FDI ${formatFdi(item.tooth)}: ${item.material}.`);
    }
    if (item.kind === "surface" && item.surface && item.finding) {
      const key = `${item.tooth}:${item.surface}`;
      const signature = [item.finding.condition, item.finding.depth ?? "", item.finding.icdas ?? "", item.finding.activity ?? ""].join(":");
      const previous = checkedSurfaces.get(key);
      if (previous === "conflict") continue;
      if (previous !== undefined) {
        if (previous !== signature) {
          checkedSurfaces.set(key, "conflict");
          errors.push(`Hay más de una propuesta aceptada para la superficie ${item.surface} de FDI ${formatFdi(item.tooth)}. Elige una sola.`);
        }
        continue;
      }
      checkedSurfaces.set(key, signature);
      const actual = chart.surfaces?.[item.tooth]?.[item.surface];
      if (!actual || actual.condition !== item.finding.condition || (actual.depth ?? null) !== (item.finding.depth ?? null) || (actual.icdas ?? null) !== (item.finding.icdas ?? null) || (actual.activity ?? null) !== (item.finding.activity ?? null)) {
        errors.push(`La superficie ${item.surface} de FDI ${formatFdi(item.tooth)} no coincide al releer.`);
      } else messages.push(`Superficie ${item.surface} de FDI ${formatFdi(item.tooth)} confirmada.`);
    }
    if ((item.kind === "status" || item.kind === "crown") && !errors.some((error) => error.includes(formatFdi(item.tooth)))) {
      messages.push(`FDI ${formatFdi(item.tooth)}: ${acceptedStatus.get(item.tooth)}.`);
    }
  }
  input.budgets.forEach((item, index) => {
    const savedId = input.savedBudgetIds?.[index];
    const found = snapshot.budgets.find((budget) => budget.patientId === input.patientId && (savedId ? budget.id === savedId : budget.title === item.title && budget.items.some((line) => line.label === item.label && line.amount === item.amount)));
    const line = found?.items.find((entry) => entry.label === item.label && entry.amount === item.amount);
    if (!found || !line) errors.push(`El presupuesto «${item.label}» no aparece al releer.`);
    else messages.push(`Presupuesto «${item.label}» releído.`);
  });
  for (const item of input.payments ?? []) {
    const label = `$${item.amount.toLocaleString("es-CL")}`;
    const found = (snapshot.payments ?? []).find((pay) => pay.patientId === input.patientId && (item.savedId ? pay.id === item.savedId : pay.amount === item.amount && pay.method === item.method));
    if (!found || found.amount !== item.amount || found.method !== item.method) errors.push(`El pago de ${label} no aparece al releer.`);
    else messages.push(`Pago de ${label} releído.`);
  }
  for (const item of input.appointments ?? []) {
    const shown = item.day.split("-").reverse().join("-");
    const found = (snapshot.appointments ?? []).find((visit) => visit.patientId === input.patientId && (item.savedId ? visit.id === item.savedId : visit.day === shown && visit.time === item.time));
    if (!found || found.day !== shown || found.time !== item.time || found.reason !== item.reason) errors.push(`La cita del ${shown} ${item.time} no aparece al releer.`);
    else messages.push(`Cita del ${shown} a las ${item.time} releída.`);
  }
  if (input.perio && (input.perio.readings.length || input.perio.mobility.length)) {
    const exams = snapshot.periodontalExams?.[input.patientId] ?? [];
    const exam = input.perio.examId ? exams.find((entry) => entry.id === input.perio?.examId) : exams[0];
    const okReadings = exam && input.perio.readings.every((reading) => {
      const site = exam.teeth[reading.tooth]?.sites?.[reading.site];
      return site && site.depth === reading.depth && site.bleeding === reading.bleeding && site.suppuration === reading.suppuration;
    });
    const okMobility = exam && input.perio.mobility.every((item) => (exam.teeth[item.tooth]?.mobility ?? "") === item.grade);
    if (!okReadings || !okMobility) errors.push("El sondaje dictado no coincide al releer el periodontograma.");
    else messages.push(`Periodontograma releído: ${input.perio.readings.length} sitio(s)${input.perio.mobility.length ? ` y ${input.perio.mobility.length} movilidad(es)` : ""}.`);
  }
  if (!errors.length && !messages.length) messages.push("No había cambios aceptados para guardar.");
  return { ok: errors.length === 0, messages: [...messages, ...errors] };
}

/** Frase citada entre «…» en una aclaración, sin el recorte final. */
export function clarificationQuote(question: string): string {
  const match = question.match(/«([^»]+)»/);
  return match ? match[1].replace(/…$/, "").trim() : "";
}

/**
 * Convierte las respuestas del profesional en líneas «Aclaración: <frase>: <respuesta>.»
 * que se agregan al texto y se vuelven a interpretar. Las respuestas vacías se omiten.
 */
export function answerLines(answers: { question: string; answer: string }[]): string[] {
  const lines: string[] = [];
  for (const { question, answer } of answers) {
    const clean = answer.replace(/\s+/g, " ").trim().replace(/[.。]+$/, "");
    if (!clean) continue;
    const quote = clarificationQuote(question).replace(/[:.]+$/, "");
    lines.push(quote ? `Aclaración: ${quote}: ${clean}.` : `Aclaración: ${clean}.`);
  }
  return lines;
}

/** Agrega las líneas de aclaración al texto revisado (sin repetir las ya presentes). */
export function withAnswers(text: string, lines: string[]): string {
  const base = text.trim();
  const fresh = lines.filter((line) => !base.includes(line));
  return fresh.length ? `${base}\n${fresh.join("\n")}` : base;
}

/** Examen periodontal nuevo con solo los sitios y movilidades dictados y aceptados. */
export function buildDictatedPerio(
  readings: { tooth: number; site: PerioSite; depth: number; bleeding: boolean; suppuration: boolean }[],
  mobility: { tooth: number; grade: string }[],
): Record<number, { sites: Partial<Record<PerioSite, { depth: number; margin: null; bleeding: boolean; suppuration: boolean }>>; mobility: string; furcation: string }> {
  const teeth: Record<number, { sites: Partial<Record<PerioSite, { depth: number; margin: null; bleeding: boolean; suppuration: boolean }>>; mobility: string; furcation: string }> = {};
  const entry = (tooth: number) => (teeth[tooth] ??= { sites: {}, mobility: "", furcation: "" });
  for (const reading of readings) entry(reading.tooth).sites[reading.site] = { depth: reading.depth, margin: null, bleeding: reading.bleeding, suppuration: reading.suppuration };
  for (const item of mobility) entry(item.tooth).mobility = item.grade;
  return teeth;
}

/**
 * «Falta: …» breve y opcional para la revisión. Nunca bloquea el guardado ni pide la ficha completa:
 * prioriza dinero (presupuesto/pagos), lo que se hará (plan) y los hallazgos; la próxima cita va al final.
 */
export function missingData(proposal: DictationProposal): string[] {
  const body = proposal.evolution?.body ?? "";
  const money = proposal.budget.length > 0 || (proposal.payments?.length ?? 0) > 0 || /^(?:Presupuesto|Pagos)$/m.test(body);
  const plan = proposal.budget.length > 0 || (proposal.procedures?.length ?? 0) > 0 || /^(?:Plan de tratamiento|Procedimientos realizados|Indicaciones)$/m.test(body);
  const findings = proposal.odontogram.length > 0 || (proposal.incomplete?.length ?? 0) > 0 || (proposal.diagnoses?.length ?? 0) > 0 || proposal.perio.length > 0 || /^(?:Otros hallazgos del examen|Diagnóstico|Sondaje)$/m.test(body);
  const next = (proposal.appointments?.length ?? 0) > 0 || /^Próxima cita$/m.test(body);
  const missing: string[] = [];
  if (!money) missing.push("Valores: ¿hubo presupuesto o pago?");
  if (!plan) missing.push("Plan: ¿qué se hará y en qué pieza?");
  if (!findings) missing.push("Hallazgos: ¿alguna pieza con hallazgo (fracturada, caries y su profundidad, etc.)?");
  if (!next) missing.push("Próxima cita: ¿cuándo vuelve?");
  return missing;
}
