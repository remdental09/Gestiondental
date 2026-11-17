/**
 * Presupuesto rápido por dictado: «dónde → qué», tramo a tramo. Ejemplo:
 *   «36 exodoncia. 14 15 resina dos caras. 2.6 endodoncia. Cuadrante 2 pulido radicular. Boca completa destartraje»
 * La pieza se dice en FDI (36, 3.6) o en numeración chilena si se dice «chilena» / «chile» (los números con punto son
 * siempre FDI). Cada tramo se resuelve contra el arancel con las mismas reglas del dictado clínico; si no hay una
 * prestación clara, el tramo queda para que el profesional la elija. Sin precios: los pone el arancel propio después.
 */
import { candidatePrestaciones, prestacionByCode, prestacionLabel } from "./prestaciones-catalog.ts";
import { prestacionCodesForSegment } from "./dictation/prestaciones.ts";
import { numberRuns, fold } from "./dictation/spoken.ts";
import { chileToFdiTooth, formatFdiTooth, isFdiTooth, type ToothNumbering } from "./tooth-numbering.ts";
import { priceUnitFromName, zoneSummary, zoneTeeth, zoneValue, type PriceUnit } from "./treatment-zones.ts";
import type { BudgetItem } from "./budget-plans.ts";

export type QuickOption = { code: string; name: string };
export type QuickRow = {
  id: string;
  /** Lo que se dijo en este tramo. */
  source: string;
  teeth: number[];
  /** Zona («perm:cuad-2», «perm:boca»); vacía si es por pieza o general. */
  zone: string;
  code: string | null;
  label: string;
  /** No se pudo elegir una prestación con seguridad: el profesional la elige de `options`. */
  needsChoice: boolean;
  options: QuickOption[];
};
export type QuickParse = { rows: QuickRow[]; numbering: ToothNumbering; leftovers: string[] };

