// Auditoría posterior al llenado: revisa lo que quedó guardado en las fichas del profesional (reglas fijas, sin IA).
// Se calcula al leer, así que siempre refleja el estado actual de la ficha; solo se guarda la decisión del profesional
// sobre cada observación («Real» / «Falsa alarma»), que sirve para medir cuánto acierta el auditor.
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { auditRecord, type AuditFinding } from "@/lib/audit/record-audit";
import { decodeBudgetData } from "@/lib/budget-plans";
import type { OdontogramData } from "@/app/clinical-data";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Statement = { bind(...values: unknown[]): Statement; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type Db = { prepare(sql: string): Statement };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const config = env as unknown as { DB?: Db };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const obj = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, never> : {});
function chartOf(raw: string): OdontogramData {
  let source: Record<string, unknown> = {};
  try { source = obj(JSON.parse(raw)); } catch { /* ficha sin odontograma legible: se audita como vacía */ }
  const teeth = { ...obj(source.teeth) } as Record<number, string>;
  for (const [key, value] of Object.entries(source)) if (/^\d{2}$/.test(key) && typeof value === "string") teeth[Number(key)] = value;
  return { teeth, surfaces: obj(source.surfaces) as OdontogramData["surfaces"], missingReason: obj(source.missingReason) as OdontogramData["missingReason"], crowns: obj(source.crowns) as OdontogramData["crowns"], history: [] };
}

async function ensureTable(db: Db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS audit_decisions (owner_id TEXT NOT NULL, finding_key TEXT NOT NULL, decision TEXT NOT NULL, decided_at TEXT NOT NULL, PRIMARY KEY (owner_id, finding_key))").run();
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const owner = user.userId;
  const only = Number(new URL(request.url).searchParams.get("patientId"));
  const safe = async <T,>(sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<T>().catch(() => ({ results: [] as T[] }))).results;
  try {
    await ensureTable(db);
    const [patients, charts, budgets, notes, decisions] = await Promise.all([
      safe<{ id: number; name: string }>("SELECT id, name FROM patients WHERE owner_id = ?", owner),
      safe<{ patient_id: number; data: string }>("SELECT patient_id, data FROM tooth_statuses WHERE owner_id = ?", owner),
      safe<{ id: number; patient_id: number; title: string; items: string }>("SELECT id, patient_id, title, items FROM budgets WHERE owner_id = ?", owner),
      safe<{ id: number; patient_id: number; clinical_date: string; body: string; status: string }>("SELECT id, patient_id, clinical_date, body, status FROM evolutions WHERE owner_id = ? AND clinical_date >= ?", owner, new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)),
      safe<{ finding_key: string; decision: string }>("SELECT finding_key, decision FROM audit_decisions WHERE owner_id = ?", owner),
    ]);
    const decided = new Map(decisions.map((row) => [row.finding_key, row.decision]));
    const day = today();
    const findings: Array<AuditFinding & { patientName: string; decision: "abierta" | "real" | "falsa" }> = [];
    for (const patient of patients) {
      if (Number.isSafeInteger(only) && only > 0 && patient.id !== only) continue;
      const chart = chartOf(charts.find((row) => row.patient_id === patient.id)?.data ?? "{}");
      const patientBudgets = budgets.filter((row) => row.patient_id === patient.id).flatMap((row) => {
        try { return [{ id: row.id, title: row.title, items: decodeBudgetData(row.items).items }]; } catch { return []; }
      });
      const patientNotes = notes.filter((row) => row.patient_id === patient.id).map((row) => ({ id: row.id, clinicalDate: row.clinical_date, body: row.body, status: row.status }));
      for (const finding of auditRecord({ patientId: patient.id, chart, budgets: patientBudgets, notes: patientNotes, today: day })) {
        const decision = decided.get(finding.key);
        findings.push({ ...finding, patientName: patient.name, decision: decision === "real" || decision === "falsa" ? decision : "abierta" });
      }
    }
    findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "alta" ? -1 : 1));
    const real = decisions.filter((row) => row.decision === "real").length, falsa = decisions.filter((row) => row.decision === "falsa").length;
    return json({ findings: findings.filter((item) => item.decision !== "falsa"), abiertas: findings.filter((item) => item.decision === "abierta").length, real, falsa, precision: real + falsa ? real / (real + falsa) : null });
  } catch {
    return json({ error: "No se pudo revisar la ficha." }, 500);
  }
}

/** {key, decision: "real" | "falsa" | "abierta"}: lo que el profesional decide sobre una observación. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const db = config.DB;
  if (!db) return json({ error: "Base de datos no disponible." }, 503);
  const body = await request.json().catch(() => ({})) as { key?: unknown; decision?: unknown };
  const key = typeof body.key === "string" ? body.key.slice(0, 300) : "";
  if (!key || (body.decision !== "real" && body.decision !== "falsa" && body.decision !== "abierta")) return json({ error: "Solicitud inválida." }, 400);
  try {
    await ensureTable(db);
    if (body.decision === "abierta") await db.prepare("DELETE FROM audit_decisions WHERE owner_id = ? AND finding_key = ?").bind(user.userId, key).run();
    else await db.prepare("INSERT INTO audit_decisions (owner_id, finding_key, decision, decided_at) VALUES (?,?,?,?) ON CONFLICT(owner_id, finding_key) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at")
      .bind(user.userId, key, body.decision, new Date().toISOString()).run();
    return json({ ok: true });
  } catch {
    return json({ error: "No se pudo guardar la decisión." }, 500);
  }
}
