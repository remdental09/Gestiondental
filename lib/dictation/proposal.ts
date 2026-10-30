/**
 * Propuesta estructurada de un dictado clínico.
 * La validación es pura: sirve para la salida de Workers AI y para el
 * estructurador local que se usa cuando el binding no está disponible.
 * No persiste datos ni incluye identidad de pacientes.
 */

/**
 * Llama 3.1 8B fast admite JSON schema en Workers AI y cabe en la cuota
 * diaria de 10 000 Neurons. La variante fp8 responde 5025 y no sirve.
 * Los 70B también admiten el esquema, pero gastan varias veces más por la salida.
 */
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";

export const TOOTH_STATUSES = [
  "Sin hallazgos",
  "Implante",
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
export type SurfaceFinding = {
  condition: "not_examined" | "sound" | "caries" | "restored" | "sealant" | "other_restoration";
  icdas: 1 | 2 | 3 | 4 | 5 | 6 | null;
  activity: "active" | "inactive" | "uncertain" | null;
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
};

export type BudgetChange = {
  id: string;
  title: string;
  label: string;
  amount: number;
  sourceText: string;
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
};

export type DictationProposal = {
  evolution: { title: string; body: string } | null;
  odontogram: OdontogramChange[];
  budget: BudgetChange[];
  perio: PerioStub[];
  clarifications: string[];
};

export type ChartSurface = {
  condition: SurfaceFinding["condition"];
  icdas?: SurfaceFinding["icdas"];
  activity?: SurfaceFinding["activity"];
};

export type ChartSnapshot = {
  teeth: Record<number, string>;
  surfaces: Record<number, Partial<Record<OdontogramSurface, ChartSurface>>>;
  missingReason?: Record<number, "caries" | "other" | "unknown">;
  crowns?: Record<number, { material: string; shade?: string | null }>;
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
};

export type ChartAction =
  | { action: "setToothStatus"; patientId: number; tooth: number; status: string }
  | { action: "setToothMissingReason"; patientId: number; tooth: number; reason: "caries" | "other" | "unknown" }
  | { action: "setCrownDetails"; patientId: number; tooth: number; material: string; shade: string }
  | { action: "setToothSurface"; patientId: number; tooth: number; surface: OdontogramSurface; finding: SurfaceFinding };

const LOCAL_NOTICE = "Workers AI no está enlazado en este entorno. La propuesta salió del estructurador local, sin costo por dictado, y no se guarda sola.";
const DETERMINISTIC_NOTICE = "La evolución sale de los hallazgos resueltos y de las frases dictadas. El modelo no redacta esta nota.";

export const CLINICAL_SYSTEM_PROMPT = `Eres un odontólogo que convierte un dictado en español de Chile en una propuesta JSON para que otro odontólogo la revise. No guardas nada, no diagnosticas y no completas lo que no se dijo.

Regla de oro: caries, obturación, sellante y superficie sana son kind "surface". kind "crown" y estado "Corona" solo si el dictado dice que se cementó o se instaló una corona definitiva. Una obturación de resina no es una corona.

Numeración:
- El campo tooth es el código FDI compacto: FDI 1.2 se guarda como 12 y FDI 3.6 como 36. La etiqueta humana lleva punto.
- «FDI» o «ISO», o un número con punto (1.2, 3.6, 5.5), es FDI. La dentición temporal usa cuadrantes 5 a 8 y posiciones 1 a 5.
- «pieza 12» sin etiqueta FDI es numeración nacional chilena y corresponde a FDI 2.4 (tooth 24). No la conviertas en FDI 1.2.
- Nacional chilena 30 = FDI 3.6 (tooth 36). Nacional chilena 19 = FDI 4.6 (tooth 46).
- Universal estadounidense 19 = FDI 3.6. Universal 30 = FDI 4.6. No llames universal a un número chileno.
- Si el número no trae sistema y queda fuera del 1 al 32, no elijas pieza: explícalo en clarifications y omite el ítem.
- Una letra temporal (A–T) solo vale si el dictado dice que es temporal, decidua o de leche.

Odontograma:
- Separa el estado general (Sin hallazgos, Implante, Corona, Ausente, Indicación de exodoncia, Resto radicular con endodoncia) del hallazgo por superficie (V vestibular, P palatina o lingual, M mesial, D distal, O oclusal o incisal).
- Caries exige icdas de 1 a 6 y activity active, inactive o uncertain. Si falta uno, no crees el ítem y pídelo en clarifications.
- ICDAS, la actividad y cualquier conteo no son un diagnóstico. No infieras COP, EPB, índice gingival ni estadio o grado AAP/EFP.
- Solo propone Implante si se instaló, colocó o insertó y la pieza es clara. Un plan, una indicación o una negación no cambia el estado.
- Solo propone Corona si se cementó o se instaló una corona definitiva. Un presupuesto de corona no cambia el odontograma.
- «Refiere», «relata» o «dice» es relato: va en la evolución y no crea un hallazgo.
- «Niega» se copia tal cual. Lo no mencionado se omite; no escribas «niega» ni «sin registrar» en lugar del paciente.

Periodonto: un sondaje explícito puede ir en perio con persisted false. No es un diagnóstico ni un examen completo.
Presupuesto: solo con prestación y monto en pesos. No es un tratamiento realizado.
Evolución: redacta solo lo dicho, separando relato y examen.
Responde únicamente JSON del esquema. Lo ambiguo va en clarifications, no en odontogram.`;

export const DICTATION_JSON_SCHEMA = {
  name: "propuesta_dictado_dental",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["evolution", "odontogram", "budget", "perio", "clarifications"],
    properties: {
      evolution: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
      },
      odontogram: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tooth", "numbering", "numberingLabel", "sourceText", "kind"],
          properties: {
            tooth: { type: "integer" },
            numbering: { type: "string", enum: ["FDI", "chilena", "universal"] },
            numberingLabel: { type: "string" },
            sourceText: { type: "string" },
            kind: { type: "string", enum: ["status", "surface", "crown"] },
            status: { type: "string", enum: [...TOOTH_STATUSES] },
            surface: { type: "string", enum: [...ODONTOGRAM_SURFACES] },
            finding: {
              type: "object",
              additionalProperties: false,
              required: ["condition", "icdas", "activity"],
              properties: {
                condition: { type: "string", enum: ["not_examined", "sound", "caries", "restored", "sealant", "other_restoration"] },
                icdas: { type: ["integer", "null"] },
                activity: { type: ["string", "null"] },
              },
            },
            material: { type: "string", enum: [...CROWN_MATERIALS] },
            shade: { type: ["string", "null"] },
            missingReason: { type: "string", enum: ["caries", "other", "unknown"] },
          },
        },
      },
      budget: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "label", "amount", "sourceText"],
          properties: {
            title: { type: "string" },
            label: { type: "string" },
            amount: { type: "integer" },
            sourceText: { type: "string" },
          },
        },
      },
      perio: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tooth", "numberingLabel", "site", "siteLabel", "depth", "sourceText", "persisted"],
          properties: {
            tooth: { type: "integer" },
            numberingLabel: { type: "string" },
            site: { type: "string", enum: [...PERIO_SITES] },
            siteLabel: { type: "string" },
            depth: { type: "integer" },
            sourceText: { type: "string" },
            persisted: { type: "boolean" },
          },
        },
      },
      clarifications: { type: "array", items: { type: "string" } },
    },
  },
} as const;

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

