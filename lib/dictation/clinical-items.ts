/**
 * Lista clínica estructurada: cada pieza con lo que se ENCONTRÓ (diagnóstico), lo que se PLANIFICA (plan) y lo que se
 * HIZO hoy (realizado). Es la fuente única con la que se reconcilian el odontograma, el arancel y los diagnósticos:
 * - realizado → estado hecho en el odontograma y prestación del arancel;
 * - plan → nunca se marca como hecho (queda en el plan, a la vista en el resumen);
 * - diagnóstico → hallazgo y, si falta, un CIE-11 sugerido sin marcar.
 * La IA entrega la lista («lista_clinica»); las reglas la reconstruyen del dictado de forma determinista y ambas se unen.
 * Lo que no calza entre la nota y la lista queda como aviso para que el profesional decida (nada incierto se aplica solo).
 */
import type { DiagnosisItem, DictationProposal, OdontogramChange, OdontogramSurface, ToothStatus } from "./proposal.ts";
import type { PrestacionItem } from "./prestaciones.ts";
import { prestacionByCode } from "../prestaciones-catalog.ts";
import { ICD11 } from "../icd11.ts";

export const ITEM_KINDS = ["diagnostico", "plan", "realizado"] as const;
export const ITEM_CATEGORIES = [
  "exodoncia", "implante", "pilar", "corona", "puente", "protesis", "obturacion", "endodoncia", "destartraje", "escaneo",
  "sellante", "ausente", "caries", "movilidad", "fractura", "lesion_apical", "otro",
] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export type ItemCategory = typeof ITEM_CATEGORIES[number];

export type ClinicalItem = {
  id: string;
  /** FDI (36 = 3.6) o null si no hay pieza (p. ej. «escaneo de cinco implantes»). */
  tooth: number | null;
  /** Numeración chilena equivalente (1–32), si existe. */
  chile: number | null;
  surfaces: OdontogramSurface[];
  kind: ItemKind;
  category: ItemCategory;
  what: string;
  /** Grado de movilidad (I–III) cuando la categoría es movilidad. */
  grade?: "I" | "II" | "III";
  arancel?: string;
  cie11?: string;
  evidence: string;
  origin: "ia" | "reglas" | "ia+reglas";
};

/** Herramientas de proposal.ts (se inyectan para no crear un ciclo de importaciones). */
export type ItemTools = {
  sentences: (text: string) => string[];
  teethIn: (sentence: string) => number[];
  isPlan: (sentence: string) => boolean;
  formatFdi: (tooth: number) => string;
};

// ── Numeración ──────────────────────────────────────────────────────────────────────────────────
const CHILE_ORDER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const fdiToChile = (tooth: number): number | null => { const at = CHILE_ORDER.indexOf(tooth); return at >= 0 ? at + 1 : null; };
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

/** «de la 1.4 a la 1.6», «piezas 4.4 a 4.6», «desde la 12 hasta la 14»: todas las piezas del tramo, en la misma arcada. */
export function expandRange(from: number, to: number): number[] {
  for (const arch of [UPPER, LOWER]) {
    const a = arch.indexOf(from);
    const b = arch.indexOf(to);
    if (a < 0 || b < 0) continue;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    if (hi - lo > 15) return [];
    return arch.slice(lo, hi + 1);
  }
  return [];
}

// ── Lectura de categorías y tipo ────────────────────────────────────────────────────────────────
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const CATEGORY_RULES: Array<[ItemCategory, RegExp]> = [
  ["exodoncia", /(?<![a-z])(?:exodoncia|extraccion|se\s+extra(?:e|jo|jeron|en)|extraid[oa]s?|avulsion)(?![a-z])/],
  ["pilar", /(?<![a-z])(?:conexion\s+(?:de(?:l)?\s+)?implantes?|se\s+conecta|minipilar|multi\s*unit|pilar(?:es)?(?!\s+de\s+cicatrizacion)|conectad[oa])(?![a-z])/],
  ["implante", /(?<![a-z])(?:implantes?)(?![a-z])/],
  ["corona", /(?<![a-z])coronas?(?![a-z])/],
  ["puente", /(?<![a-z])(?:puentes?|protesis\s+fija\s+plural)(?![a-z])/],
  ["protesis", /(?<![a-z])(?:protesis|rehabilita\w*)(?![a-z])/],
  ["obturacion", /(?<![a-z])(?:obtura\w*|restaura(?:cion|ciones|r|do|da)|resina|composite|amalgama|ionomero)(?![a-z])/],
  ["endodoncia", /(?<![a-z])(?:endodoncia|tratamiento\s+de\s+conductos?|pulpectomia|pulpotomia|biopulpectomia|necropulpectomia)(?![a-z])/],
  ["destartraje", /(?<![a-z])(?:destartraje|detartraje|pulido\s+radicular|raspado|profilaxis)(?![a-z])/],
  ["escaneo", /(?<![a-z])(?:escane\w*|scan\s*body|scanbody|escaner\s+intraoral)(?![a-z])/],
  ["sellante", /(?<![a-z])sellantes?(?![a-z])/],
  ["ausente", /(?<![a-z])(?:ausente|ausencia|perdida\s+(?:de\s+la\s+pieza|dentaria))(?![a-z])/],
  ["caries", /(?<![a-z])(?:caries|lesion\s+cariosa)(?![a-z])/],
  ["movilidad", /(?<![a-z])movilidad(?![a-z])/],
  ["fractura", /(?<![a-z])(?:fractur\w*|fisura\w*)(?![a-z])/],
  ["lesion_apical", /(?<![a-z])(?:absceso|granuloma|quiste\s+apical|periodontitis\s+apical|lesion\s+apical)(?![a-z])/],
];

