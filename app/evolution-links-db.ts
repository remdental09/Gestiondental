import { env } from "cloudflare:workers";
import { normalizeEndo } from "@/lib/endodontics";
import { saveEndo, loadEndo } from "@/app/endodontics-db";

type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Db = { prepare(sql: string): Stmt };
const database = () => (env as unknown as { DB?: Db }).DB;

/** Qué generó una evolución fuera de su texto: una sesión o control de endodoncia, un examen periodontal. */
export type LinkKind = "endo-session" | "endo-followup" | "perio";
export const LINK_KINDS: LinkKind[] = ["endo-session", "endo-followup", "perio"];

async function ensure(db: Db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS evolution_links (owner_id TEXT NOT NULL, patient_id INTEGER NOT NULL, evolution_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, evolution_id, kind, ref))").run();
}

export async function addLink(ownerId: string, patientId: number, evolutionId: number, kind: LinkKind, ref: string) {
  const db = database();
  if (!db) return;
  await ensure(db);
  await db.prepare("INSERT OR IGNORE INTO evolution_links (owner_id, patient_id, evolution_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(ownerId, patientId, evolutionId, kind, ref.slice(0, 120), new Date().toISOString()).run();
}

/**
 * Al borrar o anular una evolución se deshace lo que generó en otras especialidades:
 * el examen periodontal ligado se elimina y la sesión o control de endodoncia ligado sale del endograma.
 */
export async function revertLinks(ownerId: string, patientId: number, evolutionId: number, deletePerioExam: (examId: number) => Promise<void>): Promise<string[]> {
  const db = database();
  if (!db) return [];
  await ensure(db);
  const { results } = await db.prepare("SELECT kind, ref FROM evolution_links WHERE owner_id = ? AND patient_id = ? AND evolution_id = ?").bind(ownerId, patientId, evolutionId).all<{ kind: LinkKind; ref: string }>();
  if (!results.length) return [];
  const done: string[] = [];
  const endo = results.filter(link => link.kind !== "perio");
  if (endo.length) {
    const found = await loadEndo(ownerId, patientId);
    if (found) {
      const data = normalizeEndo(found.data);
      let removed = 0;
      for (const link of endo) {
        const [caseId, entryId] = link.ref.split(":");
        const target = data.cases.find(c => c.id === caseId);
        if (!target) continue;
        if (link.kind === "endo-session") { const n = target.sessions.length; target.sessions = target.sessions.filter(s => s.id !== entryId); removed += n - target.sessions.length; }
        else { const n = target.followUps.length; target.followUps = target.followUps.filter(f => f.id !== entryId); removed += n - target.followUps.length; }
      }
      if (removed) { await saveEndo(ownerId, patientId, data, found.finished); done.push(`endograma (${removed} ${removed === 1 ? "registro" : "registros"})`); }
    }
  }
  for (const link of results.filter(link => link.kind === "perio")) {
    const examId = Number(link.ref);
    if (Number.isSafeInteger(examId) && examId > 0) { await deletePerioExam(examId); done.push("periodontograma"); }
  }
  await db.prepare("DELETE FROM evolution_links WHERE owner_id = ? AND patient_id = ? AND evolution_id = ?").bind(ownerId, patientId, evolutionId).run();
  return [...new Set(done)];
}