const SITE_LABEL: Record<PerioSite, string> = {
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

function sentences(text: string): string[] {
  return text.split(/\n+|(?<=[.!?;])\s+/).map((part) => part.trim()).filter(Boolean);
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
  const chile = chileToFdi(compact);
  if (chile) return { ok: true, tooth: chile, numbering: "chilena", numberingLabel: `nacional chilena ${compact} · FDI ${formatFdi(chile)}` };
  const hint = isValidFdi(compact) ? ` Podría leerse como FDI ${formatFdi(compact)}, pero no se asumió.` : "";
  return { ok: false, reason: `«pieza ${raw}» no indica el sistema.${hint} Del 1 al 32, sin etiqueta, esta ficha usa numeración nacional chilena.` };
}

const SPOKEN_DIGIT = "(?:un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)";
const SPOKEN_CARDINALS: Array<[string, number]> = [
  ["treinta y seis", 36], ["treinta y dos", 32], ["treinta y uno", 31], ["treinta", 30],
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
  const spoken = speechText(sentence);
  const consumed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number) => consumed.some(([from, to]) => start < to && end > from);
  const pair = new RegExp(String.raw`\b(?:(?:pieza|diente)\s+)?(?:(?:fdi|iso)\s+)?${SPOKEN_DIGIT}\s+${SPOKEN_DIGIT}\b`, "g");
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

function isPlan(sentence: string): boolean {
  return /\b(?:se\s+planifica|planificad[oa]|se\s+indica|a\s+futuro|presupuesto|cotizaci[oó]n|por\s+cotizar)\b/i.test(sentence);
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

function budgetLabel(sentence: string): string {
  const label = sentence
    .replace(/(?:\$\s*)?(?:\d{1,3}(?:\.\d{3})+|\d{4,9})/g, " ")
    .replace(/\b(?:presupuesto|cotizaci[oó]n|honorarios?|pesos|clp|pieza|diente|fdi|iso|chilena|nacional|universal)\b/gi, " ")
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:de|del|la|el|un|una)\s+/i, "");
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

function statusFrom(sentence: string): ToothStatus | null {
  if (/\bresto\s+radicular\b/i.test(sentence) && /\bendodoncia\b/i.test(sentence)) return "Resto radicular con endodoncia";
  if (/\bindicaci[oó]n\s+de\s+exodoncia\b/i.test(sentence)) return "Indicación de exodoncia";
  if (/\bimplante\b/i.test(sentence) && isPerformed(sentence)) return "Implante";
  if (/\b(?:corona|pr[oó]tesis\s+fija\s+definitiva)\b/i.test(sentence) && !/\bprovisori[ao]\b/i.test(sentence)) return "Corona";
  if (/\b(?:ausente|extra[ií]d[oa]|exodonciad[oa])\b/i.test(sentence)) return "Ausente";
  return null;
}

function findingFrom(sentence: string): { finding: SurfaceFinding } | { error: string } | null {
  const deniesCaries = /\b(?:sin|no)\s+(?:se\s+observa\s+)?caries\b/i.test(sentence);
  const hasCaries = /\bcaries\b/i.test(sentence) && !deniesCaries;
  const restored = /\b(?:obturaci[oó]n|obturad[oa]|restauraci[oó]n|restaurad[oa])\b/i.test(sentence);
  const sealant = /\bsellante\b/i.test(sentence);
  const other = /\botra\s+restauraci[oó]n\b/i.test(sentence);
  const sound = /\b(?:sana|sano|sin\s+lesi[oó]n)\b/i.test(sentence) || deniesCaries;
  const kinds = [hasCaries, restored, sealant, other, sound].filter(Boolean).length;
  if (kinds > 1) return { error: `La frase mezcla hallazgos de superficie y no se eligió uno: «${clip(sentence)}».` };
  if (hasCaries) {
    const icdas = icdasFrom(sentence);
    const activity = activityFrom(sentence);
    if (!icdas || !activity) return { error: `Caries sin ICDAS y actividad completos, sin cambio de superficie: «${clip(sentence)}».` };
    return { finding: { condition: "caries", icdas: icdas as SurfaceFinding["icdas"], activity } };
  }
  if (restored) return { finding: { condition: "restored", icdas: null, activity: null } };
  if (sealant) return { finding: { condition: "sealant", icdas: null, activity: null } };
  if (other) return { finding: { condition: "other_restoration", icdas: null, activity: null } };
  if (sound) return { finding: { condition: "sound", icdas: null, activity: null } };
  return null;
}

function perioSite(sentence: string): PerioSite | null {
  const mesial = /\bmesial\b/i.test(sentence);
  const distal = /\bdistal\b/i.test(sentence);
  const vestibular = /\b(?:vestibular|bucal)\b/i.test(sentence);
  const lingual = /\b(?:lingual|palatin[oa])\b/i.test(sentence);
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

function describeFinding(tooth: number, finding: SurfaceFinding, surfaces: OdontogramSurface[]): string {
  const faces = facesLabel(tooth, surfaces);
  if (finding.condition === "caries") {
    const activity = finding.activity === "active" ? "activa" : finding.activity === "inactive" ? "inactiva" : "actividad incierta";
    return `caries ${faces}, ICDAS ${finding.icdas}, ${activity}`;
  }
  if (finding.condition === "restored") return `obturación ${faces}`;
  if (finding.condition === "sealant") return `sellante ${faces}`;
  if (finding.condition === "sound") return `sin lesión visible ${faces}`;
  return `otra restauración ${faces}`;
}

function describeStatus(item: OdontogramChange): string {
  if (item.status === "Corona") return `corona${item.material ? ` de ${item.material}` : ""}${item.shade ? `, color ${item.shade}` : ""}`;
  if (item.status === "Ausente" && /extracci/i.test(item.sourceText)) return "ausente por extracción";
  if (item.status === "Ausente" && item.missingReason === "caries") return "ausente por caries";
  if (item.status === "Ausente") return "ausente";
  if (item.status === "Implante") return "implante";
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
    const buckets = new Map<string, { finding: SurfaceFinding; surfaces: OdontogramSurface[] }>();
    for (const item of group) {
      if (item.kind !== "surface" || !item.surface || !item.finding) continue;
      const key = `${item.finding.condition}:${item.finding.icdas ?? ""}:${item.finding.activity ?? ""}`;
      const bucket = buckets.get(key) ?? { finding: item.finding, surfaces: [] };
      bucket.surfaces.push(item.surface);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) parts.push(describeFinding(tooth, bucket.finding, bucket.surfaces));
    for (const item of group) if (item.kind !== "surface") parts.push(describeStatus(item));
    return `${toothHeading(group[0])}: ${parts.join(". ")}.`;
  });
}

