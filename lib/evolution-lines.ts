/**
 * Líneas por pieza de la evolución (Dentalsoft: la unidad es el ÍTEM y su zona).
 * Al terminar el dictado o la escritura, la lista clínica se resume en una línea por pieza o zona:
 * «2.5 · Resina OD · ✓ realizado». Cada línea sabe:
 * - si quedó resuelta sola (verde) o tiene duda (ámbar);
 * - con qué ítem abierto del presupuesto calza (misma zona y prestación) y a qué estado avanza;
 * - si es un diagnóstico o plan sin ítem → «Presupuestar».
 * Diagnóstico ≠ plan ≠ realizado: solo lo realizado avanza un ítem; nunca se marca hecho lo planificado o diagnosticado.
 * Puro (sin red ni base de datos) para poder probarlo.
 */
import type { ClinicalItem } from "./dictation/clinical-items.ts";
import type { PerioStub } from "./dictation/proposal.ts";
import { itemStatus, itemTeeth, type BudgetItem, type ItemStatus } from "./budget-plans.ts";
import { prestacionByCode, prestacionLabel } from "./prestaciones-catalog.ts";
import { zoneLabel, zoneOptions, zoneTeeth, zoneValue } from "./treatment-zones.ts";

export type OpenBudget = { id: number; title: string; items: BudgetItem[]; editable?: boolean };
export type LineKind = "diagnostico" | "plan" | "realizado";
export type LineMatch = { budgetId: number; budgetTitle: string; index: number; label: string; from: ItemStatus; to: ItemStatus };
export type PerioMini = { maxDepth: number; sites: number; bleeding: boolean; suppuration: boolean };
export type EvolutionLine = {
  id: string;
  /** Pieza FDI (36 = 3.6) o null cuando la zona es sextante, arcada o boca. */
  tooth: number | null;
  /** Zonas («perm:sext-1», «perm:arc-sup», «perm:boca») cuando no es una pieza. */
  zones: string[];
  surfaces: string[];
  kind: LineKind;
  category: string;
  /** Lo que se dijo («resina OD»). */
  what: string;
  /** Prestación sugerida del arancel (código de 7 dígitos) y su nombre legible. */
  code?: string;
  prestacion: string;
  state: "ok" | "duda";
  reason?: string;
  perio?: PerioMini;
  match?: LineMatch;
  /** Hay más de un ítem posible: el profesional elige. */
  options?: LineMatch[];
  /** Diagnóstico o plan sin ítem en un presupuesto abierto: se ofrece «Presupuestar». */
  pendingBudget: boolean;
  /** Se puede presupuestar (también lo realizado sin ítem, para cobrarlo). */
  canBudget: boolean;
  /** Si el estado avanzado lo decidió el profesional (no se recalcula). */
  manualStatus?: boolean;
};

export const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const formatTooth = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;

/** Caras en el orden habitual (M O D V P); en inferiores la palatina se llama lingual (L). */
export function surfacesText(tooth: number | null, surfaces: string[]): string {
  const lower = tooth !== null && [3, 4, 7, 8].includes(Math.floor(tooth / 10));
  return ["M", "O", "D", "V", "P"].filter(s => surfaces.includes(s)).map(s => s === "P" && lower ? "L" : s === "O" && tooth !== null && tooth % 10 <= 3 ? "I" : s).join("");
}

// ── Familias de prestaciones: «misma prestación» aunque el nombre del presupuesto sea libre ────────────
const FAMILY: Record<string, RegExp> = {
  obturacion: /resina|composite|obtura|restaura|amalgama|ionomero|incrustac/,
  endodoncia: /conducto|endodon|pulpect|pulpot|trepanac/,
  exodoncia: /exodon|extracc|extraer/,
  implante: /implante|conexion|pilar/,
  corona: /corona|pfu|protesis fija unitaria|onlay|overlay/,
  puente: /puente|plural|intermediario/,
  protesis: /protesis|placa/,
  destartraje: /destartraje|pulido radicular|raspado|profilaxis|higiene|limpieza/,
  sellante: /sellante/,
  escaneo: /escaneo|scan/,
  radiografia: /radiograf|bitewing|\brx\b/,
};
const FAMILY_OF: Record<string, string> = { caries: "obturacion", fractura: "obturacion", lesion_apical: "endodoncia", pilar: "implante", ausente: "implante" };
export const familyOf = (category: string) => FAMILY_OF[category] ?? category;

