import { env } from "cloudflare:workers";
import { isGoogleIcsUrl, syncIcsSource, type CalendarDb } from "@/app/calendar-sync";

/**
 * Calendarios de Google de cada profesional, de cualquier cuenta Gmail, por su «dirección secreta en formato iCal».
 * La dirección nunca se devuelve completa al navegador. Los eventos quedan en calendar_events con calendar_id «src:<id>».
 */
type Row = { id: string; owner_id: string; label: string; ics_url: string; added_at: string; last_sync_at: string | null; last_result: string | null; ok: number };
type Stmt = { bind(...v: unknown[]): Stmt; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown>; first<T>(): Promise<T | null> };
const database = () => (env as unknown as { DB: { prepare(sql: string): Stmt } }).DB;
const calendarDb = () => (env as unknown as { DB: CalendarDb }).DB;

async function ensure() {
  await database().prepare("CREATE TABLE IF NOT EXISTS calendar_sources (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, label TEXT NOT NULL, ics_url TEXT NOT NULL, added_at TEXT NOT NULL, last_sync_at TEXT, last_result TEXT, ok INTEGER NOT NULL DEFAULT 0)").run();
}

const hint = (url: string) => {
  const id = decodeURIComponent(url.split("/calendar/ical/")[1]?.split("/")[0] ?? "");
  return id.includes("@") ? id.replace(/^(.{2}).*(@.*)$/, "$1…$2") : "calendar.google.com";
};

export type CalendarSource = { id: string; label: string; account: string; addedAt: string; lastSyncAt: string | null; lastResult: string | null; ok: boolean };
const view = (row: Row): CalendarSource => ({ id: row.id, label: row.label, account: hint(row.ics_url), addedAt: row.added_at, lastSyncAt: row.last_sync_at, lastResult: row.last_result, ok: Boolean(row.ok) });

export async function listSources(ownerId: string): Promise<CalendarSource[]> {
  await ensure();
  const { results } = await database().prepare("SELECT * FROM calendar_sources WHERE owner_id = ? ORDER BY added_at").bind(ownerId).all<Row>();
  return results.map(view);
}

async function syncRow(row: Row) {
  try {
    const result = await syncIcsSource(calendarDb(), row.ics_url, row.owner_id, "src:" + row.id);
    const detail = `${result.events} eventos en la ventana de sincronización`;
    await database().prepare("UPDATE calendar_sources SET last_sync_at = ?, last_result = ?, ok = 1, label = CASE WHEN label = '' THEN ? ELSE label END WHERE id = ?")
      .bind(new Date().toISOString(), detail, result.calName ?? "Google Calendar", row.id).run();
    return { ok: true, detail };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "error";
    const detail = /HTTP 404|HTTP 403|HTTP 401/.test(raw) ? "Google rechazó la dirección: puede haberse restablecido. Copia la dirección secreta iCal de nuevo." : /HTTP \d+/.test(raw) ? "Google no entregó el calendario (" + raw.match(/HTTP \d+/)![0] + "); se reintentará en la próxima actualización."
      : "no se pudo leer el calendario; se reintentará en la próxima actualización.";
    await database().prepare("UPDATE calendar_sources SET last_sync_at = ?, last_result = ?, ok = 0 WHERE id = ?").bind(new Date().toISOString(), detail, row.id).run();
    return { ok: false, detail };
  }
}

export async function addSource(ownerId: string, rawUrl: string, label: string) {
  const url = rawUrl.trim();
  if (!isGoogleIcsUrl(url)) return { error: "Pega la «Dirección secreta en formato iCal» de Google Calendar (empieza con https://calendar.google.com/calendar/ical/ y termina en basic.ics)." };
  await ensure();
  const existing = await database().prepare("SELECT id FROM calendar_sources WHERE owner_id = ? AND ics_url = ?").bind(ownerId, url).first<{ id: string }>();
  if (existing) return { error: "Ese calendario ya está agregado." };
  const count = await database().prepare("SELECT COUNT(*) AS n FROM calendar_sources WHERE owner_id = ?").bind(ownerId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 5) return { error: "Puedes conectar hasta 5 calendarios." };
  const row: Row = { id: crypto.randomUUID().slice(0, 12), owner_id: ownerId, label: label.trim().slice(0, 60), ics_url: url, added_at: new Date().toISOString(), last_sync_at: null, last_result: null, ok: 0 };
  await database().prepare("INSERT INTO calendar_sources (id, owner_id, label, ics_url, added_at, ok) VALUES (?, ?, ?, ?, ?, 0)").bind(row.id, ownerId, row.label, url, row.added_at).run();
  const sync = await syncRow(row);
  return { source: (await listSources(ownerId)).find(source => source.id === row.id), sync };
}

export async function removeSource(ownerId: string, id: string) {
  await ensure();
  await database().prepare("DELETE FROM calendar_sources WHERE owner_id = ? AND id = ?").bind(ownerId, id).run();
  // Sus citas importadas dejan de mostrarse (quedan como canceladas, no se borra el historial).
  await database().prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id = ?").bind(new Date().toISOString(), ownerId, "src:" + id).run();
}

/** Sincroniza los calendarios de un profesional (botón) o de todos (tarea programada). */
export async function syncSources(ownerId?: string) {
  await ensure();
  const query = ownerId ? database().prepare("SELECT * FROM calendar_sources WHERE owner_id = ?").bind(ownerId) : database().prepare("SELECT * FROM calendar_sources").bind();
  const { results } = await query.all<Row>();
  const out = [];
  for (const row of results.slice(0, 20)) out.push({ id: row.id, ...(await syncRow(row)) });
  return out;
}