function composeEvolution(transcript: string, odontogram: OdontogramChange[] = [], clarifications: string[] = []): { title: string; body: string } | null {
  const clean = transcript.trim();
  if (!clean) return null;
  const sources = new Set(odontogram.map((item) => clip(item.sourceText)));
  const relato: string[] = [];
  const procedimientos: string[] = [];
  const indicaciones: string[] = [];
  const presupuesto: string[] = [];
  const sondaje: string[] = [];
  const resto: string[] = [];
  const unresolved: string[] = [];
  for (const sentence of sentences(clean)) {
    if (sources.has(clip(sentence))) continue;
    const line = ensurePeriod(sentence);
    if (isPatient(sentence)) relato.push(line);
    else if (/\b(?:presupuesto|cotizaci[oó]n)\b/i.test(sentence)) presupuesto.push(line);
    else if (/\bse\s+indica\b/i.test(sentence)) indicaciones.push(line);
    else if (isPerformed(sentence)) procedimientos.push(line);
    else if (/\bsondaje\b/i.test(sentence)) sondaje.push(line);
    else if (toothMentions(sentence).length > 0) unresolved.push(line);
    else resto.push(line);
  }
  const lines: string[] = [];
  if (relato.length) lines.push("Relato", ...relato, "");
  const exam = examLines(odontogram);
  if (exam.length) lines.push("Examen", ...exam, "");
  if (procedimientos.length) lines.push("Procedimientos", ...procedimientos, "");
  if (indicaciones.length) lines.push("Indicaciones", ...indicaciones, "");
  if (presupuesto.length) lines.push("Presupuesto", ...presupuesto, "");
  if (sondaje.length) lines.push("Sondaje", ...sondaje, "");
  if (resto.length) lines.push("Otros dichos", ...resto, "");
  const pending = [...new Set([...unresolved, ...clarifications.map((item) => item.trim()).filter(Boolean)])];
  if (pending.length) lines.push("Pendiente de aclarar", ...pending.map((item) => ensurePeriod(item)));
  const body = lines.join("\n").trim();
  return body ? { title: "Evolución dictada", body } : null;
}