/** Etapas largas: lo realizado deja el ítem «Iniciado» salvo que el dictado diga que se terminó. */
const MULTI_STAGE = new Set(["implante", "corona", "puente", "protesis", "endodoncia"]);
const FINISHED = /cement|entreg|termin|finaliz|\balta\b|obturacion (?:de |radicular )?(?:los )?conductos?|obturacion radicular|definitiv|instal\w* (?:de |la |el )?(?:corona|puente|protesis)/;

export function nextStatus(category: string, text: string, current: ItemStatus): ItemStatus {
  const family = familyOf(category);
  if (!MULTI_STAGE.has(family)) return "terminada";
  if (FINISHED.test(fold(text))) return "terminada";
  return current === "terminada" ? "terminada" : "iniciada";
}

// ── Prestación sugerida (arancel) ──────────────────────────────────────────────────────────
const anterior = (tooth: number) => tooth % 10 <= 3;
export function suggestCode(category: string, tooth: number | null, surfaces: string[], text: string): string | undefined {
  const t = fold(text);
  const n = surfaces.length;
  switch (category) {
    case "obturacion": case "caries": case "fractura":
      if (/amalgama/.test(t)) return n >= 2 ? "5005002" : "5005001";
      if (/ionomero/.test(t)) return "5005004";
      if (tooth === null) return undefined;
      if (anterior(tooth)) return n >= 2 ? "5005006" : "5005005";
      return n >= 3 ? "5005040" : n === 2 ? "5005018" : "5005017";
    case "endodoncia": case "lesion_apical": {
      if (tooth === null) return undefined;
      const lesion = category === "lesion_apical" || /lesion|necro|periodontitis apical/.test(t);
      const p = tooth % 10, q = Math.floor(tooth / 10);
      if (p <= 3) return "5006001";
      if (p <= 5) return lesion ? "5006008" : "5006002";
      if (q === 1 || q === 2) return lesion ? "5006016" : "5006015";
      return lesion ? "5006009" : "5006003";
    }
    case "exodoncia": return /tercer|cordal|incluid/.test(t) ? "5003046" : "5003001";
    case "pilar": return "5011052";
    case "implante": case "ausente": return /conexion|pilar/.test(t) ? "5011052" : "5011001";
    case "corona": return /implante/.test(t) ? "9110042" : /ceramica|feldesp/.test(t) ? "5103061" : "5007002";
    case "sellante": return "5005012";
    case "destartraje":
      if (/subgingival|pulido radicular|raspado/.test(t)) return "5009013";
      if (/profilaxis|higiene/.test(t)) return "5001027";
      return "5001030";
    case "radiografia": return "5002038";
    default: return undefined;
  }
}

// ── Zona inferida del dictado ────────────────────────────────────────────────────────────
const SEXTANTS = zoneOptions("perm").filter(z => z.group === "sextante");
export const sextantsOf = (teeth: number[]) => SEXTANTS.filter(z => z.teeth.some(t => teeth.includes(t))).map(z => zoneValue("perm", z.key));
export const ALL_SEXTANTS = SEXTANTS.map(z => zoneValue("perm", z.key));
export const ARCHES = [zoneValue("perm", "arc-sup"), zoneValue("perm", "arc-inf")];
export const MOUTH = zoneValue("perm", "boca");

/**
 * Zona de una prestación sin pieza: destartraje subgingival / pulido radicular → sextantes (de las piezas mencionadas o
 * con sondaje ≥ 4 mm; si no hay, los seis con duda); bitewing → arcadas; higiene/profilaxis/supragingival → boca.
 */
export function inferZones(text: string, teeth: number[], deepTeeth: number[]): { zones: string[]; doubt?: string } {
  const t = fold(text);
  if (/subgingival|pulido radicular|raspado/.test(t)) {
    const from = sextantsOf(teeth.length ? teeth : deepTeeth);
    const explicit = [...t.matchAll(/sextante\s*([1-6])/g)].map(m => zoneValue("perm", `sext-${m[1]}`));
    const zones = [...new Set([...explicit, ...from])];
    return zones.length ? { zones } : { zones: ALL_SEXTANTS, doubt: "¿Qué sextantes? Se propusieron los seis." };
  }
  if (/bitewing|bite wing|aleta de mordida/.test(t)) return { zones: ARCHES };
  if (/profilaxis|higiene|supragingival|destartraje|limpieza/.test(t)) return { zones: [MOUTH] };
  return { zones: [MOUTH] };
}