const NEUTRAL = new Set(["pieza", "piezas", "diente", "dientes", "numero", "numeros", "la", "el", "los", "las", "del", "en", "de", "al", "a", "y", "e", "con", "para", "luego", "despues", "tambien", "ademas", "hasta"]);
const QUANTITY_AFTER = /^\s*(?:caras?|superficies?|conductos?|mil\b|pesos|sesiones|ampollas?|controles?|veces|milimetros|mm\b|%)/;
const FACE_WORDS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
const PER_TOOTH = /exodon|extracci|obturaci|restauraci|resina|composite|amalgama|endodon|conducto|corona|sellante|implante|incrustaci|carilla|pulpotom|inactivaci|retratamiento/;
const ARCHES: number[][] = [
  [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
  [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
];

/** «tres seis» → «36», «treinta» → «30» (chilena): solo los números que pueden ser una pieza; cantidades («tres conductos») quedan como palabras. */
function spokenToDigits(text: string, numbering: ToothNumbering): string {
  const runs = numberRuns(text).filter((run) => run.spoken);
  let out = "";
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const next = runs[i + 1];
    if (QUANTITY_AFTER.test(text.slice(run.end))) continue;
    const pair = numbering === "fdi" && next && run.value >= 1 && run.value <= 8 && next.value >= 1 && next.value <= 8 && /^\s+(?:punto\s+)?$/.test(text.slice(run.end, next.start)) && !QUANTITY_AFTER.test(text.slice(next.end));
    const alone = numbering === "fdi" ? isFdiTooth(run.value) : run.value >= 1 && run.value <= 32 && !/^(?:un|una|uno)$/.test(run.text);
    if (pair) {
      out += text.slice(at, run.start) + `${run.value}${/punto/.test(text.slice(run.end, next.start)) ? "." : ""}${next.value}`;
      at = next.end;
      i++;
    } else if (alone) {
      out += text.slice(at, run.start) + String(run.value);
      at = run.end;
    }
  }
  return (out + text.slice(at)).replace(/(?<=\d)\s+punto\s+(?=\d)/gi, ".");
}

function numberingOf(plain: string, fallback: ToothNumbering): { numbering: ToothNumbering; rest: string } {
  const chile = plain.search(/\b(?:numeracion\s+)?(?:chilena|chile|nacional)\b/);
  const fdi = plain.search(/\b(?:numeracion\s+)?(?:fdi|internacional)\b/);
  const rest = plain.replace(/\b(?:numeracion\s+)?(?:chilena|chile|nacional|fdi|internacional)\b/g, " ");
  if (chile >= 0 && (fdi < 0 || chile < fdi)) return { numbering: "chile", rest };
  if (fdi >= 0) return { numbering: "fdi", rest };
  return { numbering: fallback, rest };
}

const ZONE_MARK = "@@z:";
const FACES_MARK = "@@f:";
const LIST = "(\\d(?:\\s*(?:,|y|e)\\s*\\d)*)";

/** Zonas dichas («cuadrante 2», «cuadrantes 1 y 2», «boca completa») pasan a una marca que hace de «dónde». */
function markZones(chunk: string): string {
  const temp = /\b(?:temporales?|de leche|deciduos?|infantil|pediatric\w*)\b/.test(chunk);
  const dentition = temp ? "temp" : "perm";
  const mark = (key: string) => ` ${ZONE_MARK}${zoneValue(dentition, key)}@@ `;
  const marks = (kind: string, max: number) => (_all: string, list: string) => (list.match(/\d/g) ?? []).filter((n) => Number(n) >= 1 && Number(n) <= max).map((n) => mark(`${kind}-${n}`)).join("");
  return chunk
    .replace(/\b(?:toda\s+la\s+boca|boca\s+completa|boca\s+entera)\b/g, mark("boca"))
    .replace(/\b(?:arcada|maxilar)\s+(superior|inferior)\b/g, (_all, side: string) => mark(side === "superior" ? "arc-sup" : "arc-inf"))
    .replace(new RegExp(`\\bcuadrantes?\\s+${LIST}`, "g"), marks("cuad", 4))
    .replace(new RegExp(`\\bsextantes?\\s+${LIST}`, "g"), marks("sext", 6))
    .replace(/\b(anteriores?|posteriores?)\s+(superiores?|inferiores?)\b/g, (_all, kind: string, side: string) => mark(`${kind.startsWith("ant") ? "ant" : "post"}-${side.startsWith("sup") ? "sup" : "inf"}`))
    .replace(/\bpremolares\b/g, mark("premolares"))
    .replace(/\bmolares\b/g, mark("molares"));
}

function toothOf(token: string, numbering: ToothNumbering): number | null {
  const value = token.replace(/[,;:]+$/, "");
  const dotted = value.match(/^([1-8])[.,]([1-8])$/);
  if (dotted) { const tooth = Number(dotted[1]) * 10 + Number(dotted[2]); return isFdiTooth(tooth) ? tooth : null; }
  if (numbering === "chile") return /^\d{1,2}$/.test(value) ? chileToFdiTooth(value) : null;
  if (/^[1-8][1-8]$/.test(value)) { const tooth = Number(value); return isFdiTooth(tooth) ? tooth : null; }
  return null;
}

type Segment = { teeth: number[]; zones: string[]; words: string[]; faces: number; treated: boolean; pre: boolean; post: boolean; problems: string[] };
const emptySegment = (): Segment => ({ teeth: [], zones: [], words: [], faces: 0, treated: false, pre: false, post: false, problems: [] });
const whereLabel = (segment: Pick<Segment, "teeth" | "zones">) => [...segment.teeth.map((t) => `FDI ${formatFdiTooth(t)}`), ...segment.zones.map((z) => zoneSummary(z))].join(", ");

function segmentsOf(plain: string, numbering: ToothNumbering): Segment[] {
  const out: Segment[] = [];
  let carry: Segment | null = null;
  for (const chunk of plain.split(/[;\n]+|\.(?!\d)/)) {
    const marked = markZones(chunk.replace(/\b(\d|un|una|dos|tres|cuatro|cinco)\s+(?:caras?|superficies?)\b/g, (_all, n: string) => ` ${FACES_MARK}${FACE_WORDS[n] ?? n}@@ `));
    const tokens = marked.split(/\s+/).filter(Boolean);
    let current: Segment = carry ?? emptySegment();
    carry = null;
    let lastWasTooth = false;
    const flush = () => { if (current.teeth.length || current.zones.length || current.words.length) out.push(current); current = emptySegment(); };
    const attach = (apply: () => void) => {
      if (current.treated && current.pre) flush();
      apply();
      if (current.treated) current.post = true; else current.pre = true;
    };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith(FACES_MARK)) { current.faces = Number(token.slice(FACES_MARK.length, -2)); continue; }
      const word = token.replace(/[,:]+$/, "");
      if (token.startsWith(ZONE_MARK)) { attach(() => current.zones.push(token.slice(ZONE_MARK.length, -2))); lastWasTooth = false; continue; }
      const quantity = /^\d{1,3}$/.test(word) && QUANTITY_AFTER.test(" " + tokens.slice(i + 1).join(" "));
      const tooth = quantity ? null : toothOf(token, numbering);
      if (tooth !== null) { attach(() => current.teeth.push(tooth)); lastWasTooth = true; continue; }
      // «del 14 al 17», «36 a la 38»: rango dentro de la misma arcada, pasando por la línea media.
      if (lastWasTooth && (word === "al" || word === "a" || word === "hasta")) {
        let j = i + 1;
        while (tokens[j] === "la" || tokens[j] === "el") j++;
        const to = tokens[j] ? toothOf(tokens[j], numbering) : null;
        const from = current.teeth[current.teeth.length - 1];
        if (to !== null && from !== undefined) {
          const arch = ARCHES.find((list) => list.includes(from) && list.includes(to));
          if (arch) {
            const [x, y] = [arch.indexOf(from), arch.indexOf(to)];
            const step = y > x ? 1 : -1;
            for (let k = x + step; k !== y + step; k += step) current.teeth.push(arch[k]);
          } else current.problems.push(`rango entre ${formatFdiTooth(from)} y ${formatFdiTooth(to)} (no están en la misma arcada)`);
          i = j;
          lastWasTooth = true;
          continue;
        }
      }
      if (NEUTRAL.has(word) && (!current.treated || current.post)) continue;
      // Un número suelto que no es pieza (ni cantidad) no se descarta en silencio.
      if (/^\d{1,3}$/.test(word) && !quantity) {
        current.problems.push(`«${word}» no es una pieza válida en numeración ${numbering === "chile" ? "chilena (1–32; ¿era FDI?)" : "FDI"}`);
        lastWasTooth = false;
        continue;
      }
      lastWasTooth = false;
      // «resina 36 ocluso distal»: la cara dicha tras la pieza es parte del mismo tratamiento.
      if (current.post && !/^(?:ocluso|oclusal|mesio|mesial|disto|distal|vestibulo|vestibular|palato|palatin[oa]|linguo|lingual|incisal|mod|mo|od|do)\S*$/.test(word)) flush();
      current.words.push(word);
      current.treated = true;
    }
    // Pieza o zona dicha sola («36.» y luego «Exodoncia.»): pasa al tramo siguiente.
    if (!current.words.length && (current.teeth.length || current.zones.length) && !current.problems.length) carry = current;
    else flush();
  }
  if (carry) out.push(carry);
  return out;
}

