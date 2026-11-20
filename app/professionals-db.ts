import { db as boxDatabase, ensureBoxSchema } from "@/app/box-db";
import { PROFESSIONALS_DDL, PROFESSIONAL_COLUMNS_DDL, MAX_PROFESSIONALS, checkProfessional, matchProfessional, nextColor, type Professional } from "@/lib/professionals";

/**
 * Profesionales (dentistas) de la clínica, por espacio (owner_id). Se crea solo con el dueño la primera vez.
 * Nunca se borra uno que tenga horarios o citas: se desactiva. Migración aditiva: tabla professionals y columnas professional_id.
 */
type Stmt = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }; run(): Promise<unknown> };
type Db = { prepare(sql: string): Stmt };
const now = () => new Date().toISOString();

let ready: Promise<void> | null = null;
export async function database(): Promise<Db> {
  const db = boxDatabase() as Db | undefined;
  if (!db) throw new Error("La base de datos no está disponible.");
  await ensureBoxSchema(db as never);
  ready ??= (async () => {
    for (const sql of PROFESSIONALS_DDL) await db.prepare(sql).run();
    for (const sql of PROFESSIONAL_COLUMNS_DDL) { try { await db.prepare(sql).run(); } catch { /* la columna ya existe */ } }
  })().catch(cause => { ready = null; throw cause; });
  await ready;
  return db;
}

type Row = { id: number; name: string; specialty: string; rut: string; color: string; active: number; is_owner: number };
const of = (r: Row): Professional => ({ id: r.id, name: r.name, specialty: r.specialty, rut: r.rut, color: r.color, active: r.active === 1, isOwner: r.is_owner === 1 });
export type OwnerSeed = { name: string; specialty?: string; rut?: string };

/**
 * Lista de profesionales. La primera vez: crea al dueño y enlaza los horarios/citas que tenían el nombre escrito a mano
 * (si el nombre coincide con uno de la lista se usa; si no, se crea ese profesional).
 */
export async function listProfessionals(ownerId: string, seed: OwnerSeed): Promise<Professional[]> {
  const db = await database();
  const seeded = await db.prepare("SELECT owner_id FROM professionals_seeded WHERE owner_id = ?").bind(ownerId).first<{ owner_id: string }>();
  if (!seeded) {
    await db.prepare("INSERT OR IGNORE INTO professionals_seeded (owner_id) VALUES (?)").bind(ownerId).run();
    const existing = await db.prepare("SELECT COUNT(*) AS n FROM professionals WHERE owner_id = ?").bind(ownerId).first<{ n: number }>();
    if (!existing?.n) {
      const stamp = now();
      await db.prepare("INSERT INTO professionals (owner_id, name, specialty, rut, color, active, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)")
        .bind(ownerId, seed.name.slice(0, 80) || "Profesional", (seed.specialty ?? "").slice(0, 80), (seed.rut ?? "").slice(0, 14), "#473a6d", stamp, stamp).run();
    }
  }
  await linkTextProfessionals(db, ownerId);
  const { results } = await db.prepare("SELECT id, name, specialty, rut, color, active, is_owner FROM professionals WHERE owner_id = ? ORDER BY is_owner DESC, active DESC, name").bind(ownerId).all<Row>();
  return results.map(of);
}

/** Horarios y citas con el profesional solo en texto → professional_id (por nombre, o creando el profesional). */
async function linkTextProfessionals(db: Db, ownerId: string) {
  const pending = [
    ...(await db.prepare("SELECT DISTINCT professional AS name FROM box_schedules WHERE owner_id = ? AND professional_id IS NULL AND professional <> ''").bind(ownerId).all<{ name: string }>()).results,
    ...(await db.prepare("SELECT DISTINCT professional AS name FROM appointments WHERE owner_id = ? AND professional_id IS NULL AND professional IS NOT NULL AND professional <> ''").bind(ownerId).all<{ name: string }>()).results,
  ];
  if (!pending.length) return;
  const list = (await db.prepare("SELECT id, name, color FROM professionals WHERE owner_id = ?").bind(ownerId).all<{ id: number; name: string; color: string }>()).results;
  for (const { name } of pending) {
    let id = matchProfessional(list, name);
    if (id === null) {
      const stamp = now();
      const color = nextColor(list.map(p => p.color));
      const row = await db.prepare("INSERT INTO professionals (owner_id, name, specialty, rut, color, active, is_owner, created_at, updated_at) VALUES (?, ?, '', '', ?, 1, 0, ?, ?) RETURNING id").bind(ownerId, name.slice(0, 80), color, stamp, stamp).first<{ id: number }>();
      if (!row) continue;
      id = row.id;
      list.push({ id, name, color });
    }
    await db.prepare("UPDATE box_schedules SET professional_id = ? WHERE owner_id = ? AND professional_id IS NULL AND professional = ?").bind(id, ownerId, name).run();
    await db.prepare("UPDATE appointments SET professional_id = ? WHERE owner_id = ? AND professional_id IS NULL AND professional = ?").bind(id, ownerId, name).run();
  }
}

