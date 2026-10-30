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
const FALLBACK_NOTICE = "No se pudo usar el modelo en este momento. La propuesta salió del estructurador local y sigue sujeta a tu revisión.";

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

function toothMentions(sentence: string): Mention[] {
  const mentions: Mention[] = [];
  const numbered = /\b(?:pieza|diente)\s+(?:(fdi|iso|chilena|nacional|universal|estadounidense|ee\.?\s*uu\.?|ada)\s+)?(\d{1,2}(?:\.\d)?)\b|\b(fdi|iso|chilena|nacional|universal|estadounidense|ee\.?\s*uu\.?|ada)\s+(\d{1,2}(?:\.\d)?)\b/gi;
  for (const match of sentence.matchAll(numbered)) {
    mentions.push(interpretTooth(match[2] || match[4], match[1] || match[3]));
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

function surfacesIn(sentence: string): OdontogramSurface[] {
  const found: OdontogramSurface[] = [];
  if (/\b(?:oclusal|oclual|incisal)\b/i.test(sentence)) found.push("O");
  if (/\b(?:vestibular|bucal|labial)\b/i.test(sentence)) found.push("V");
  if (/\b(?:palatin[oa]|lingual)\b/i.test(sentence)) found.push("P");
  if (/\bmesial\b/i.test(sentence)) found.push("M");
  if (/\bdistal\b/i.test(sentence)) found.push("D");
  return found;
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
  if (/\bmetal[ -]?cer[aá]mica\b/i.test(sentence)) return "Metal cerámica";
  if (/\bresina\b/i.test(sentence)) return "Resina";
  if (/\botro\s+material\b/i.test(sentence)) return "Otro";
  return undefined;
}

function shadeFrom(sentence: string): string | null {
  return sentence.match(/\b(?:color|shade)\s+([A-D][1-4](?:\.5)?)\b/i)?.[1]?.toUpperCase() ?? null;
}

function missingReasonFrom(sentence: string): OdontogramChange["missingReason"] | undefined {
  if (/\bpor\s+caries\b/i.test(sentence)) return "caries";
  if (/\botra\s+causa\b/i.test(sentence)) return "other";
  if (/\bcausa\s+(?:desconocida|no\s+precisada)\b/i.test(sentence)) return "unknown";
  return undefined;
}

function statusFrom(sentence: string): ToothStatus | null {
  if (/\bresto\s+radicular\b/i.test(sentence) && /\bendodoncia\b/i.test(sentence)) return "Resto radicular con endodoncia";
  if (/\bindicaci[oó]n\s+de\s+exodoncia\b/i.test(sentence)) return "Indicación de exodoncia";
  if (/\bimplante\b/i.test(sentence) && isPerformed(sentence)) return "Implante";
  if (/\b(?:corona|pr[oó]tesis\s+fija\s+definitiva)\b/i.test(sentence) && isPerformed(sentence) && !/\bprovisori[ao]\b/i.test(sentence)) return "Corona";
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

function composeEvolution(transcript: string): { title: string; body: string } | null {
  const clean = transcript.trim();
  if (!clean) return null;
  const relato: string[] = [];
  const examen: string[] = [];
  const procedimientos: string[] = [];
  const presupuesto: string[] = [];
  const resto: string[] = [];
  for (const sentence of sentences(clean)) {
    const line = ensurePeriod(sentence);
    if (isPatient(sentence)) relato.push(/\b(?:refiere|niega)\b/i.test(sentence) ? line : `Refiere: ${line}`);
    else if (/\b(?:presupuesto|cotizaci[oó]n)\b/i.test(sentence)) presupuesto.push(line);
    else if (isPerformed(sentence)) procedimientos.push(line);
    else if (/\b(?:se\s+observa|caries|obturaci|sellante|sondaje|ausente|hallazgo)\b/i.test(sentence)) examen.push(line);
    else resto.push(line);
  }
  const lines = ["Dictado para revisión. Lo que no aparece aquí queda sin registrar. Una negación solo se anota si fue dicha."];
  if (relato.length) lines.push("", "Relato", ...relato);
  if (examen.length) lines.push("", "Examen", ...examen);
  if (procedimientos.length) lines.push("", "Procedimientos", ...procedimientos);
  if (presupuesto.length) lines.push("", "Presupuesto mencionado", ...presupuesto);
  if (resto.length) lines.push("", "Otros dichos", ...resto);
  return { title: "Evolución dictada", body: lines.join("\n") };
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
      clarifications.push(`Presupuesto sin monto en pesos: «${clip(sentence)}».`);
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
    const surfaces = status ? [] : surfacesIn(sentence);
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
      if (!surfaces.length) {
        clarifications.push(`Falta la superficie del hallazgo: «${clip(sentence)}».`);
        continue;
      }
      for (const surface of surfaces) {
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

  return validateProposal({
    evolution: composeEvolution(transcript),
    odontogram,
    budget,
    perio,
    clarifications,
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
      if (!label || !Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000_000) {
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

const MODEL_EXAMPLES = `Ejemplos (no son el dictado actual):
1. «Pieza 30 caries oclusal. Pieza 12 obturación oclusal de resina.» → tooth 24, numbering chilena, kind surface, surface O, finding restored. La caries de la pieza 30 no lleva ICDAS ni actividad: no crees ítem y pídelo en clarifications. No uses Corona.
2. «Se cementó corona de zirconio color A2 en FDI 2.1.» → tooth 21, kind crown, status Corona, material Zirconio, shade A2.
3. «El paciente refiere dolor. Niega alergia a penicilina.» → evolution con esas dos frases, odontogram vacío. No inventes otras negaciones.`;

export function buildModelUserPrompt(input: StructureInput): string {
  const chart = input.chart.length
    ? input.chart.map((item) => `FDI ${formatFdi(item.tooth)} (código ${item.tooth}): ${item.status}`).join("\n")
    : "Sin estados generales registrados.";
  return `${MODEL_EXAMPLES}\n\nTranscripción a estructurar:\n${input.transcript.trim()}\n\nEstado general ya guardado, sin nombre del paciente:\n${chart}\n\nDevuelve solo el JSON de esta transcripción.`;
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

function isEmptyProposal(proposal: DictationProposal): boolean {
  return !proposal.evolution && proposal.odontogram.length === 0 && proposal.budget.length === 0 && proposal.perio.length === 0 && proposal.clarifications.length === 0;
}

export function fdiTeethInText(text: string): number[] {
  return [...new Set(toothMentions(text).flatMap((mention) => mention.ok ? [mention.tooth] : []))];
}

function supportsCrown(text: string): boolean {
  return /\b(?:corona|pr[oó]tesis\s+fija\s+definitiva)\b/i.test(text) && PERFORMED.test(text);
}

function supportsImplant(text: string): boolean {
  return /\bimplante\b/i.test(text) && PERFORMED.test(text) && !/\b(?:presupuesto|cotizaci[oó]n|se\s+planifica|se\s+indica)\b/i.test(text);
}

function evolutionMatches(transcript: string, body: string): boolean {
  const words = transcript.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
  const haystack = body.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const hits = words.filter((word) => haystack.includes(word));
  return hits.length >= Math.min(2, Math.max(words.length, 1));
}

function inconsistency(transcript: string, item: OdontogramChange): string | null {
  if (!fdiTeethInText(transcript).includes(item.tooth)) return "tooth_not_in_transcript";
  const evidence = item.sourceText.trim() || transcript;
  if (isPatient(evidence) && !/\bse\s+observa\b/i.test(evidence)) return "patient_statement";
  if (item.kind === "crown" || item.status === "Corona") {
    if (/\b(?:caries|obturaci)/i.test(evidence) && !supportsCrown(evidence)) return "crown_on_surface_finding";
    if (!supportsCrown(evidence) && !supportsCrown(transcript)) return "crown_without_cementation";
  }
  if (item.status === "Implante" && !supportsImplant(evidence) && !supportsImplant(transcript)) return "implant_without_placement";
  if ((item.status === "Ausente" || item.status === "Indicación de exodoncia") && !/\b(?:ausente|extra[ií]d|exodonciad|indicaci[oó]n\s+de\s+exodoncia)/i.test(`${evidence}\n${transcript}`)) return "absence_not_dictated";
  if (item.kind === "surface" && item.finding?.condition === "caries" && !/\bcaries\b/i.test(`${evidence}\n${transcript}`)) return "caries_not_dictated";
  if (item.kind === "surface" && item.finding?.condition === "restored" && !/\b(?:obturaci|restauraci|resina)\b/i.test(`${evidence}\n${transcript}`)) return "restoration_not_dictated";
  if (item.kind === "surface" && item.finding?.condition === "sealant" && !/\bsellante\b/i.test(`${evidence}\n${transcript}`)) return "sealant_not_dictated";
  return null;
}

export type DictationLog = (event: string, detail: Record<string, string | number>) => void;

const defaultDictationLog: DictationLog = (event, detail) => {
  console.error(event, detail);
};

/** Quita cambios que el dictado no sostiene. Si el modelo no deja un odontograma compatible, usa la lectura local. */
export function alignProposalWithTranscript(transcript: string, proposal: DictationProposal): { proposal: DictationProposal; rejected: string[] } {
  const local = structureTranscript(transcript);
  const rejected: string[] = [];
  const odontogram = proposal.odontogram.filter((item) => {
    const reason = inconsistency(transcript, item);
    if (reason) rejected.push(reason);
    return !reason;
  });
  const budget = proposal.budget.filter(() => {
    if (/\b(?:pesos|clp)\b|\$/i.test(transcript)) return true;
    rejected.push("budget_without_amount");
    return false;
  });
  const perio = proposal.perio.filter(() => {
    if (/\bsondaje\b/i.test(transcript)) return true;
    rejected.push("perio_without_probing");
    return false;
  });
  let evolution = proposal.evolution;
  if (!evolution?.body || !evolutionMatches(transcript, evolution.body)) {
    if (proposal.evolution?.body) rejected.push("evolution_unrelated");
    evolution = local.evolution;
  }
  const clarifications = [...proposal.clarifications];
  const chart = odontogram.length > 0 ? odontogram : local.odontogram;
  if (odontogram.length === 0 && local.odontogram.length > 0) {
    clarifications.push("El odontograma sigue la lectura local del dictado, porque el modelo no dejó un cambio compatible.");
  }
  const alignedBudget = budget.length > 0 ? budget : local.budget;
  const alignedPerio = perio.length > 0 ? perio : local.perio;
  if (budget.length === 0 && local.budget.length > 0 && proposal.budget.length > 0) clarifications.push("El presupuesto del modelo no coincidía con un monto dictado.");
  return {
    rejected,
    proposal: validateProposal({
      evolution,
      odontogram: chart,
      budget: alignedBudget,
      perio: alignedPerio,
      clarifications: [...new Set([...clarifications, ...(odontogram.length === 0 ? local.clarifications : [])])],
    }),
  };
}

export async function proposeFromTranscript(input: StructureInput, model: ClinicalModel | null, log: DictationLog = defaultDictationLog): Promise<StructureOutcome> {
  const transcript = input.transcript.trim();
  if (transcript.length < 3) throw new Error("El dictado está vacío.");
  if (transcript.length > 8000) throw new Error("El dictado es demasiado largo para este prototipo.");
  const safe: StructureInput = { transcript, chart: sanitizeChart(input.chart) };
  if (model) {
    try {
      const raw = await model.complete(safe);
      const proposal = validateProposal(typeof raw === "string" ? parseModelJson(raw) : raw);
      const aligned = alignProposalWithTranscript(transcript, proposal);
      if (aligned.rejected.length) log("dictation.model_items_rejected", { model: model.model, rejected: aligned.rejected.length, reasons: aligned.rejected.slice(0, 8).join(",") });
      if (isEmptyProposal(aligned.proposal)) throw new Error("propuesta vacía");
      return { engine: model.id, model: model.model, notice: null, proposal: aligned.proposal };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "error";
      log("dictation.workers_ai_failed", { model: model.model, message: message.slice(0, 300) });
      return { engine: "reglas-locales", model: null, notice: FALLBACK_NOTICE, proposal: structureTranscript(transcript) };
    }
  }
  return { engine: "reglas-locales", model: null, notice: LOCAL_NOTICE, proposal: structureTranscript(transcript) };
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
