import { foldText, type KnowledgeKind, type Specialty, type SpecialtyId } from "./specialty.ts";
import { similarity } from "./fuzzy.ts";
import { IMPLANTOLOGIA } from "./specialties/implantologia.ts";
import { CIRUGIA } from "./specialties/cirugia.ts";
import { ENDODONCIA } from "./specialties/endodoncia.ts";
import { PERIODONCIA } from "./specialties/periodoncia.ts";
import { REHABILITACION } from "./specialties/rehabilitacion.ts";
import { OPERATORIA } from "./specialties/operatoria.ts";
import { ORTODONCIA } from "./specialties/ortodoncia.ts";
import { ODONTOPEDIATRIA } from "./specialties/odontopediatria.ts";
import { PATOLOGIA } from "./specialties/patologia.ts";
import { TTM } from "./specialties/ttm.ts";
import { IMAGENOLOGIA } from "./specialties/imagenologia.ts";
import { ODONTOGERIATRIA } from "./specialties/odontogeriatria.ts";

export type { KnowledgeEntry, KnowledgeKind, Specialty, SpecialtyId } from "./specialty.ts";

/** Todas las especialidades, cada una en su archivo. Agregar una = crear el archivo y sumarla aquí. */
export const SPECIALTIES: readonly Specialty[] = [
  IMPLANTOLOGIA, CIRUGIA, ENDODONCIA, PERIODONCIA, REHABILITACION, OPERATORIA,
  ORTODONCIA, ODONTOPEDIATRIA, PATOLOGIA, TTM, IMAGENOLOGIA, ODONTOGERIATRIA,
];

const BY_ID = new Map(SPECIALTIES.map((item) => [item.id, item]));
export const specialtyById = (id: SpecialtyId) => BY_ID.get(id);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SIGNALS = SPECIALTIES.map((item) => ({
  id: item.id,
  patterns: [...new Set(item.senales.map(foldText))].map((signal) => new RegExp(`(?<![a-z0-9])${escapeRegExp(signal)}(?![a-z0-9])`)),
}));

export type SpecialtyHit = { id: SpecialtyId; nombre: string; score: number };

/**
 * Especialidades que toca un dictado, de más a menos señales. Solo estas se cargan en el prompt:
 * el resto de la base queda disponible por búsqueda.
 */