// ── Calce con el presupuesto ────────────────────────────────────────────────────────────
function sameZone(line: Pick<EvolutionLine, "tooth" | "zones">, item: BudgetItem): boolean {
  if (line.tooth !== null) return itemTeeth(item).includes(line.tooth) || (!!item.zone && !/boca/.test(item.zone) && zoneTeeth(item.zone).includes(line.tooth) && !itemTeeth(item).length);
  if (!line.zones.length) return false;
  if (item.zone && line.zones.includes(item.zone)) return true;
  // Ítem antiguo «Destartraje boca completa» sin zona
  return !item.zone && !itemTeeth(item).length && line.zones.includes(MOUTH);
}
function samePrestacion(line: Pick<EvolutionLine, "category" | "code">, item: BudgetItem): boolean {
  if (line.code && item.code && line.code === item.code) return true;
  const family = FAMILY[familyOf(line.category)];
  return !!family && family.test(fold(item.label));
}

/** Ítems abiertos (no terminados) que calzan con la línea, en orden: primero los ya iniciados. */
export function matchingItems(line: Pick<EvolutionLine, "tooth" | "zones" | "category" | "code" | "what">, budgets: OpenBudget[]): LineMatch[] {
  const found: LineMatch[] = [];
  for (const budget of budgets) budget.items.forEach((item, index) => {
    const from = itemStatus(item);
    if (from === "terminada") return;
    if (!sameZone(line, item) || !samePrestacion(line, item)) return;
    found.push({ budgetId: budget.id, budgetTitle: budget.title, index, label: item.label, from, to: nextStatus(line.category, line.what, from) });
  });
  return found.sort((a, b) => Number(b.from === "iniciada") - Number(a.from === "iniciada"));
}

const BUDGETABLE_DX = new Set(["caries", "fractura", "lesion_apical", "ausente"]);
export const isBudgetable = (kind: LineKind, category: string, code?: string) => category !== "perio" && (kind !== "diagnostico" ? (category !== "movilidad" && category !== "otro") || !!code : BUDGETABLE_DX.has(category));
const SUBGINGIVAL = /subgingival|pulido radicular|raspado/;