/** Verbos de algo hecho HOY (incluye el sustantivo de procedimiento al inicio de la frase, típico de la sección «Procedimientos»). */
const DONE = /(?<![a-z])(?<!no\s)(?<!no\sse\s)(?:se\s+(?:le\s+)?(?:realiza|realizo|realizan|hace|hizo|efectua|efectuo|instala|instalo|instalan|coloca|coloco|colocan|conecta|conecto|conectan|cementa|cemento|cementan|obtura|obturo|obturan|restaura|restauro|restauran|extrae|extrajo|extraen|retira|retiran|entrega|toma|escanea|escaneo|escanean|sella|sellan|aplica|aplican|atornilla)|realizad[oa]s?|instalad[oa]s?|efectuad[oa]s?|extraid[oa]s?|cementad[oa]s?|hoy|(?:procede|procedemos|se\s+procede)\s+a\s+(?:instalar|colocar|extraer|realizar|obturar|cementar|conectar))(?![a-z])/;
const DONE_NOUN_START = /^(?:procedimientos?(?:\s+realizados?)?\s*:\s*)?(?:conexion|escaneo|destartraje|detartraje|obturacion|instalacion|cementacion|endodoncia|profilaxis|pulido|raspado|toma\s+de)(?![a-z])/;
const PLAN = /(?<![a-z])(?:se\s+planifica\w*|planifica\w*|se\s+plantea|se\s+propone|se\s+sugiere|se\s+indica|se\s+programa|se\s+evaluara|se\s+considerara|plan(?:\s+de\s+tratamiento)?\s*:|proxim[ao]s?|siguiente\s+sesion|pendiente|a\s+futuro|presupuest\w*|costo|valor|precio|\d[\d.]*\s+pesos|se\s+realizara|se\s+hara|se\s+instalara|queda\s+por|por\s+realizar|requiere|necesita|debe\s+(?:realizarse|hacerse))(?![a-z])/;
/** Infinitivo de acción al inicio de una frase del plan («rehabilitar…», «cortar y unir…»). */
const PLAN_INFINITIVE_START = /^(?:plan\s*:\s*)?(?:rehabilitar|realizar|instalar|colocar|extraer|obturar|cementar|confeccionar|evaluar|controlar|cortar|unir|tomar|hacer)(?![a-z])/;
const FINDING = /(?<![a-z])(?:se\s+observa\w*|presenta\w*|se\s+evidencia|se\s+detecta|se\s+aprecia|examen|al\s+examen|movilidad|ausente|caries|fractur\w*|dolor|sensibilidad)(?![a-z])/;
const HEADER = /^(motivo(?:\s+de\s+consulta)?|anamnesis(?:\s+y\s+antecedentes)?|examen(?:\s+\(odontograma\))?|diagnosticos?(?:\s+\(cie-11\))?|procedimientos?(?:\s+realizados?)?|plan(?:\s+de\s+tratamiento)?|indicaciones|presupuesto|otros\s+dichos|pendiente\s+de\s+aclarar|sondaje|alergias|medicamentos)(?![a-z])\s*:?\s*/;

type Section = "relato" | "examen" | "procedimientos" | "plan" | null;
function sectionOf(header: string): Section {
  if (/^(motivo|anamnesis|alergias|medicamentos)/.test(header)) return "relato";
  if (/^(examen|diagnostic|sondaje)/.test(header)) return "examen";
  if (/^procedimiento/.test(header)) return "procedimientos";
  if (/^plan/.test(header)) return "plan";
  return null;
}

/** «No se realiza la exodoncia…», «finalmente no se instaló»: lo que no se hizo queda pendiente (plan), nunca realizado. */
const NOT_DONE = /(?<![a-z])(?:no|nunca)\s+(?:se\s+)?(?:le\s+)?(?:realiz|hace|hizo|efectu|instal|coloc|conect|cement|obtur|restaur|extra|extrajo|sell|aplic)\w*/;

export function kindOf(sentence: string, section: Section, isPlan: (s: string) => boolean): ItemKind | null {
  const plain = fold(sentence).trim();
  if (NOT_DONE.test(plain)) return "plan";
  const done = DONE.test(plain) || DONE_NOUN_START.test(plain);
  const plan = PLAN.test(plain) || PLAN_INFINITIVE_START.test(plain) || isPlan(sentence);
  if (plan && !done) return "plan";
  // «Se obtura la 14 y se planifica…» se separa antes; si una frase trae ambos, manda lo hecho solo si el plan no la abre.
  if (plan && done) return /^(?:plan\s*:\s*)?(?:se\s+planifica|se\s+plantea|proxim|se\s+indica)/.test(plain) || PLAN_INFINITIVE_START.test(plain) ? "plan" : "realizado";
  if (done) return "realizado";
  if (section === "plan") return "plan";
  if (section === "procedimientos") return "realizado";
  if (section === "relato") return null;
  if (FINDING.test(plain) || section === "examen") return "diagnostico";
  return "diagnostico";
}

const GRADE = /movilidad(?:\s+dentaria)?(?:\s+de)?\s+(?:grado\s+)?(iii|ii|i|3|2|1|tres|dos|uno)(?![a-z0-9])/;
function gradeOf(plain: string): "I" | "II" | "III" | undefined {
  const raw = GRADE.exec(plain)?.[1];
  if (!raw) return undefined;
  return ({ i: "I", "1": "I", uno: "I", ii: "II", "2": "II", dos: "II", iii: "III", "3": "III", tres: "III" } as const)[raw as "i"];
}

function categoriesOf(plain: string): ItemCategory[] {
  const found = CATEGORY_RULES.filter(([, re]) => re.test(plain)).map(([category]) => category);
  // «conexión de implante», «implante con minipilar»: es el pilar, no un implante nuevo.
  if (found.includes("pilar") && found.includes("implante") && !/(?:instala|coloca)\w*\s+(?:un\s+|el\s+|los\s+|dos\s+|tres\s+)?implantes?|implantes?\s+(?:instalad|colocad)/.test(plain)) found.splice(found.indexOf("implante"), 1);
  // Lo que se extrae no está «ausente» como hallazgo aparte; una prótesis sobre un puente es el puente.
  if (found.includes("exodoncia") && found.includes("ausente")) found.splice(found.indexOf("ausente"), 1);
  if (found.includes("puente") && found.includes("protesis")) found.splice(found.indexOf("protesis"), 1);
  return found;
}

const FINDING_CATEGORIES: ReadonlySet<ItemCategory> = new Set(["caries", "movilidad", "fractura", "lesion_apical", "ausente"]);