/** Profesional del espacio por id (activo o no). */
export async function getProfessional(ownerId: string, id: number): Promise<Professional | null> {
  const db = await database();
  const row = await db.prepare("SELECT id, name, specialty, rut, color, active, is_owner FROM professionals WHERE id = ? AND owner_id = ?").bind(id, ownerId).first<Row>();
  return row ? of(row) : null;
}
/** El profesional por defecto: el dueño (o el primero activo). */
export async function defaultProfessional(ownerId: string, seed: OwnerSeed): Promise<Professional | null> {
  const list = await listProfessionals(ownerId, seed);
  return list.find(p => p.isOwner && p.active) ?? list.find(p => p.active) ?? null;
}

export type SaveResult = { ok: true; professionals: Professional[] } | { ok: false; error: string };
export async function saveProfessional(ownerId: string, seed: OwnerSeed, input: { id?: number; name?: unknown; specialty?: unknown; rut?: unknown; color?: unknown; active?: unknown }): Promise<SaveResult> {
  const db = await database();
  const list = await listProfessionals(ownerId, seed);
  const current = input.id === undefined ? undefined : list.find(p => p.id === input.id);
  if (input.id !== undefined && !current) return { ok: false, error: "Profesional no encontrado." };
  const checked = checkProfessional({ name: input.name ?? current?.name, specialty: input.specialty ?? current?.specialty, rut: input.rut ?? current?.rut, color: input.color ?? current?.color }, list, input.id);
  if (!checked.ok) return checked;
  const stamp = now();
  if (!current) {
    if (list.length >= MAX_PROFESSIONALS) return { ok: false, error: `Máximo ${MAX_PROFESSIONALS} profesionales.` };
    await db.prepare("INSERT INTO professionals (owner_id, name, specialty, rut, color, active, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)")
      .bind(ownerId, checked.name, checked.specialty, checked.rut, checked.color ?? nextColor(list.map(p => p.color)), stamp, stamp).run();
  } else {
    const active = typeof input.active === "boolean" ? input.active : current.active;
    if (!active && current.active && list.filter(p => p.active).length <= 1) return { ok: false, error: "Debe quedar al menos un profesional activo." };
    await db.prepare("UPDATE professionals SET name = ?, specialty = ?, rut = ?, color = ?, active = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .bind(checked.name, checked.specialty, checked.rut, checked.color ?? current.color, active ? 1 : 0, stamp, current.id, ownerId).run();
    // El nombre en texto de horarios y citas sigue al profesional (respaldo legible).
    if (checked.name !== current.name) {
      await db.prepare("UPDATE box_schedules SET professional = ? WHERE owner_id = ? AND professional_id = ?").bind(checked.name, ownerId, current.id).run();
      await db.prepare("UPDATE appointments SET professional = ? WHERE owner_id = ? AND professional_id = ?").bind(checked.name, ownerId, current.id).run();
    }
  }
  return { ok: true, professionals: await listProfessionals(ownerId, seed) };
}

/** Borrar solo si nunca se usó (sin horarios ni citas); si se usó, hay que desactivarlo. */
export async function deleteProfessional(ownerId: string, seed: OwnerSeed, id: number): Promise<SaveResult> {
  const db = await database();
  const list = await listProfessionals(ownerId, seed);
  const current = list.find(p => p.id === id);
  if (!current) return { ok: false, error: "Profesional no encontrado." };
  if (current.isOwner) return { ok: false, error: "El profesional principal no se puede borrar." };
  const used = await db.prepare("SELECT (SELECT COUNT(*) FROM box_schedules WHERE owner_id = ? AND professional_id = ?) + (SELECT COUNT(*) FROM appointments WHERE owner_id = ? AND professional_id = ?) AS n").bind(ownerId, id, ownerId, id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) return { ok: false, error: "Tiene horarios o citas: desactívalo en vez de borrarlo." };
  await db.prepare("DELETE FROM professionals WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  return { ok: true, professionals: await listProfessionals(ownerId, seed) };
}
