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
import { chileToFdiTooth, isFdiTooth, type ToothNumbering } from "./tooth-numbering.ts";
import { priceUnitFromName, zoneValue, type PriceUnit } from "./treatment-zones.ts";
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

const NEUTRAL = new Set(["pieza", "piezas", "diente", "dientes", "numero", "numeros", "la", "el", "los", "las", "del", "en", "de", "al", "a", "y", "e", "con", "para", "luego", "despues", "tambien", "ademas"]);
const FACE_NAMES = /\b(oclusal|mesial|distal|vestibular|palatin[oa]|lingual|incisal)\b/g;

/** «tres seis» → «36», «tres punto seis» → «3.6»: los números dichos con palabras pasan a cifras. */
function spokenToDigits(text: string): string {
  const runs = numberRuns(text).filter((run) => run.spoken);
  let out = "";
  let at = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const next = runs[i + 1];
    out += text.slice(at, run.start);
    // Dos dígitos dichos seguidos («tres seis») son una pieza FDI.
    if (next && run.value >= 1 && run.value <= 8 && next.value >= 1 && next.value <= 8 && /^\s+$/.test(text.slice(run.end, next.start))) {
      out += `${run.value}${next.value}`;
      at = next.end;
      i++;
    } else {
      out += String(run.value);
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

/** Zonas dichas («cuadrante 2», «boca completa», «anteriores superiores») pasan a una marca que hace de «dónde». */
function markZones(chunk: string): string {
  const temp = /\b(?:temporales?|de leche|deciduos?|infantil|pediatric\w*)\b/.test(chunk);
  const dentition = temp ? "temp" : "perm";
  const mark = (key: string) => ` ${ZONE_MARK}${zoneValue(dentition, key)}@@ `;
  return chunk
    .replace(/\b(?:toda\s+la\s+boca|boca\s+completa|boca\s+entera)\b/g, mark("boca"))
    .replace(/\b(?:arcada|maxilar)\s+(superior|inferior)\b/g, (_all, side: string) => mark(side === "superior" ? "arc-sup" : "arc-inf"))
    .replace(/\bcuadrante\s+([1-4])\b/g, (_all, n: string) => mark(`cuad-${n}`))
    .replace(/\bsextante\s+([1-6])\b/g, (_all, n: string) => mark(`sext-${n}`))
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

type Segment = { teeth: number[]; zones: string[]; words: string[]; faces: number; treated: boolean };
const emptySegment = (): Segment => ({ teeth: [], zones: [], words: [], faces: 0, treated: false });

function segmentsOf(plain: string, numbering: ToothNumbering): Segment[] {
  const out: Segment[] = [];
  for (const chunk of plain.split(/[;\n]+|\.(?!\d)/)) {
    const marked = markZones(chunk.replace(/\b(\d)\s+caras?\b/g, ` ${FACES_MARK}$1@@ `));
    const tokens = marked.split(/\s+/).filter(Boolean);
    let current = emptySegment();
    const flush = () => { if (current.teeth.length || current.zones.length || current.words.length) out.push(current); current = emptySegment(); };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith(FACES_MARK)) { current.faces = Number(token.slice(FACES_MARK.length, -2)); continue; }
      const word = token.replace(/[,:]+$/, "");
      if (token.startsWith(ZONE_MARK)) {
        if (current.treated) flush();
        current.zones.push(token.slice(ZONE_MARK.length, -2));
        continue;
      }
      const tooth = toothOf(token, numbering);
      if (tooth !== null) {
        if (current.treated) flush();
        current.teeth.push(tooth);
        continue;
      }
      // «del 14 al 17»: rango dentro de la misma arcada.
      if ((word === "al" || word === "a" || word === "hasta") && !current.treated && current.teeth.length && tokens[i + 1]) {
        const to = toothOf(tokens[i + 1], numbering);
        const from = current.teeth[current.teeth.length - 1];
        if (to !== null && Math.floor(to / 10) === Math.floor(from / 10) && to !== from) {
          const step = to > from ? 1 : -1;
          for (let t = from + step; t !== to + step; t += step) if (isFdiTooth(t)) current.teeth.push(t);
          i++;
          continue;
        }
      }
      if (!current.treated && NEUTRAL.has(word)) continue;
      current.words.push(word);
      current.treated = true;
    }
    flush();
  }
  return out;
}

const sentence = (value: string) => value.trim().replace(/\s+/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/** Piezas dichas con prestaciones del arancel; devuelve las filas del presupuesto y lo que no se pudo usar. */
export function parseQuickBudget(raw: string, fallback: ToothNumbering = "fdi"): QuickParse {
  const { numbering, rest } = numberingOf(fold(spokenToDigits(raw.normalize("NFC"))), fallback);
  const rows: QuickRow[] = [];
  const leftovers: string[] = [];
  let counter = 0;
  const push = (row: Omit<QuickRow, "id">) => rows.push({ ...row, id: `qb-${++counter}` });
  for (const segment of segmentsOf(rest, numbering)) {
    const text = segment.words.join(" ").trim();
    const where = [...new Set(segment.teeth)];
    const source = [where.length ? where.map((t) => `${Math.floor(t / 10)}.${t % 10}`).join(" ") : "", segment.zones.length ? segment.zones.join(" ") : "", text].filter(Boolean).join(" ");
    if (!text) { leftovers.push(source || "tramo vacío"); continue; }
    const faceNames = new Set(text.match(FACE_NAMES) ?? []).size;
    const faces = segment.faces || faceNames || 1;
    const options = candidatePrestaciones(text, 6).map(({ code, name }) => ({ code, name: prestacionLabel(name) }));
    const unresolved = (teeth: number[], zone: string) => push({ source, teeth, zone, code: null, label: sentence(text), needsChoice: true, options });
    const resolved = (code: string, teeth: number[], zone: string) => {
      const found = prestacionByCode(code);
      if (!found) return unresolved(teeth, zone);
      push({ source, teeth, zone, code, label: prestacionLabel(found.name), needsChoice: false, options });
    };
    if (segment.zones.length) {
      for (const zone of [...new Set(segment.zones)]) {
        const codes = prestacionCodesForSegment(text, null, faces);
        if (!codes.length) unresolved([], zone);
        for (const code of codes) resolved(code, [], zone);
      }
      continue;
    }
    if (where.length) {
      const byCode = new Map<string, number[]>();
      const missing: number[] = [];
      for (const tooth of where) {
        const codes = prestacionCodesForSegment(text, tooth, faces);
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
    const codes = prestacionCodesForSegment(text, null, faces);
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
