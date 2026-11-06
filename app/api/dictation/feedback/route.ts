import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { feedbackSummary, type FeedbackEntry } from "@/lib/dictation/feedback";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Db = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } ; run(): Promise<unknown> } };
const error = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
const MAX_JSON = 200_000;

async function table(db: Db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS dictation_feedback (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, patient_id INTEGER, session TEXT NOT NULL, " +
    "transcript TEXT NOT NULL, corrected_text TEXT, entries TEXT NOT NULL, accepted INTEGER NOT NULL, edited INTEGER NOT NULL, " +
    "rejected INTEGER NOT NULL, added INTEGER NOT NULL, created_at TEXT NOT NULL)"
  ).run();
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return error("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("Origen no permitido.", 403);
  let body: Record<string, unknown>;
  try { body = await request.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return error("Solicitud inválida."); }
  const transcript = typeof body.transcript === "string" ? body.transcript.slice(0, 20_000) : "";
  const session = typeof body.session === "string" ? body.session.slice(0, 80) : "";
  const entries = Array.isArray(body.entries) ? body.entries as FeedbackEntry[] : [];
  if (!transcript.trim() || !session || !entries.length) return error("Registro vacío.");
  const serialized = JSON.stringify(entries);
  if (serialized.length > MAX_JSON) return error("Registro demasiado grande.");
  const db = (env as unknown as { DB?: Db }).DB;
  if (!db) return error("Base de datos no disponible.", 503);
  const patientId = Number(body.patientId);
  const summary = feedbackSummary(entries);
  try {
    await table(db);
    await db.prepare(
      "INSERT INTO dictation_feedback (owner_id, patient_id, session, transcript, corrected_text, entries, accepted, edited, rejected, added, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      user.userId, Number.isSafeInteger(patientId) ? patientId : null, session, transcript,
      typeof body.correctedText === "string" ? body.correctedText.slice(0, 20_000) : null,
      serialized, summary.accepted, summary.edited, summary.rejected, summary.added, new Date().toISOString(),
    ).run();
    return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("No se pudo registrar.", 500);
  }
}