/** Frases mixtas («se obtura la 14 y se planifica endodoncia de la 19») se separan en actos independientes. */
function splitActs(sentence: string): string[] {
  return sentence.split(/\s*(?:;|,\s+(?=(?:por\s+ahora|por\s+el\s+momento|hoy|ahora|en\s+esta\s+sesi[oó]n)\b)|,?\s+y\s+(?=se\s)|,\s+(?=se\s+(?:planifica|plantea|indica|realiza|extrae|obtura|instala)))\s*/iu).map((part) => part.trim()).filter(Boolean);
}

/** Rangos «de la 1.4 a la 1.6» / «piezas 12 a 14»: piezas intermedias que toothMentions no ve. */
function rangeTeeth(sentence: string, teethIn: (s: string) => number[]): number[] {
  const out: number[] = [];
  for (const match of sentence.matchAll(/(?:de(?:sde)?\s+(?:la\s+)?(?:pieza\s+)?|piezas\s+)(\d{1,2}(?:\.\d)?)\s+(?:a|hasta)\s+(?:la\s+)?(?:pieza\s+)?(\d{1,2}(?:\.\d)?)/giu)) {
    const a = teethIn(`pieza ${match[1]}`)[0];
    const b = teethIn(`pieza ${match[2]}`)[0];
    if (a && b) out.push(...expandRange(a, b));
  }
  return out;
}

let counter = 0;
const nextId = () => `it-${++counter}`;

function makeItem(partial: Omit<ClinicalItem, "id" | "chile">): ClinicalItem {
  return { id: nextId(), chile: partial.tooth ? fdiToChile(partial.tooth) : null, ...partial };
}

/**
 * Lista clínica por reglas, leída del dictado (o de la nota) frase por frase: un elemento por pieza y por acto.
 * «piezas 20 y 21» → dos elementos; una frase sin pieza hereda la pieza anterior solo para actos de una superficie.
 */
export function ruleItems(text: string, tools: ItemTools): ClinicalItem[] {
  const items: ClinicalItem[] = [];
  let section: Section = null;
  let lastTeeth: number[] = [];
  for (const raw of tools.sentences(text)) {
    let sentence = raw;
    const header = HEADER.exec(fold(sentence));
    if (header) {
      const next = sectionOf(header[1]);
      if (next) section = next;
      sentence = sentence.slice(header[0].length).trim();
      if (!sentence) continue;
    }
    let sibling: number[] = [];
    for (const part of splitActs(sentence)) {
      const plain = fold(part);
      const kind = kindOf(part, section, tools.isPlan);
      let teeth = [...new Set([...tools.teethIn(part), ...rangeTeeth(part, tools.teethIn)])];
      // «Se extrae la 2.1 y se instala un implante inmediato»: la segunda parte comparte la pieza de la primera.
      if (!teeth.length && sibling.length) teeth = sibling;
      if (teeth.length) sibling = teeth;
      if (!kind) continue;
      const categories = categoriesOf(plain);
      if (!teeth.length && categories.some((c) => ["caries", "obturacion", "endodoncia", "corona", "sellante"].includes(c)) && lastTeeth.length === 1 && !/\b(?:dos|tres|cuatro|cinco|seis|varios|todos|ambos)\b/.test(plain)) teeth = lastTeeth;
      if (tools.teethIn(part).length) lastTeeth = teeth;
      if (!categories.length) {
        // Pieza nombrada sin acto reconocible: se registra igual para que la nota y la lista se puedan comparar.
        for (const tooth of teeth) items.push(makeItem({ tooth, surfaces: [], kind, category: "otro", what: part, evidence: part, origin: "reglas" }));
        continue;
      }
      for (const category of categories) {
        // Un hallazgo dentro de una frase de plan o de acto («obturación por caries») es diagnóstico.
        const itemKind: ItemKind = FINDING_CATEGORIES.has(category) && kind !== "diagnostico" && categories.some((c) => !FINDING_CATEGORIES.has(c)) ? "diagnostico" : kind;
        const grade = category === "movilidad" ? gradeOf(plain) : undefined;
        const targets: Array<number | null> = teeth.length ? teeth : [null];
        for (const tooth of targets) items.push(makeItem({ tooth, surfaces: [], kind: itemKind, category, what: part, evidence: part, origin: "reglas", ...(grade ? { grade } : {}) }));
      }
    }
  }
  return dedupe(items);
}

const sameKey = (a: ClinicalItem, b: ClinicalItem) => a.tooth === b.tooth && a.category === b.category && a.kind === b.kind;

function dedupe(items: ClinicalItem[]): ClinicalItem[] {
  const out: ClinicalItem[] = [];
  for (const item of items) {
    const twin = out.find((done) => sameKey(done, item));
    if (!twin) { out.push(item); continue; }
    if (!twin.grade && item.grade) twin.grade = item.grade;
  }
  return out;
}

