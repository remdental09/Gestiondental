import { getChatGPTUser } from "@/app/chatgpt-auth";
import { previewBudgetMail, sendBudgetPdf } from "@/app/budget-mail";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const sameOrigin = (request: Request) => request.headers.get("origin") === new URL(request.url).origin;
const MODES = new Set(["detailed", "total", "no-prices"]);

/** GET ?budgetId=: a quién se enviaría (para confirmar antes). */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  const budgetId = Number(new URL(request.url).searchParams.get("budgetId"));
  if (!Number.isSafeInteger(budgetId) || budgetId < 1) return json({ error: "Presupuesto inválido." }, 400);
  try { return json({ preview: await previewBudgetMail(user.userId, budgetId) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo preparar el correo." }, 409); }
}

/** POST {budgetId, mode}: genera el PDF y lo envía ya al correo registrado del paciente. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { budgetId?: unknown; mode?: unknown } | null;
  const budgetId = Number(body?.budgetId);
  const mode = typeof body?.mode === "string" && MODES.has(body.mode) ? body.mode as "detailed" | "total" | "no-prices" : "detailed";
  if (!Number.isSafeInteger(budgetId) || budgetId < 1) return json({ error: "Presupuesto inválido." }, 400);
  try { return json({ ok: true, ...(await sendBudgetPdf(user.userId, budgetId, mode)) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "No se pudo enviar el correo." }, 502); }
}
