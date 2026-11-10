// Mejora continua (solo el titular de la app): uso por profesional, lo que más se corrige de las propuestas del dictado
// y la prueba del banco de casos con la IA real. Solo datos agregados: nunca texto dictado ni datos de pacientes.
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { summarizeImprovement, type ClinicianLabel, type FeedbackRow, type UsageRow } from "@/lib/improvement";
import { judgeCase, itemKey, type CoherenceCase } from "@/lib/dictation/coherence-cases";
import { proposeFromTranscript } from "@/lib/dictation/proposal";
import { createWorkersAiModel } from "@/lib/dictation/workers-ai";
import bank from "@/tests/fixtures/casos-coherencia.json";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Statement = { bind(...values: unknown[]): Statement; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type Db = { prepare(sql: string): Statement };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const config = env as unknown as { DB?: Db; CLINIC_OWNER_ID?: string; OPENAI_API_KEY?: string; OPENAI_STRUCTURE_MODEL?: string; AI?: Parameters<typeof createWorkersAiModel>[0] };
const CASES = (bank as { casos: CoherenceCase[] }).casos;
const BATCH = 3;

async function titular() {
  const user = await getChatGPTUser();
  if (!user?.userId) return { error: json({ error: "Inicia sesión." }, 401) };
  const owner = config.CLINIC_OWNER_ID?.trim();
  if (!owner || user.userId !== owner) return { error: json({ error: "Solo el titular de la aplicación ve la mejora continua." }, 403) };
  return { user };
}

export async function GET() {
  const auth = await titular();
  if ("error" in auth) return auth.error;
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const safe = async <T,>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>().catch(() => ({ results: [] as T[] }))).results;
  const [feedback, usage, profiles] = await Promise.all([
    safe<FeedbackRow>("SELECT owner_id, entries, created_at FROM dictation_feedback ORDER BY id DESC LIMIT 2000"),
    safe<UsageRow>(
      "SELECT p.owner_id AS owner_id, COUNT(*) AS fichas, " +
      "(SELECT COUNT(*) FROM evolutions e WHERE e.owner_id = p.owner_id) AS evoluciones, " +
      "(SELECT COUNT(*) FROM evolutions e WHERE e.owner_id = p.owner_id AND e.recorded_at >= ?) AS evoluciones_30d, " +
      "(SELECT MAX(e.recorded_at) FROM evolutions e WHERE e.owner_id = p.owner_id) AS ultima FROM patients p GROUP BY p.owner_id", since),
    safe<{ owner_id: string; first_name: string; last_name: string; email: string }>("SELECT owner_id, first_name, last_name, email FROM clinician_profiles"),
  ]);
  const labels: ClinicianLabel[] = profiles.map((row) => ({ owner_id: row.owner_id, label: `${[row.first_name, row.last_name].filter(Boolean).join(" ") || "Colega"} · ${row.email}` }));
  labels.unshift({ owner_id: auth.user.userId, label: `Tú (${auth.user.email})` });
  return json({ ...summarizeImprovement(feedback, usage, labels), casos: CASES.length, iaDisponible: Boolean(config.OPENAI_API_KEY?.trim() || config.AI) });
}

/** {desde}: evalúa con la IA real un tramo del banco de casos (de a 3, para no exceder el tiempo de una solicitud). */
export async function POST(request: Request) {
  const auth = await titular();
  if ("error" in auth) return auth.error;
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => ({})) as { desde?: unknown };
  const from = Number(body.desde ?? 0);
  if (!Number.isInteger(from) || from < 0 || from >= CASES.length) return json({ error: "Tramo inválido." }, 400);
  const key = config.OPENAI_API_KEY?.trim();
  if (!key && !config.AI) return json({ error: "La app no tiene la IA configurada (falta OPENAI_API_KEY)." }, 503);
  const model = createWorkersAiModel(config.AI ?? null, { openAi: { apiKey: key, model: config.OPENAI_STRUCTURE_MODEL }, preferOpenAi: Boolean(key) });
  const today = new Date().toISOString().slice(0, 10);
  const slice = CASES.slice(from, from + BATCH);
  const results = await Promise.all(slice.map(async (caso) => {
    try {
      const { proposal, engine } = await proposeFromTranscript({ transcript: caso.dictado, chart: caso.chart }, model, () => {}, { today });
      const fallas = judgeCase(caso, proposal);
      return {
        id: caso.id, nota: caso.nota, motor: engine, ok: fallas.length === 0, fallas,
        odontograma: proposal.odontogram.map((item) => itemKey(item) + (item.advisory ? " [aviso]" : "")),
        arancel: (proposal.prestaciones ?? []).map((item) => item.code + (item.advisory ? " [objetada]" : "")),
      };
    } catch (cause) {
      return { id: caso.id, nota: caso.nota, motor: "error", ok: false, fallas: [cause instanceof Error ? cause.message.slice(0, 160) : "error"], odontograma: [], arancel: [] };
    }
  }));
  return json({ results, siguiente: from + BATCH < CASES.length ? from + BATCH : null, total: CASES.length });
}