/** Une la lista de la IA con la de reglas: coincidencias quedan «ia+reglas»; lo de una sola fuente conserva su origen. */
export function mergeItems(ai: ClinicalItem[], rules: ClinicalItem[]): ClinicalItem[] {
  const out: ClinicalItem[] = rules.map((item) => ({ ...item }));
  for (const item of ai) {
    const twin = out.find((done) => sameKey(done, item) || (done.tooth === item.tooth && done.kind === item.kind && compatible(done.category, item.category)));
    if (twin) {
      twin.origin = twin.origin === "reglas" ? "ia+reglas" : twin.origin;
      if (item.arancel && !twin.arancel) twin.arancel = item.arancel;
      if (item.cie11 && !twin.cie11) twin.cie11 = item.cie11;
      if (item.surfaces.length && !twin.surfaces.length) twin.surfaces = item.surfaces;
      if (item.grade && !twin.grade) twin.grade = item.grade;
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

function compatible(a: ItemCategory, b: ItemCategory): boolean {
  if (a === b) return true;
  const groups: ItemCategory[][] = [["implante", "pilar"], ["exodoncia", "ausente"], ["puente", "protesis", "corona"]];
  return groups.some((group) => group.includes(a) && group.includes(b));
}

// ── Reconciliación con la propuesta ─────────────────────────────────────────────────────────────
const STATUS_CATEGORIES: Partial<Record<ToothStatus, ItemCategory[]>> = {
  Implante: ["implante", "pilar"],
  "Implante con pilar": ["pilar", "implante"],
  Corona: ["corona", "puente", "protesis"],
  Ausente: ["exodoncia", "ausente"],
  "Indicación de exodoncia": ["exodoncia"],
  "Resto radicular con endodoncia": ["endodoncia"],
};

function changeCategories(change: OdontogramChange): ItemCategory[] | null {
  if (change.kind === "crown") return ["corona", "puente", "protesis"];
  if (change.kind === "surface") {
    const condition = change.finding?.condition;
    if (condition === "restored" || condition === "other_restoration") return ["obturacion", "caries"];
    if (condition === "caries") return ["caries", "obturacion"];
    if (condition === "sealant") return ["sellante"];
    return null;
  }
  return STATUS_CATEGORIES[change.status as ToothStatus] ?? null;
}

const RULES_ONLY = /^Solo las reglas detectaron/;
const isLesion = (status: string | undefined) => !status || !(status in STATUS_CATEGORIES);
const fdi = (tools: ItemTools, tooth: number) => `FDI ${tools.formatFdi(tooth)}${fdiToChile(tooth) ? ` (Chile ${fdiToChile(tooth)})` : ""}`;

const PER_TOOTH_PRESTACION: Partial<Record<ItemCategory, { name: RegExp; code: string }>> = {
  exodoncia: { name: /EXODONCIA|EXTRACCION/, code: "5003001" },
  pilar: { name: /CONEXION DE IMPLANTE|PILAR/, code: "5011052" },
  implante: { name: /INSTALACION DE IMPLANTE/, code: "5011001" },
};

export type ItemsContext = {
  /** Texto dictado (corregido): de aquí salen las reglas. */
  text: string;
  /** Lista que entregó la IA (vacía si no hubo IA o si el modelo no la trajo). */
  aiItems?: ClinicalItem[];
  chart?: { tooth: number; status: string }[];
};

/**
 * Hace que el odontograma, el arancel y los diagnósticos salgan de la lista clínica:
 * - un estado hecho que solo está PLANIFICADO se saca del odontograma (queda como plan, a la vista);
 * - un estado que contradice lo dictado para esa pieza («extracción» y la app puso implante) queda sin marcar, con aviso;
 * - lo REALIZADO que falta (exodoncia → ausente; implante o pilar en cada pieza nombrada) se agrega;
 * - cada pieza tratada tiene su prestación (una por pieza), y la exodoncia lleva su pieza;
 * - movilidad grado II–III sin diagnóstico → CIE-11 sugerido (sin marcar).
 * Devuelve también los avisos de coherencia entre la nota y la lista.
 */
export function applyClinicalItems(proposal: DictationProposal, ctx: ItemsContext, tools: ItemTools): DictationProposal {
  const rules = ruleItems(ctx.text, tools);
  const items = mergeItems(ctx.aiItems ?? [], rules);
  const warnings: string[] = [];
  const nonPlan = (tooth: number) => items.filter((item) => item.tooth === tooth && item.kind !== "plan");
  const plans = (tooth: number) => items.filter((item) => item.tooth === tooth && item.kind === "plan");
  const doneOf = (tooth: number, category: ItemCategory) => items.some((item) => item.tooth === tooth && item.kind === "realizado" && item.category === category);
  const chartStatus = new Map((ctx.chart ?? []).map((entry) => [entry.tooth, entry.status]));
  const planned: ClinicalItem[] = [];

  // 1) Odontograma: cada cambio debe estar respaldado por un elemento no planificado de su pieza.
  const odontogram: OdontogramChange[] = [];
  const inNote = new Set(noteTeeth(proposal.evolution?.body ?? "", tools));
  const aiTeeth = new Set((ctx.aiItems ?? []).flatMap((item) => (item.tooth ? [item.tooth] : [])));
  for (const change of proposal.odontogram) {
    const cats = changeCategories(change);
    if (!cats) { odontogram.push(change); continue; }
    const support = nonPlan(change.tooth);
    const backed = support.some((item) => cats.includes(item.category) || item.category === "otro" && support.every((other) => other.category === "otro"));
    // Implante inmediato en otra frase sin pieza («se instala en el alvéolo un implante»): no se quita.
    const implantPlaced = items.some((item) => (item.tooth === change.tooth || item.tooth === null) && item.kind !== "plan" && item.category === "implante");
    const extracted = change.kind === "status" && change.status !== "Ausente" && change.status !== "Indicación de exodoncia" && !isLesion(change.status) && doneOf(change.tooth, "exodoncia") && !implantPlaced;
    if (extracted) {
      warnings.push(`${fdi(tools, change.tooth)}: se extrajo hoy; no se marca «${(change.status ?? "").toLowerCase()}».`);
      continue;
    }
    if (change.advisory) {
      // «Solo las reglas lo vieron»: si la lista lo respalda y la nota de la IA nombra la pieza, la IA sí lo vio.
      if (backed && RULES_ONLY.test(change.advisory) && (inNote.has(change.tooth) || aiTeeth.has(change.tooth))) {
        const rest = { ...change };
        delete rest.advisory;
        odontogram.push(rest);
        warnings.push(`${fdi(tools, change.tooth)}: la nota y la lista clínica la incluyen; queda propuesta.`);
      } else odontogram.push(change);
      continue;
    }
    if (backed) { odontogram.push(change); continue; }
    const plannedHere = plans(change.tooth).filter((item) => cats.includes(item.category));
    if (plannedHere.length && change.status !== "Indicación de exodoncia") {
      planned.push(...plannedHere.filter((item) => !planned.includes(item)));
      warnings.push(`${fdi(tools, change.tooth)}: ${plannedHere[0].category} está planificado, no realizado; no se marca como hecho en el odontograma.`);
      continue;
    }
    if (support.length) {
      odontogram.push({ ...change, advisory: `No calza con lo dictado para esta pieza (${[...new Set(support.map((item) => item.category))].join(", ")}). Márcalo solo si corresponde.` });
      continue;
    }
    // Sin ninguna mención de la pieza: si vino de la IA, queda sin marcar; si vino de las reglas, se respeta.
    if (change.origin === "ia" && items.length) odontogram.push({ ...change, advisory: "La pieza no aparece en la lista clínica del dictado. Márcalo solo si corresponde." });
    else odontogram.push(change);
  }

  // Conflicto IA/reglas cuyo rival la lista ya descartó (p. ej. el implante solo planificado): el que queda se propone.
  const resolved = new Set<number>();
  for (const [index, change] of odontogram.entries()) {
    if (!change.conflict) continue;
    const cats = changeCategories(change) ?? [];
    const rivals = odontogram.filter((other) => other !== change && other.tooth === change.tooth && (change.kind === "surface" ? other.kind === "surface" && other.surface === change.surface : other.kind === change.kind));
    const backed = nonPlan(change.tooth).some((item) => cats.includes(item.category));
    if (rivals.length || !backed) continue;
    const rest = { ...change };
    delete rest.conflict;
    odontogram[index] = rest;
    resolved.add(change.tooth);
  }

  // 2) Lo realizado que falta en el odontograma.
  const implantAnywhere = (tooth: number) => items.some((item) => (item.tooth === tooth || item.tooth === null) && item.kind !== "plan" && item.category === "implante");
  let added = 0;
  const has = (tooth: number, statuses: string[]) => odontogram.some((change) => change.tooth === tooth && change.kind === "status" && statuses.includes(change.status ?? ""));
  const add = (item: ClinicalItem, status: ToothStatus) => {
    const tooth = item.tooth!;
    const uncertain = item.origin === "ia";
    odontogram.push({
      id: `odo-lista-${++added}`, tooth, kind: "status", status, numbering: "FDI", numberingLabel: fdi(tools, tooth),
      sourceText: item.evidence, evidence: item.evidence, origin: item.origin === "ia+reglas" ? "ia+reglas" : item.origin,
      ...(status === "Ausente" ? { missingReason: "unknown" as const } : {}),
      ...(uncertain ? { advisory: "Solo la IA lo leyó así; confírmalo antes de incorporarlo." } : {}),
    });
    warnings.push(`${fdi(tools, tooth)}: se agregó «${status.toLowerCase()}» (dictado como realizado${uncertain ? ", por confirmar" : ""}).`);
  };
  for (const item of items) {
    if (item.kind !== "realizado" || !item.tooth) continue;
    if (item.category === "exodoncia" && !implantAnywhere(item.tooth) && !has(item.tooth, ["Ausente", "Implante", "Implante con pilar"])) add(item, "Ausente");
    if ((item.category === "implante" || item.category === "pilar") && !has(item.tooth, ["Implante", "Implante con pilar"])) {
      const before = chartStatus.get(item.tooth);
      // Un implante que ya figuraba (control, conexión de pilar) no se vuelve a marcar.
      if (before && /^Implante/.test(before)) continue;
      add(item, item.category === "pilar" ? "Implante con pilar" : "Implante");
    }
  }

  // 3) Prestaciones del arancel: una por pieza tratada; la exodoncia con su pieza.
  let prestaciones: PrestacionItem[] = (proposal.prestaciones ?? []).map((item) => ({ ...item }));
  const familyOf = (code: string): ItemCategory | null => {
    const name = prestacionByCode(code)?.name ?? "";
    if (/IMPLANTE INMEDIATO/.test(name)) return "implante";
    if (/EXODONCIA|EXTRACCION/.test(name)) return "exodoncia";
    if (/CONEXION DE IMPLANTE|PILAR/.test(name)) return "pilar";
    if (/INSTALACION DE IMPLANTE/.test(name)) return "implante";
    if (/ESCANEO/.test(name)) return "escaneo";
    return null;
  };
  for (const item of items) {
    if (item.kind !== "realizado" || !item.tooth) continue;
    const rule = PER_TOOTH_PRESTACION[item.category];
    if (!rule) continue;
    // «Implante inmediato postextracción» ya incluye la exodoncia de esa pieza.
    const immediate = (code: string) => /IMPLANTE INMEDIATO/.test(prestacionByCode(code)?.name ?? "");
    if (item.category === "exodoncia" && prestaciones.some((entry) => entry.tooth === item.tooth && immediate(entry.code))) continue;
    const family = prestaciones.filter((entry) => familyOf(entry.code) === item.category || (item.category === "implante" && familyOf(entry.code) === "pilar"));
    if (family.some((entry) => entry.tooth === item.tooth)) continue;
    const loose = family.find((entry) => entry.tooth === null);
    if (loose) { loose.tooth = item.tooth; continue; }
    const template = family[0];
    // «Conexión de implantes MÚLTIPLES» ya cubre varias piezas: no se repite por pieza (sería un doble cobro).
    if (template && /MULTIPLE/.test(prestacionByCode(template.code)?.name ?? "")) continue;
    let code = template?.code ?? (item.arancel && prestacionByCode(item.arancel) ? item.arancel : rule.code);
    if (item.category === "exodoncia" && (doneOf(item.tooth, "implante") || /implante\s+inmediato/.test(fold(item.evidence)))) code = "5011018";
    const name = prestacionByCode(code)?.name ?? "";
    prestaciones.push({ id: "", code, name, tooth: item.tooth, evidence: item.evidence, ...(item.origin === "ia" ? { advisory: "Solo la IA lo leyó así; confírmala." } : {}) });
  }
  // Escaneo con scanbody: puede cobrarse aparte; se propone sin marcar.
  const scan = items.find((item) => item.kind === "realizado" && item.category === "escaneo");
  if (scan && !prestaciones.some((entry) => familyOf(entry.code) === "escaneo") && prestacionByCode("9150001")) {
    prestaciones.push({ id: "", code: "9150001", name: prestacionByCode("9150001")!.name, tooth: null, evidence: scan.evidence, advisory: "Escaneo dictado: márcalo solo si lo cobras aparte." });
  }
  // Prestación de una pieza cuyo acto quedó solo planificado o no se hizo: sin marcar, con el motivo.
  prestaciones = prestaciones.map((entry) => {
    const family = familyOf(entry.code);
    if (!family || entry.tooth === null || entry.advisory) return entry;
    const same = (item: ClinicalItem) => item.tooth === entry.tooth && (item.category === family || compatible(item.category, family));
    if (items.some((item) => same(item) && item.kind === "realizado") || !items.some((item) => same(item) && item.kind === "plan")) return entry;
    warnings.push(`${fdi(tools, entry.tooth)}: la prestación «${entry.name.toLowerCase()}» quedó sin marcar porque lo dictado es plan o no se realizó.`);
    return { ...entry, advisory: "Lo dictado es un plan o algo que no se realizó hoy. Márcala solo si se hizo." };
  });
  prestaciones = prestaciones.map((entry, index) => ({ ...entry, id: `pr-${index + 1}` }));

  // La lista decide que la exodoncia se hizo (p. ej. en «Procedimientos realizados»): la pregunta de las reglas sobra.
  const doneExtractions = items.filter((item) => item.kind === "realizado" && item.category === "exodoncia");
  const askedDone = (question: string) => /^¿La exodoncia ya se realizó/.test(question) && doneExtractions.some((item) => question.includes(item.evidence.replace(/^procedimientos?(?:\s+realizados?)?\s*:\s*/i, "").slice(0, 25)));

  // 4) Diagnósticos: movilidad grado II–III sin diagnóstico de la pieza → enfermedad periodontal sugerida (sin marcar).
  let diagnoses: DiagnosisItem[] = [...(proposal.diagnoses ?? [])];
  const conflictResolved = (question: string) => [...resolved].some((tooth) => question.startsWith(`FDI ${tools.formatFdi(tooth)}: la IA y las reglas no coinciden`));
  let clarifications = proposal.clarifications.filter((question) => !askedDone(question) && !conflictResolved(question));
  let prompts = [...(proposal.diagnosisPrompts ?? [])];
  for (const item of items) {
    if (item.category !== "movilidad" || !item.tooth || !(item.grade === "II" || item.grade === "III")) continue;
    const tooth = item.tooth;
    if (diagnoses.some((dx) => dx.tooth === tooth && !dx.suggested) || diagnoses.some((dx) => dx.tooth === tooth && /^DA0C/.test(dx.code))) continue;
    if (!ICD11["DA0C.Z"]) continue;
    const dx: DiagnosisItem = { id: `dx-movilidad-${tooth}`, tooth, code: "DA0C.Z", title: ICD11["DA0C.Z"].title, label: "", evidence: item.evidence, findings: `movilidad grado ${item.grade}`, origin: "reglas", suggested: { from: "nota", term: `movilidad grado ${item.grade}` } };
    dx.label = `FDI ${tools.formatFdi(tooth)} movilidad grado ${item.grade}: ${dx.title} (CIE-11 DA0C.Z, sugerido; confirma o precisa periodontitis con estadio y grado)`;
    // La sugerencia por movilidad reemplaza la sugerencia genérica de pérdida dentaria de la misma pieza.
    diagnoses = [...diagnoses.filter((done) => !(done.tooth === tooth && done.suggested)), dx];
    const dropped = prompts.filter((prompt) => prompt.tooth === tooth);
    prompts = prompts.filter((prompt) => prompt.tooth !== tooth);
    clarifications = clarifications.filter((question) => !dropped.some((prompt) => prompt.question === question));
  }
  // CIE-11 que la IA asoció a un elemento, si la pieza quedó sin diagnóstico: sugerido.
  for (const item of items) {
    if (!item.cie11 || !ICD11[item.cie11] || item.kind === "plan") continue;
    if (diagnoses.some((dx) => dx.tooth === (item.tooth ?? undefined))) continue;
    const dx: DiagnosisItem = { id: `dx-lista-${item.id}`, ...(item.tooth ? { tooth: item.tooth } : {}), code: item.cie11, title: ICD11[item.cie11].title, label: "", evidence: item.evidence, findings: "", origin: "ia", suggested: { from: "nota", term: item.what.slice(0, 120) } };
    dx.label = `${item.tooth ? `FDI ${tools.formatFdi(item.tooth)}: ` : ""}${dx.title} (CIE-11 ${dx.code}, sugerido)`;
    diagnoses.push(dx);
  }

  // 5) Coherencia entre la nota y la lista.
  warnings.push(...consistencyWarnings(proposal.evolution?.body ?? "", items, tools));

  return {
    ...proposal,
    odontogram,
    prestaciones,
    diagnoses,
    clarifications,
    ...(prompts.length ? { diagnosisPrompts: prompts } : { diagnosisPrompts: undefined }),
    items,
    itemWarnings: [...new Set(warnings)],
  };
}

/** Piezas nombradas en la nota (fuera del relato del paciente y del registro automático del odontograma). */
function noteTeeth(body: string, tools: ItemTools): number[] {
  let section: Section = null;
  let registry = false;
  const teeth = new Set<number>();
  for (const line of body.split("\n")) {
    const plain = fold(line).trim();
    // Lo que la app agrega (registro del odontograma, CIE-11, arancel, transcripción) no es redacción de la nota.
    if (/^transcripcion completa/.test(plain)) break;
    if (/^(examen \(odontograma\)|diagnosticos \(cie-11\)|prestaciones \(arancel\))$/.test(plain)) { registry = true; continue; }
    if (!plain) { registry = false; continue; }
    if (registry) continue;
    const header = HEADER.exec(plain);
    if (header) section = sectionOf(header[1]) ?? section;
    if (section === "relato") continue;
    for (const tooth of tools.teethIn(line)) teeth.add(tooth);
  }
  return [...teeth];
}

export function consistencyWarnings(body: string, items: ClinicalItem[], tools: ItemTools): string[] {
  if (!body.trim()) return [];
  const out: string[] = [];
  const inNote = noteTeeth(body, tools);
  const listed = new Set(items.flatMap((item) => (item.tooth ? [item.tooth] : [])));
  for (const tooth of inNote) if (!listed.has(tooth)) out.push(`La nota menciona ${fdi(tools, tooth)}, pero no quedó en la lista clínica: revisa si hay algo que registrar.`);
  for (const tooth of listed) {
    if (inNote.includes(tooth)) continue;
    const own = items.filter((item) => item.tooth === tooth && item.category !== "otro");
    if (own.length && own.every((item) => item.origin === "ia")) out.push(`La lista clínica incluye ${fdi(tools, tooth)} (${own.map((item) => `${item.category} ${item.kind}`).join(", ")}), pero la nota no la menciona.`);
  }
  // Hedge junto a números de pieza: se informa (la redacción ya lo quita si no aporta).
  if (/(?:piezas?|zona)[^.]{0,60}\d[^.]{0,20}aproximad|aproximad\w*\s+(?:en\s+)?(?:la|las)\s+piezas?/i.test(body)) out.push("La nota dice «aproximadamente» junto a números de pieza: confirma las piezas exactas.");
  return out;
}

// ── Lista de la IA ──────────────────────────────────────────────────────────────────────────────
export const ITEMS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["pieza", "sistema", "caras", "tipo", "categoria", "descripcion", "codigo_arancel", "cie11", "evidencia"],
    properties: {
      pieza: { type: "string" },
      sistema: { type: "string", enum: ["chilena", "FDI", "universal", "sin_etiqueta"] },
      caras: { type: "array", items: { type: "string", enum: ["M", "O", "D", "V", "P"] } },
      tipo: { type: "string", enum: [...ITEM_KINDS] },
      categoria: { type: "string", enum: [...ITEM_CATEGORIES] },
      descripcion: { type: "string" },
      codigo_arancel: { type: "string" },
      cie11: { type: "string" },
      evidencia: { type: "string" },
    },
  },
} as const;

export const ITEMS_PROMPT = `13) "lista_clinica": la FUENTE ÚNICA para el odontograma, el arancel y los diagnósticos. Un elemento por PIEZA y por hecho clínico (si dice «piezas 20 y 21», son DOS elementos; un tramo «de la 1.4 a la 1.6» es un elemento por cada pieza del tramo). Cada elemento:
- "tipo": "diagnostico" = lo que se ENCONTRÓ hoy (movilidad, caries, pieza ausente, fractura…); "plan" = lo que se va a hacer (planifica, se plantea, próxima sesión, presupuesto, infinitivos como «rehabilitar», condicionales); "realizado" = lo que se HIZO hoy (se realiza, se extrae, se instala, se conecta, se obturó, conexión de…, escaneo…). Nunca conviertas un plan en realizado.
- "categoria": exodoncia | implante (instalación de un implante) | pilar (conexión del implante, minipilar, pilar protésico) | corona | puente | protesis | obturacion | endodoncia | destartraje | escaneo | sellante | ausente | caries | movilidad | fractura | lesion_apical | otro.
- "pieza" y "sistema" como en "hallazgos" ("" y "sin_etiqueta" si no hay pieza, p. ej. «escaneo de cinco implantes»); "caras" solo si se dijeron.
- "descripcion": breve, en lenguaje clínico («movilidad grado II», «exodoncia», «conexión de implante con minipilar de 2,5 mm»).
- "codigo_arancel": para "realizado" o "plan", el código de 7 dígitos de la lista de prestaciones candidatas si UNA corresponde claramente; si no, "".
- "cie11": para "diagnostico" o lo que lo implique (exodoncia por movilidad → enfermedad periodontal DA0C.Z; pieza ausente → DA0A.1), un código CIE-11 del catálogo si es claro; si no, "". No lo uses para afirmar un diagnóstico que no se dictó: es una sugerencia que el odontólogo confirma.
- "evidencia": cita EXACTA y continua del dictado que contenga la pieza y el hecho.
Todo lo que la nota nombre (cada pieza y cada procedimiento) debe estar en la lista, y nada de la lista puede faltar en la nota.`;

/** Elementos de la IA ya validados (la pieza se resuelve con la misma lógica que los hallazgos). */
export function parseAiItems(
  raw: unknown,
  resolve: (pieza: string, sistema: string, evidence: string) => { ok: true; tooth: number } | { ok: false; reason: string },
  evidenceOk: (evidence: string) => boolean,
): ClinicalItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ClinicalItem[] = [];
  for (const entry of raw.slice(0, 80)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const str = (key: string) => (typeof record[key] === "string" ? (record[key] as string).trim() : "");
    const kind = str("tipo") as ItemKind;
    const category = str("categoria") as ItemCategory;
    if (!ITEM_KINDS.includes(kind) || !ITEM_CATEGORIES.includes(category)) continue;
    const evidence = str("evidencia");
    if (!evidence || !evidenceOk(evidence)) continue;
    let tooth: number | null = null;
    if (str("pieza")) {
      const mention = resolve(str("pieza"), str("sistema"), evidence);
      if (!mention.ok) continue;
      tooth = mention.tooth;
    }
    const faces = Array.isArray(record.caras) ? (record.caras as unknown[]).filter((face): face is OdontogramSurface => typeof face === "string" && ["M", "O", "D", "V", "P"].includes(face)) : [];
    const arancel = /^\d{7}$/.test(str("codigo_arancel")) && prestacionByCode(str("codigo_arancel")) ? str("codigo_arancel") : undefined;
    const cie11 = ICD11[str("cie11")] ? str("cie11") : undefined;
    const grade = category === "movilidad" ? gradeOf(fold(`${str("descripcion")} ${evidence}`)) : undefined;
    out.push(makeItem({ tooth, surfaces: faces, kind, category, what: str("descripcion").slice(0, 200) || evidence.slice(0, 200), evidence: evidence.slice(0, 400), origin: "ia", ...(arancel ? { arancel } : {}), ...(cie11 ? { cie11 } : {}), ...(grade ? { grade } : {}) }));
  }
  return dedupe(out);
}