/** Construye las líneas de la evolución a partir de la lista clínica y el sondaje dictado. */
export function buildEvolutionLines(input: { items: ClinicalItem[]; perio?: PerioStub[]; budgets: OpenBudget[]; text?: string }): EvolutionLine[] {
  const perioByTooth = new Map<number, PerioMini>();
  for (const p of input.perio ?? []) {
    const cur = perioByTooth.get(p.tooth) ?? { maxDepth: 0, sites: 0, bleeding: false, suppuration: false };
    perioByTooth.set(p.tooth, { maxDepth: Math.max(cur.maxDepth, p.depth), sites: cur.sites + 1, bleeding: cur.bleeding || !!p.bleeding, suppuration: cur.suppuration || !!p.suppuration });
  }
  const deepTeeth = [...perioByTooth.entries()].filter(([, v]) => v.maxDepth >= 4).map(([t]) => t);
  const lines: EvolutionLine[] = [];
  const seen = new Set<string>();
  // Destartraje subgingival dictado por pieza → una línea por sextantes (se cobra por sextante).
  const subTeeth = new Map<string, number[]>();
  const items: ClinicalItem[] = [];
  for (const raw of input.items) {
    const text = fold(`${raw.what} ${raw.evidence}`);
    const item = raw.category === "otro" && /radiograf|bitewing|bite wing|\brx\b/.test(text) ? { ...raw, category: "radiografia" as ClinicalItem["category"] } : raw;
    if (item.category === "destartraje" && item.tooth !== null && SUBGINGIVAL.test(text)) {
      const key = item.kind;
      if (!subTeeth.has(key)) items.push({ ...item, tooth: null, surfaces: [], id: `${item.id}-sext` });
      subTeeth.set(key, [...(subTeeth.get(key) ?? []), item.tooth]);
      continue;
    }
    items.push(item);
  }
  for (const item of items) {
    const what = item.what || item.category;
    let zones: string[] = [];
    let doubt: string | undefined;
    if (item.tooth === null) {
      const z = inferZones(`${what} ${item.evidence}`, subTeeth.get(item.kind) ?? [], deepTeeth);
      zones = z.zones;
      doubt = z.doubt;
    }
    const surfaces = [...item.surfaces];
    const code = item.arancel && prestacionByCode(item.arancel) ? item.arancel : suggestCode(item.category, item.tooth, surfaces, `${what} ${item.evidence}`);
    const prestacion = code ? prestacionLabel(prestacionByCode(code)!.name) : what;
    const key = `${item.tooth ?? zones.join(",")}|${item.kind}|${familyOf(item.category)}|${code ?? what}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base: EvolutionLine = { id: item.id, tooth: item.tooth, zones, surfaces, kind: item.kind, category: item.category, what, ...(code ? { code } : {}), prestacion, state: "ok", pendingBudget: false, canBudget: false };
    if (item.tooth !== null && perioByTooth.has(item.tooth)) base.perio = perioByTooth.get(item.tooth);
    // Sin coincidencia IA/reglas o con zona dudosa: ámbar.
    if (item.origin !== "ia+reglas" && item.origin !== "reglas") { base.state = "duda"; base.reason = "Solo lo interpretó la IA: revisa."; }
    if (doubt) { base.state = "duda"; base.reason = doubt; }
    const budgetable = isBudgetable(item.kind, item.category, code);
    const matches = budgetable ? matchingItems(base, input.budgets) : [];
    if (item.kind === "realizado") {
      if (matches.length === 1 || (matches.length > 1 && matches[0].from === "iniciada" && matches[1].from !== "iniciada")) base.match = matches[0];
      else if (matches.length > 1) { base.options = matches; base.match = matches[0]; base.state = "duda"; base.reason = `Calza con ${matches.length} ítems: elige cuál avanza.`; }
    } else {
      // Diagnóstico o plan: ya presupuestado → se muestra el ítem; si no, «Presupuestar».
      if (matches.length) base.match = { ...matches[0], to: matches[0].from };
      // El presupuesto lo arma el dentista: el dictado no propone presupuestar.
    }
    lines.push(base);
  }
  // Sondaje dictado de piezas sin otra línea: «1.6 · sondaje 5 mm · sangrado».
  for (const [tooth, perio] of perioByTooth) {
    if (lines.some(l => l.tooth === tooth)) continue;
    lines.push({ id: `perio-${tooth}`, tooth, zones: [], surfaces: [], kind: "diagnostico", category: "perio", what: "Sondaje", prestacion: "Sondaje", state: "ok", perio, pendingBudget: false, canBudget: false });
  }
  return lines.sort((a, b) => (a.tooth ?? 999) - (b.tooth ?? 999));
}

/** Recalcula el calce de una línea corregida (pieza, caras, tipo o procedimiento). */
export function refreshLine(line: EvolutionLine, budgets: OpenBudget[]): EvolutionLine {
  const code = suggestCode(line.category, line.tooth, line.surfaces, line.what) ?? line.code;
  const next: EvolutionLine = { ...line, ...(code ? { code, prestacion: prestacionLabel(prestacionByCode(code)!.name) } : {}), state: "ok", reason: undefined, options: undefined, match: undefined };
  if (line.category === "perio") return next;
  const budgetable = isBudgetable(next.kind, next.category, next.code);
  const matches = budgetable ? matchingItems(next, budgets) : [];
  if (next.kind === "realizado") {
    next.match = matches[0];
    if (matches.length > 1) next.options = matches;
    next.pendingBudget = false;
  } else {
    if (matches.length) next.match = { ...matches[0], to: matches[0].from };
    next.pendingBudget = false;
  }
  return next;
}

const KIND_MARK: Record<LineKind, string> = { realizado: "✓ realizado", plan: "plan", diagnostico: "diagnóstico" };
export const STATUS_WORD: Record<ItemStatus, string> = { pendiente: "pendiente", iniciada: "iniciado", terminada: "terminado", desevolucion: "desevolución" };

export function whereText(line: Pick<EvolutionLine, "tooth" | "zones" | "surfaces">): string {
  if (line.tooth !== null) return `${formatTooth(line.tooth)}${line.surfaces.length ? ` ${surfacesText(line.tooth, line.surfaces)}` : ""}`;
  if (line.zones.length === 6 && line.zones.every(z => /sext/.test(z))) return "6 sextantes";
  if (line.zones.length && line.zones.every(z => /sext/.test(z))) return line.zones.map(z => `S${z.slice(-1)}`).join(" ");
  return line.zones.map(z => zoneLabel(z)).join(" + ") || "Boca";
}

export function perioText(perio: PerioMini): string {
  return `sondaje ${perio.maxDepth} mm${perio.sites > 1 ? ` (${perio.sites} sitios)` : ""}${perio.bleeding ? " · sangrado" : ""}${perio.suppuration ? " · supuración" : ""}`;
}

/** «2.5 · Resina OD · ✓ realizado» */
export function lineText(line: EvolutionLine): string {
  if (line.category === "perio" && line.perio) return `${whereText(line)} · ${perioText(line.perio)}`;
  const where = line.tooth !== null ? formatTooth(line.tooth) : whereText(line);
  const surf = line.tooth !== null && line.surfaces.length ? ` ${surfacesText(line.tooth, line.surfaces)}` : "";
  const what = shortWhat(line.what);
  return `${where} · ${what}${surf} · ${KIND_MARK[line.kind]}`;
}
function shortWhat(what: string): string {
  // «Pza 2.6 Rc DO …» / «Piezas 3.7-3.6 Corona Cerec …»: la pieza ya va delante; queda el acto, hasta la primera barra.
  const act = what.replace(/^\s*(?:pzas?|piezas?|dientes?)\.?\s*(?:[1-8]\.[1-8](?:\s*(?:-|,|y)\s*)?)+\s*[:\-/]?\s*/i, "").split(/\s*[/;|]\s*/)[0] || what;
  const clean = act.replace(/\s+(?:en\s+(?:la\s+)?)?(?:pieza\s+)?\d\.\d\b.*$/i, "").replace(/\s+[MODVPLI]{1,5}$/, "").trim();
  return (clean.charAt(0).toUpperCase() + clean.slice(1)).slice(0, 48) || "Registro";
}

/** Lo que hará «Guardar» con esta línea en el presupuesto, en una frase corta. */
export function matchText(line: EvolutionLine): string {
  if (!line.match) return "";
  if (line.kind !== "realizado") return `ya en «${line.match.budgetTitle}» (${STATUS_WORD[line.match.from]})`;
  return line.match.from === line.match.to ? `avanza «${line.match.label}»` : `«${line.match.label}» → ${STATUS_WORD[line.match.to]}`;
}

/** Ítems de presupuesto para una línea («Presupuestar»): uno por pieza o uno por zona; lo realizado entra Terminado. */
export function budgetItemsFor(line: EvolutionLine, prices: Record<string, number>, date: string, professional?: string): BudgetItem[] {
  const amount = line.code ? Math.max(0, Math.round(prices[line.code] ?? 0)) : 0;
  const name = line.prestacion || shortWhat(line.what);
  const done = line.kind === "realizado" ? { startedOn: date, doneOn: date } : {};
  const who = professional ? { professional } : {};
  if (line.tooth !== null) {
    return [{ label: `${name} ${formatTooth(line.tooth)}${line.surfaces.length ? ` ${surfacesText(line.tooth, line.surfaces)}` : ""}`.slice(0, 180), amount, ...(line.code ? { code: line.code } : {}), teeth: [line.tooth], ...(line.surfaces.length ? { surfaces: line.surfaces } : {}), ...done, ...who }];
  }
  return line.zones.map(zone => ({ label: `${name} · ${zoneLabel(zone)}`.slice(0, 180), amount, ...(line.code ? { code: line.code } : {}), zone, ...done, ...who }));
}

/** Resumen mínimo que queda bajo la evolución guardada («2.5 ✓ · 3.6 ↻ · S1–S6 ✓»). */
export type PieceChip = { t: string; s: "ok" | "avance" | "plan" | "dx" };
export function pieceChips(lines: EvolutionLine[]): PieceChip[] {
  return lines.slice(0, 32).map(line => ({
    t: `${whereText({ ...line, surfaces: [] })} ${line.category === "perio" ? `PS ${line.perio?.maxDepth ?? ""}` : shortWhat(line.code && line.prestacion && /^\s*(?:pzas?|piezas?)\b/i.test(line.what) ? line.prestacion : line.what)}`.slice(0, 60),
    s: line.kind === "realizado" ? (line.match?.to === "iniciada" ? "avance" : "ok") : line.kind === "plan" ? "plan" : "dx",
  }));
}
export function sanitizeChips(value: unknown): PieceChip[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Record<string, unknown>;
    const t = typeof r.t === "string" ? r.t.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const s = r.s === "ok" || r.s === "avance" || r.s === "plan" || r.s === "dx" ? r.s : null;
    return t && s ? [{ t, s }] : [];
  });
}
export const EVOLUTION_PIECES_DDL = "CREATE TABLE IF NOT EXISTS evolution_pieces (owner_id TEXT NOT NULL, evolution_id INTEGER NOT NULL, pieces TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, evolution_id))";

/** Cuántas líneas quedan por presupuestar («Guardar y presupuestar (N)»). */
export const pendingCount = (lines: EvolutionLine[]) => lines.filter(l => l.pendingBudget).length;