const sentence = (value: string) => value.trim().replace(/\s+/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/** Caras de una restauración: «dos caras», «ocluso distal», «mod». Sin indicio, una. */
function facesOf(text: string, said: number): number {
  const roots = (text.match(/ocluso|oclusal|mesio|mesial|disto|distal|vestibulo|vestibular|palato|palatin[oa]|linguo|lingual|incisal/g) ?? []).length;
  const initials = /\bmod\b/.test(text) ? 3 : /\b(?:mo|od|do)\b/.test(text) ? 2 : 0;
  return Math.max(said, roots, initials, 1);
}

/**
 * Un implante lleva su corona: «implante» dicho solo propone la cirugía y la prótesis fija unitaria cementada sobre implante
 * (5011046; «atornillada» → 5011045). «Sin corona» deja solo la cirugía. Otros actos con implante (retiro, control, mantención…) no.
 */
function codesFor(text: string, tooth: number | null, faces: number): string[] {
  if (/\bimplantes?\b/.test(text) && !/retiro|remocion|explant|mantencion|control|cone\s*beam|informe|microtornillo|\bmini\b|periimplant|conexion|pilar|prueba|digitaliz|provision|ferulizacion/.test(text)) {
    if (/sin\s+corona/.test(text)) return ["5011001"];
    return ["5011001", /atornillad/.test(text) ? "5011045" : "5011046"];
  }
  return prestacionCodesForSegment(text, tooth, faces);
}

const COMPLEX_EXTRACTION = /quirurgic|compleja|retenid|incluid|cordal|tercer\s+molar/;

/** Piezas dichas con prestaciones del arancel; devuelve las filas del presupuesto y lo que no se pudo usar. */
export function parseQuickBudget(raw: string, fallback: ToothNumbering = "fdi"): QuickParse {
  const first = numberingOf(fold(raw.normalize("NFC")), fallback);
  const { numbering } = first;
  const rest = spokenToDigits(first.rest, numbering);
  const rows: QuickRow[] = [];
  const leftovers: string[] = [];
  const seen = new Set<string>();
  let counter = 0;
  const push = (row: Omit<QuickRow, "id">) => {
    const key = `${row.code ?? row.label}|${row.zone}|${row.teeth.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...row, id: `qb-${++counter}` });
  };
  for (const segment of segmentsOf(rest, numbering)) {
    for (const problem of segment.problems) leftovers.push(problem);
    const words = [...segment.words];
    while (words.length && (NEUTRAL.has(words[words.length - 1]) || words[words.length - 1] === "pieza")) words.pop();
    const text = words.join(" ").trim();
    const zones = [...new Set(segment.zones)];
    let where = [...new Set(segment.teeth)];
    const source = [whereLabel({ teeth: where, zones }), text].filter(Boolean).join(" · ");
    if (!text) { if (where.length || zones.length) leftovers.push(`falta el tratamiento de ${whereLabel({ teeth: where, zones })}`); continue; }
    const faces = facesOf(text, segment.faces);
    const options = candidatePrestaciones(text, 6).map(({ code, name }) => ({ code, name: prestacionLabel(name) }));
    const unresolved = (teeth: number[], zone: string) => push({ source, teeth, zone, code: null, label: sentence(text), needsChoice: true, options });
    const resolved = (code: string, teeth: number[], zone: string) => {
      const found = prestacionByCode(code);
      if (!found || (code === "5003001" && COMPLEX_EXTRACTION.test(text))) return unresolved(teeth, zone);
      push({ source, teeth, zone, code, label: prestacionLabel(found.name), needsChoice: false, options });
    };
    // Una zona con un tratamiento que se cobra por pieza («cuadrante 2 exodoncia») es una fila por cada pieza de la zona.
    if (zones.length && PER_TOOTH.test(text)) {
      const covered = zones.flatMap((zone) => zoneTeeth(zone));
      if (covered.length > 16) { for (const zone of zones) unresolved([], zone); continue; }
      where = [...new Set([...where, ...covered])];
      zones.length = 0;
    }
    if (zones.length) {
      for (const zone of zones) {
        const codes = codesFor(text, null, faces);
        if (!codes.length) unresolved([], zone);
        for (const code of codes) resolved(code, [], zone);
      }
      continue;
    }
    if (where.length) {
      const byCode = new Map<string, number[]>();
      const missing: number[] = [];
      for (const tooth of where) {
        const codes = codesFor(text, tooth, faces);
        if (!codes.length) missing.push(tooth);
        for (const code of codes) byCode.set(code, [...(byCode.get(code) ?? []), tooth]);
      }
      for (const [code, teeth] of byCode) {
        const unit: PriceUnit | null = priceUnitFromName(prestacionByCode(code)?.name ?? "");
        // Prestación que se cobra por sextante, cuadrante, arcada o boca: una sola fila con las piezas nombradas.
        if (unit && unit !== "pieza" && unit !== "cara") resolved(code, teeth, "");
        else for (const tooth of teeth) resolved(code, [tooth], "");
      }
      if (missing.length) unresolved(missing, "");
      continue;
    }
    const codes = codesFor(text, null, faces);
    if (!codes.length) unresolved([], "");
    for (const code of codes) resolved(code, [], "");
  }
  return { rows, numbering, leftovers };
}

/** Fila del presupuesto rápido → prestación del plan; `amount` 0 = valor por definir. */
export function quickRowToItem(row: QuickRow, amount: number): BudgetItem {
  return {
    label: row.label,
    amount: Number.isSafeInteger(amount) && amount > 0 ? amount : 0,
    phase: "Fase 1",
    discountPercent: 0,
    ...(row.code ? { code: row.code } : {}),
    ...(row.zone ? { zone: row.zone } : { ...(row.teeth.length ? { teeth: row.teeth } : {}) }),
  };
}

export const QUICK_BUDGET_EXAMPLE = "36 exodoncia. 14 15 resina dos caras. 2.6 endodoncia. Cuadrante 2 pulido radicular. Boca completa destartraje";