// ── Paciente: concordancia y edad ────────────────────────────────────────────────────────────────
export type PatientContext = { sex?: "F" | "M" | null; age?: number | null };

const FEMALE = new Set(["maria", "ana", "carmen", "rosa", "violeta", "isabel", "paola", "cecilia", "marcela", "daysi", "daisy", "javiera", "camila", "constanza", "francisca", "catalina", "valentina", "fernanda", "carolina", "daniela", "gabriela", "andrea", "patricia", "veronica", "monica", "claudia", "sandra", "ximena", "jimena", "loreto", "pilar", "soledad", "rocio", "beatriz", "ines", "raquel", "teresa", "luz", "mercedes", "margarita", "gloria", "elena", "alejandra", "macarena", "trinidad", "antonia", "josefa", "florencia", "martina", "isidora", "agustina", "emilia", "sofia", "ignacia", "barbara", "karen", "jacqueline", "yolanda", "nancy", "ruth", "edith", "miriam", "lorena", "paula", "natalia", "silvia", "susana", "graciela", "irma", "olga", "angelica", "alicia", "eliana", "erika", "maritza", "viviana", "pamela", "carla", "karina", "marisol", "consuelo", "amparo", "dolores", "guadalupe", "noemi", "belen", "abigail", "lucia", "julia", "laura", "eva", "sara", "ester", "esther", "adriana", "denisse", "denise", "ivonne", "jeannette", "evelyn", "allison", "aleta"]);
const MALE = new Set(["jose", "juan", "luis", "carlos", "jorge", "pedro", "manuel", "francisco", "eduardo", "sergio", "ricardo", "patricio", "rodrigo", "cristian", "christian", "felipe", "pablo", "diego", "matias", "nicolas", "sebastian", "tomas", "benjamin", "vicente", "agustin", "joaquin", "martin", "ignacio", "alejandro", "andres", "fernando", "gonzalo", "claudio", "hector", "hugo", "mario", "raul", "oscar", "victor", "rene", "jaime", "ivan", "marcelo", "mauricio", "alvaro", "roberto", "daniel", "gabriel", "rafael", "miguel", "antonio", "enrique", "arturo", "alberto", "guillermo", "osvaldo", "nelson", "julio", "cesar", "fabian", "esteban", "maximiliano", "bastian", "lucas", "gaspar", "mateo", "emilio", "samuel", "elias", "david", "angel", "alexis", "boris", "marco", "marcos", "leonardo", "ruben", "humberto", "gustavo", "orlando", "domingo", "santiago", "cristobal", "renato", "hernan", "german", "ramon", "camilo", "simon", "aaron", "luca", "nicola"]);

