/**
 * Profesionales de la clínica (dentistas): lógica pura. Lista por espacio (owner_id); al principio solo el dueño.
 * Cada horario de box y cada cita apuntan a un profesional (professional_id); el nombre en texto queda como respaldo.
 */
export type Professional = { id: number; name: string; specialty: string; rut: string; color: string; active: boolean; isOwner: boolean };

export const PROFESSIONALS_DDL = [
  "CREATE TABLE IF NOT EXISTS professionals (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, name TEXT NOT NULL, specialty TEXT NOT NULL DEFAULT '', rut TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#473a6d', active INTEGER NOT NULL DEFAULT 1, is_owner INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS professionals_owner ON professionals (owner_id)",
  "CREATE TABLE IF NOT EXISTS professionals_seeded (owner_id TEXT PRIMARY KEY)",
];
export const PROFESSIONAL_COLUMNS_DDL = [
  "ALTER TABLE box_schedules ADD COLUMN professional_id INTEGER",
  "ALTER TABLE appointments ADD COLUMN professional_id INTEGER",
];
export const MAX_PROFESSIONALS = 50;
/** Colores del chip del profesional (distintos de la paleta de estados). */
export const PROFESSIONAL_COLORS = ["#473a6d", "#1e88e5", "#00897b", "#d81b60", "#6d4c41", "#3949ab", "#f4511e", "#7cb342"];
const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** Para comparar nombres: sin tildes, sin «Dr./Dra.», minúsculas, espacios simples. */
export function foldName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(dra?|doctor[a]?)\.?\s+/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Profesional de la lista que corresponde a un nombre escrito a mano (exacto o todas las palabras contenidas). */
export function matchProfessional(list: Pick<Professional, "id" | "name">[], name: string): number | null {
  const target = foldName(name);
  if (!target) return null;
  const exact = list.find(p => foldName(p.name) === target);
  if (exact) return exact.id;
  const words = target.split(" ");
  const partial = list.filter(p => { const own = foldName(p.name).split(" "); return words.every(w => own.includes(w)) || own.every(w => words.includes(w)); });
  return partial.length === 1 ? partial[0].id : null;
}

/** Color siguiente que nadie usa (o el primero). */
export const nextColor = (used: string[]) => PROFESSIONAL_COLORS.find(c => !used.includes(c)) ?? PROFESSIONAL_COLORS[used.length % PROFESSIONAL_COLORS.length];

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
export function checkProfessional(input: { name?: unknown; specialty?: unknown; rut?: unknown; color?: unknown }, others: Pick<Professional, "id" | "name">[], id?: number):
  { ok: true; name: string; specialty: string; rut: string; color: string | null } | { ok: false; error: string } {
  const name = clean(input.name, 80);
  if (name.length < 3) return { ok: false, error: "Escribe el nombre del profesional." };
  if (others.some(p => p.id !== id && foldName(p.name) === foldName(name))) return { ok: false, error: "Ya existe un profesional con ese nombre." };
  const rut = clean(input.rut, 14).toUpperCase().replace(/\s/g, "");
  if (rut && !/^\d{1,2}\.?\d{3}\.?\d{3}-?[\dK]$/.test(rut)) return { ok: false, error: "Revisa el RUT (ej: 12.345.678-9)." };
  return { ok: true, name, specialty: clean(input.specialty, 80), rut, color: isHex(input.color) ? input.color : null };
}