function dedupeKey(item: OdontogramChange): string {
  return [item.tooth, item.kind, item.surface ?? "", item.status ?? "", item.finding?.condition ?? "", item.finding?.icdas ?? "", item.material ?? ""].join(":");
}

export function structureTranscript(transcript: string): DictationProposal {
  const clarifications: string[] = [];
  const odontogram: OdontogramChange[] = [];
  const budget: BudgetChange[] = [];
  const perio: PerioStub[] = [];
  const seen = new Set<string>();
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  for (const sentence of sentences(transcript)) {
    if (/\b(?:epb|l[oö]e[\s-]?silness|aap[\s-]?efp|estadio|grado)\b/i.test(sentence) && /\b(?:periodon|sextante|epb|gingival)\b/i.test(sentence)) {
      clarifications.push("El dictado menciona tamizaje o clasificación periodontal. No se infiere diagnóstico ni se guarda el periodontograma.");
    }
    if (/\bdiagn[oó]stico\b/i.test(sentence)) {
      clarifications.push("No se creó un diagnóstico confirmado a partir del dictado.");
    }
    if (/\bsondaje\b/i.test(sentence)) {
      const depthMatch = sentence.match(/\bsondaje(?:\s+de)?\s+(\d{1,2})([.,]\d+)?\s*(?:mm|mil[ií]metros)\b/i);
      const mentions = toothMentions(sentence).filter((item) => item.ok);
      const site = perioSite(sentence);
      if (!depthMatch) clarifications.push(`Sondaje sin milímetros enteros: «${clip(sentence)}». No se anota.`);
      else if (depthMatch[2]) clarifications.push("El sondaje con decimal no se anota. Usa milímetros enteros.");
      else if (!mentions.length) clarifications.push(`Sondaje sin una pieza identificada: «${clip(sentence)}».`);
      else if (!site) clarifications.push(`Sondaje sin un sitio reconocible: «${clip(sentence)}».`);
      else {
        const depth = Number(depthMatch[1]);
        const mention = mentions.find((item) => item.ok);
        if (mention && mention.ok && depth >= 0 && depth <= 15) {
          perio.push({
            id: nextId("per"),
            tooth: mention.tooth,
            numberingLabel: mention.numberingLabel,
            site,
            siteLabel: SITE_LABEL[site],
            depth,
            sourceText: clip(sentence),
            persisted: false,
          });
        } else clarifications.push(`Sondaje fuera de 0 a 15 mm: «${clip(sentence)}».`);
      }
      continue;
    }

    const amount = parseAmount(sentence);
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
    if (isPlan(sentence) && !isPerformed(sentence)) {
      if (/\b(?:implante|corona|exodoncia|caries|obturaci)\b/i.test(sentence)) {
        clarifications.push(`Plan o presupuesto, sin cambio de odontograma: «${clip(sentence)}».`);
      }
      continue;
    }
    if (isNegatedFinding(sentence) && !/\b(?:sana|sano|sin\s+lesi[oó]n)\b/i.test(sentence)) {
      clarifications.push(`Hallazgo negado, sin cambio de odontograma: «${clip(sentence)}».`);
      continue;
    }
    if (/\bresto\s+radicular\b/i.test(sentence) && !/\bendodoncia\b/i.test(sentence)) {
      clarifications.push("Hay un resto radicular sin decir si tiene endodoncia. No se cambió el estado general.");
    }

    const mentions = toothMentions(sentence);
    const status = statusFrom(sentence);
    const surfaceResult = status === "Ausente" || status === "Implante" ? null : findingFrom(sentence);
    if (!mentions.length && (status || surfaceResult)) {
      clarifications.push(`Falta una pieza identificable en: «${clip(sentence)}».`);
      continue;
    }
    for (const mention of mentions) {
      if (!mention.ok) {
        clarifications.push(mention.reason);
        continue;
      }
      if (status) {
        const item: OdontogramChange = {
          id: nextId("odo"),
          tooth: mention.tooth,
          numbering: mention.numbering,
          numberingLabel: mention.numberingLabel,
          sourceText: clip(sentence),
          kind: status === "Corona" ? "crown" : "status",
          status,
          ...(status === "Corona" ? { material: materialFrom(sentence), shade: shadeFrom(sentence) } : {}),
          ...((status === "Ausente" || status === "Indicación de exodoncia") && missingReasonFrom(sentence) ? { missingReason: missingReasonFrom(sentence) } : {}),
        };
        const key = dedupeKey(item);
        if (!seen.has(key)) {
          seen.add(key);
          odontogram.push(item);
        }
        continue;
      }
      if (!surfaceResult) continue;
      if ("error" in surfaceResult) {
        clarifications.push(surfaceResult.error);
        continue;
      }
      const resolved = resolveDictatedSurfaces(sentence, mention.tooth);
      for (const note of resolved.notes) clarifications.push(note);
      if (!resolved.surfaces.length) {
        if (!resolved.notes.length) clarifications.push(`Falta la superficie del hallazgo: «${clip(sentence)}».`);
        continue;
      }
      for (const surface of resolved.surfaces) {
        const item: OdontogramChange = {
          id: nextId("odo"),
          tooth: mention.tooth,
          numbering: mention.numbering,
          numberingLabel: mention.numberingLabel,
          sourceText: clip(sentence),
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

  const validated = validateProposal({ evolution: null, odontogram, budget, perio, clarifications });
  return { ...validated, evolution: composeEvolution(transcript, validated.odontogram, validated.clarifications) };
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
  if (condition !== "caries") return { condition: condition as SurfaceFinding["condition"], icdas: null, activity: null };
  const icdas = Number(record.icdas);
  const activity = text(record.activity, 16);
  if (!Number.isInteger(icdas) || icdas < 1 || icdas > 6 || !["active", "inactive", "uncertain"].includes(activity)) {
    return { error: "La caries necesita ICDAS de 1 a 6 y actividad. No se propuso la superficie." };
  }
  return { condition: "caries", icdas: icdas as SurfaceFinding["icdas"], activity: activity as SurfaceFinding["activity"] };
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
    sourceText: text(record.sourceText, 180),
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
  const blocked = new Set(odontogram.filter((item) => item.kind !== "surface" && (item.status === "Implante" || item.status === "Ausente")).map((item) => item.tooth));
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
      budget.push({ id: `pre-${budget.length + 1}`, title: text(source.title, 180) || "Presupuesto dictado", label, amount, sourceText: text(source.sourceText, 180) });
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
      });
    }
  }
  return { evolution, odontogram: kept.map((item, index) => ({ ...item, id: `odo-${index + 1}` })), budget, perio, clarifications: [...new Set(clarifications)] };
}