/** Sexo deducido del primer nombre, solo si es claro; si no, null (se redacta en forma neutra). */
export function inferSexFromName(name: string | null | undefined): "F" | "M" | null {
  const first = fold(String(name ?? "")).trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  if (FEMALE.has(first)) return "F";
  if (MALE.has(first)) return "M";
  return null;
}

/** Edad cumplida en años (fecha YYYY-MM-DD o DD-MM-YYYY), o null. */
export function ageFrom(birthDate: string | null | undefined, today: string): number | null {
  const raw = String(birthDate ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) ?? (() => { const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(raw); return m ? [raw, m[3], m[2], m[1]] as unknown as RegExpExecArray : null; })();
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!iso || !now) return null;
  let age = Number(now[1]) - Number(iso[1]);
  if (Number(now[2]) < Number(iso[2]) || (Number(now[2]) === Number(iso[2]) && Number(now[3]) < Number(iso[3]))) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

export function patientPrompt(patient: PatientContext | undefined): string {
  if (!patient) return "";
  const sex = patient.sex === "F" ? "mujer: escribe «la paciente» y concuerda en femenino" : patient.sex === "M" ? "hombre: escribe «el paciente»" : "sexo no registrado: usa redacción neutra («Paciente refiere…», «se indica a paciente…»), sin artículo de género";
  const age = typeof patient.age === "number" ? `; edad ${patient.age} años` : "";
  return `\n\nDatos del paciente para la concordancia (no los escribas en la nota): ${sex}${age}.`;
}