export function detectSpecialties(text: string, max = 3): SpecialtyHit[] {
  const folded = foldText(text);
  return SIGNALS
    .map(({ id, patterns }) => ({ id, nombre: BY_ID.get(id)!.nombre, score: patterns.reduce((sum, pattern) => sum + (folded.match(new RegExp(pattern.source, "g"))?.length ?? 0), 0) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

const KIND_LABEL: Record<KnowledgeKind, string> = {
  procedimiento: "procedimientos", material: "materiales", marca: "marcas (empresa)", instrumento: "instrumental",
  hallazgo: "hallazgos", medicamento: "medicamentos", concepto: "conceptos",
};
const KIND_ORDER: KnowledgeKind[] = ["procedimiento", "marca", "material", "hallazgo", "instrumento", "medicamento", "concepto"];

/** Límite de caracteres por especialidad en el prompt (el modelo ignora listas demasiado largas). */
export const SPECIALTY_PROMPT_BUDGET = 3000;

/** Bloque de vocabulario de UNA especialidad: notas y variantes oídas primero, luego términos hasta el presupuesto. */
export function specialtyPromptBlock(specialty: Specialty, budget = SPECIALTY_PROMPT_BUDGET): string {
  const lines: string[] = [`Especialidad: ${specialty.nombre}.`];
  for (const note of specialty.notas) lines.push(`- ${note}`);
  const misheard = specialty.entradas.filter((entry) => entry.oidoMal?.length && !entry.soloBusqueda);
  if (misheard.length) lines.push(`- La voz suele oír mal: ${misheard.map((entry) => `${entry.oidoMal!.map((form) => `«${form}»`).join("/")} → ${entry.termino}`).join("; ")}.`);
  let text = lines.join("\n");
  for (const kind of KIND_ORDER) {
    const terms = specialty.entradas.filter((entry) => entry.tipo === kind && !entry.soloBusqueda).map((entry) => (entry.empresa ? `${entry.termino} (${entry.empresa})` : entry.termino));
    if (!terms.length) continue;
    let line = `\n- ${KIND_LABEL[kind]}: `;
    const room = budget - text.length - line.length - 1;
    if (room < 40) break;
    const kept: string[] = [];
    let used = 0;
    for (const term of terms) {
      if (used + term.length + 2 > room) break;
      kept.push(term);
      used += term.length + 2;
    }
    if (!kept.length) break;
    line += `${kept.join(", ")}${kept.length < terms.length ? ", …" : ""}.`;
    text += line;
  }
  return text;
}

/**
 * Vocabulario de las especialidades detectadas en el dictado, listo para el prompt del modelo.
 * Vacío si el dictado no delata ninguna especialidad.
 */
export function buildSpecialtyContext(transcript: string, max = 3): string {
  const hits = detectSpecialties(transcript, max);
  if (!hits.length) return "";
  const blocks = hits.map((hit) => specialtyPromptBlock(BY_ID.get(hit.id)!));
  return `VOCABULARIO DE ESPECIALIDAD (detectado en este dictado: ${hits.map((hit) => hit.nombre).join(", ")}). Úsalo para reconocer términos, marcas y materiales mal transcritos; conserva lo dictado cuando ya es correcto y no agregues nada que no se haya dicho.\n${blocks.join("\n\n")}`;
}

export type KnowledgeMatch = { termino: string; tipo: KnowledgeKind; especialidad: string; empresa?: string; coincide: string; parecido: number };

/**
 * Busca un término en la base (todas las especialidades o solo las indicadas), tolerando errores de la voz.
 * Devuelve el término correcto, su especialidad y con qué forma coincidió.
 */
export function searchKnowledge(query: string, options: { specialties?: SpecialtyId[]; limit?: number; min?: number } = {}): KnowledgeMatch[] {
  const limit = options.limit ?? 8;
  const min = options.min ?? 0.72;
  const pool = options.specialties?.length ? SPECIALTIES.filter((item) => options.specialties!.includes(item.id)) : SPECIALTIES;
  const best = new Map<string, KnowledgeMatch>();
  for (const specialty of pool) {
    for (const entry of specialty.entradas) {
      let score = 0;
      let matched = entry.termino;
      for (const form of [entry.termino, ...(entry.sinonimos ?? []), ...(entry.oidoMal ?? [])]) {
        const value = similarity(query, form);
        if (value > score) { score = value; matched = form; }
      }
      if (score < min) continue;
      const key = foldText(entry.termino);
      const previous = best.get(key);
      if (previous && previous.parecido >= score) continue;
      best.set(key, { termino: entry.termino, tipo: entry.tipo, especialidad: specialty.nombre, ...(entry.empresa ? { empresa: entry.empresa } : {}), coincide: matched, parecido: Math.round(score * 100) / 100 });
    }
  }
  return [...best.values()].sort((a, b) => b.parecido - a.parecido || a.termino.length - b.termino.length).slice(0, limit);
}

/** Tamaño de la base, para pruebas y para mostrar cobertura. */
export function knowledgeStats(): Array<{ id: SpecialtyId; nombre: string; terminos: number; marcas: number; oidoMal: number }> {
  return SPECIALTIES.map((item) => ({
    id: item.id,
    nombre: item.nombre,
    terminos: item.entradas.length,
    marcas: item.entradas.filter((entry) => entry.tipo === "marca").length,
    oidoMal: item.entradas.filter((entry) => entry.oidoMal?.length).length,
  }));
}