export function parseModelJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("El modelo no devolvió JSON.");
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

export function modelOutputToJson(result: unknown): unknown {
  if (typeof result === "string") return parseModelJson(result);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Respuesta del modelo vacía.");
  const record = result as Record<string, unknown>;
  if ("evolution" in record || "odontogram" in record || "clarifications" in record) return result;
  if (typeof record.response === "string") return parseModelJson(record.response);
  if (record.response && typeof record.response === "object") return record.response;
  throw new Error("Respuesta del modelo vacía.");
}

export const EVOLUTION_SYSTEM_PROMPT = `Redactas la evolución de un dictado odontológico en español de Chile. Devuelve solo JSON con title y body.
Los hallazgos del examen se escriben como examen. No uses «refiere», «relata» ni «dice» si el dictado no lo dice. No inventes diagnósticos, piezas, ICDAS ni negaciones. Conserva los números de piezas tal como fueron dictados.`;

export const EVOLUTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body"],
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
} as const;

export function buildModelUserPrompt(input: StructureInput): string {
  return `Dictado:\n${input.transcript.trim()}\n\nRedacta solo la evolución de este dictado.`;
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

export async function proposeFromTranscript(input: StructureInput, model: ClinicalModel | null, log: DictationLog = defaultDictationLog): Promise<StructureOutcome> {
  const transcript = input.transcript.trim();
  if (transcript.length < 3) throw new Error("El dictado está vacío.");
  if (transcript.length > 8000) throw new Error("El dictado es demasiado largo para este prototipo.");
  const local = structureTranscript(transcript);
  if (model) {
    log("dictation.evolution_not_requested", { model: model.model, reason: "deterministic_note" });
    return { engine: "reglas-locales", model: null, notice: DETERMINISTIC_NOTICE, proposal: local };
  }
  return { engine: "reglas-locales", model: null, notice: LOCAL_NOTICE, proposal: local };
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

export function planChartWrites(patientId: number, before: ChartSnapshot, after: ChartSnapshot, accepted: OdontogramChange[]): ChartAction[] {
  const actions: ChartAction[] = [];
  const acceptedStatus = new Map<number, OdontogramChange>();
  for (const item of accepted) {
    if (item.kind === "status" || item.kind === "crown") acceptedStatus.set(item.tooth, item);
  }
  const acceptedSurfaces = new Set(accepted.filter((item) => item.kind === "surface" && item.surface).map((item) => `${item.tooth}:${item.surface}`));
  const toothIds = new Set<number>([...readTeeth(before).keys(), ...readTeeth(after).keys(), ...accepted.map((item) => item.tooth)]);

  for (const tooth of [...toothIds].sort((a, b) => a - b)) {
    if (acceptedStatus.has(tooth)) continue;
    const previous = statusOf(before, tooth);
    const current = statusOf(after, tooth);
    if (previous !== current) actions.push({ action: "setToothStatus", patientId, tooth, status: previous });
    if (previous === "Corona" && current !== "Corona") {
      const crown = before.crowns?.[tooth];
      if (crown && CROWN_MATERIALS.includes(crown.material as CrownMaterial)) {
        actions.push({ action: "setCrownDetails", patientId, tooth, material: crown.material, shade: crown.shade || "" });
      }
    }
  }

  for (const item of accepted) {
    if (item.kind !== "status" && item.kind !== "crown") continue;
    const status = item.kind === "crown" ? "Corona" : item.status;
    if (!status) continue;
    actions.push({ action: "setToothStatus", patientId, tooth: item.tooth, status });
    if (item.missingReason && (status === "Ausente" || status === "Indicación de exodoncia")) {
      actions.push({ action: "setToothMissingReason", patientId, tooth: item.tooth, reason: item.missingReason });
    }
    if (status === "Corona" && item.material) {
      actions.push({ action: "setCrownDetails", patientId, tooth: item.tooth, material: item.material, shade: item.shade || "" });
    }
  }

  const blocksSurfaces = (tooth: number) => {
    const acceptedItem = acceptedStatus.get(tooth);
    const status = acceptedItem ? (acceptedItem.kind === "crown" ? "Corona" : acceptedItem.status) : statusOf(before, tooth);
    return status === "Implante" || status === "Ausente";
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
        const finding = prior.condition === "caries" && prior.icdas && prior.activity
          ? { condition: "caries" as const, icdas: prior.icdas, activity: prior.activity }
          : { condition: prior.condition === "caries" ? "sound" as const : prior.condition, icdas: null, activity: null };
        actions.push({ action: "setToothSurface", patientId, tooth, surface, finding });
      }
    }
  }

  for (const item of accepted) {
    if (item.kind === "surface" && item.surface && item.finding && !blocksSurfaces(item.tooth)) {
      actions.push({ action: "setToothSurface", patientId, tooth: item.tooth, surface: item.surface, finding: item.finding });
    }
  }
  return actions;
}

