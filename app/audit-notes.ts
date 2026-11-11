// Revisión posterior con IA (capa 2): la IA extrae lo que afirma cada evolución reciente y se guarda por nota.
// La comparación con el odontograma se rehace en cada lectura (ver app/api/auditoria/route.ts), así que aquí solo se
// guardan las afirmaciones validadas, identificadas por el contenido de la nota: si la nota cambia, se vuelve a leer.
import { env } from "cloudflare:workers";
import { CLAIM_PROMPT, claimPayload, parseClaims, type NoteClaim } from "@/lib/audit/note-claims";
import { runOpenAiReview } from "@/lib/dictation/openai-structure";

type Statement = { bind(...values: unknown[]): Statement; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
export type NotesDb = { prepare(sql: string): Statement };
const config = env as unknown as { DB?: NotesDb; OPENAI_API_KEY?: string; OPENAI_STRUCTURE_MODEL?: string };

export const REVIEW_WINDOW_DAYS = 30;
export const noteReviewAvailable = () => Boolean(config.OPENAI_API_KEY?.trim());

export async function ensureNoteTable(db: NotesDb) {
  await db.prepare("CREATE TABLE IF NOT EXISTS audit_note_claims (owner_id TEXT NOT NULL, note_id INTEGER NOT NULL, body_hash TEXT NOT NULL, claims TEXT NOT NULL, checked_at TEXT NOT NULL, PRIMARY KEY (owner_id, note_id))").run();
}

export async function bodyHash(body: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Evoluciones vigentes de la ventana de revisión, con su afirmación guardada si la nota no cambió. */
export async function recentNotesWithClaims(db: NotesDb, ownerId: string) {
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const safe = async <T,>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>().catch(() => ({ results: [] as T[] }))).results;
  const [notes, stored] = await Promise.all([
    safe<{ id: number; patient_id: number; clinical_date: string; body: string }>("SELECT id, patient_id, clinical_date, body FROM evolutions WHERE owner_id = ? AND status != 'anulada' AND clinical_date >= ? ORDER BY clinical_date DESC, id DESC LIMIT 80", ownerId, since),
    safe<{ note_id: number; body_hash: string; claims: string }>("SELECT note_id, body_hash, claims FROM audit_note_claims WHERE owner_id = ?", ownerId),
  ]);
  const byNote = new Map(stored.map((row) => [row.note_id, row]));
  return Promise.all(notes.map(async (note) => {
    const row = byNote.get(note.id);
    const hash = await bodyHash(note.body);
    let claims: NoteClaim[] | null = null;
    if (row && row.body_hash === hash) { try { claims = JSON.parse(row.claims) as NoteClaim[]; } catch { claims = null; } }
    return { ...note, hash, claims };
  }));
}

/** Lee con la IA hasta `limit` evoluciones aún sin revisar (o cambiadas). Devuelve cuántas quedan. */
export async function reviewPendingNotes(ownerId: string, limit = 3): Promise<{ revisadas: number; pendientes: number; fallidas: number }> {
  const db = config.DB, key = config.OPENAI_API_KEY?.trim();
  if (!db || !key) return { revisadas: 0, pendientes: 0, fallidas: 0 };
  await ensureNoteTable(db);
  const pending = (await recentNotesWithClaims(db, ownerId)).filter((note) => note.claims === null);
  let revisadas = 0, fallidas = 0;
  for (const note of pending.slice(0, limit)) {
    try {
      const raw = await runOpenAiReview(CLAIM_PROMPT, claimPayload(note.body), key, { model: config.OPENAI_STRUCTURE_MODEL, timeoutMs: 25_000 });
      const claims = parseClaims(raw, note.body);
      await db.prepare("INSERT INTO audit_note_claims (owner_id, note_id, body_hash, claims, checked_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id, note_id) DO UPDATE SET body_hash = excluded.body_hash, claims = excluded.claims, checked_at = excluded.checked_at")
        .bind(ownerId, note.id, note.hash, JSON.stringify(claims), new Date().toISOString()).run();
      revisadas++;
    } catch { fallidas++; }
  }
  return { revisadas, pendientes: Math.max(0, pending.length - revisadas), fallidas };
}

/** Cron horario: revisa unas pocas evoluciones pendientes de cada profesional con actividad reciente. */
export async function runNoteAudits(maxNotes = 6) {
  const db = config.DB;
  if (!db || !noteReviewAvailable()) return [{ ok: false, detail: "sin IA configurada" }];
  const since = new Date(Date.now() - REVIEW_WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);
  const owners = (await db.prepare("SELECT DISTINCT owner_id FROM evolutions WHERE status != 'anulada' AND clinical_date >= ? LIMIT 20").bind(since).all<{ owner_id: string }>().catch(() => ({ results: [] as { owner_id: string }[] }))).results;
  const out: Array<{ ok: boolean; detail: string }> = [];
  let left = maxNotes;
  for (const { owner_id } of owners) {
    if (left <= 0) break;
    const result = await reviewPendingNotes(owner_id, Math.min(3, left));
    left -= result.revisadas + result.fallidas;
    out.push({ ok: true, detail: `${result.revisadas} revisadas, ${result.pendientes} pendientes, ${result.fallidas} fallidas` });
  }
  return out;
}