/**
 * Ajustes deterministas de la nota: concordancia con el sexo registrado y quita «aproximadamente» pegado a números de
 * pieza (las piezas se registran exactas; se avisa para confirmar).
 */
export function polishNote(body: string, patient: PatientContext | undefined): { body: string; notes: string[] } {
  let out = body;
  const notes: string[] = [];
  if (patient?.sex === "F") {
    const before = out;
    out = out
      .replace(/\b([Ee])l paciente\b/g, (_m, e: string) => (e === "E" ? "La paciente" : "la paciente"))
      .replace(/\bdel paciente\b/g, "de la paciente")
      .replace(/\bDel paciente\b/g, "De la paciente")
      .replace(/\bal paciente\b/g, "a la paciente")
      .replace(/\bAl paciente\b/g, "A la paciente");
    if (out !== before) notes.push("Concordancia: «el paciente» → «la paciente».");
  } else if (patient?.sex === "M") {
    const before = out;
    out = out.replace(/\b([Ll])a paciente\b/g, (_m, l: string) => (l === "L" ? "El paciente" : "el paciente"));
    if (out !== before) notes.push("Concordancia: «la paciente» → «el paciente».");
  }
  // «piezas 20 y 21, aproximadamente,» / «aproximadamente en las piezas 20 y 21»
  const hedgeAfter = /((?:piezas?|dientes?)\s+\d{1,2}(?:\.\d)?(?:\s*(?:,|y|e|a)\s*\d{1,2}(?:\.\d)?)*)\s*,?\s*aproximadamente(?:\s*(,))?/giu;
  const hedgeBefore = /aproximadamente\s+((?:en\s+)?(?:la|las)\s+(?:zona\s+de\s+(?:la|las)\s+)?piezas?\s+\d)/giu;
  const before = out;
  out = out.replace(hedgeAfter, (_m, teeth: string, comma?: string) => `${teeth}${comma ? "," : ""}`).replace(hedgeBefore, (_m, rest: string) => rest);
  if (out !== before) notes.push("Se quitó «aproximadamente» junto a los números de pieza: confirma que las piezas registradas son las correctas.");
  return { body: out.replace(/ ,/g, ",").replace(/ {2,}/g, " "), notes };
}