export type SavedNote = { id?: number; patientId: number; title: string; body: string };
export type SavedBudget = { id?: number; patientId: number; title: string; items: { label: string; amount: number }[] };

export function verifyDictationSave(input: {
  patientId: number;
  before: ChartSnapshot;
  note: { id?: number; title: string; body: string } | null;
  accepted: OdontogramChange[];
  budgets: BudgetChange[];
  savedBudgetIds?: number[];
}, snapshot: { notes: SavedNote[]; budgets: SavedBudget[]; toothStatuses: Record<number, ChartSnapshot | undefined> }): { ok: boolean; messages: string[] } {
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
    if (item.kind === "crown") acceptedStatus.set(item.tooth, "Corona");
  }
  const toothIds = new Set<number>([...readTeeth(input.before).keys(), ...readTeeth(chart).keys(), ...acceptedStatus.keys()]);
  for (const tooth of toothIds) {
    const actual = statusOf(chart, tooth);
    const expected = acceptedStatus.get(tooth) ?? statusOf(input.before, tooth);
    if (actual !== expected) errors.push(`FDI ${formatFdi(tooth)} quedó «${actual}» y se esperaba «${expected}».`);
  }
  for (const item of input.accepted) {
    if (item.kind === "crown" && item.material) {
      const crown = chart.crowns?.[item.tooth];
      if (!crown || crown.material !== item.material || (crown.shade || "") !== (item.shade || "")) errors.push(`La corona de FDI ${formatFdi(item.tooth)} no coincide al releer.`);
      else messages.push(`Corona FDI ${formatFdi(item.tooth)}: ${item.material}.`);
    }
    if (item.kind === "surface" && item.surface && item.finding) {
      const actual = chart.surfaces?.[item.tooth]?.[item.surface];
      if (!actual || actual.condition !== item.finding.condition || (actual.icdas ?? null) !== item.finding.icdas || (actual.activity ?? null) !== item.finding.activity) {
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
  if (!errors.length && !messages.length) messages.push("No había cambios aceptados para guardar.");
  return { ok: errors.length === 0, messages: [...messages, ...errors] };
}
