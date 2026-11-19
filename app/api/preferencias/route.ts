import { getChatGPTUser, managesSpace } from "@/app/chatgpt-auth";
import { getBudgetValidityDays, setBudgetValidityDays } from "@/app/followup-db";
import { json, sameOrigin } from "@/app/followup-http";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/** Preferencias del espacio: por ahora, la vigencia de los presupuestos (días) para marcarlos «Expirado». */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ budgetValidityDays: await getBudgetValidityDays(user.userId) }); }
  catch { return json({ error: "No se pudieron leer las preferencias." }, 500); }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!managesSpace(user)) return json({ error: "Solo un administrador de la clínica puede cambiar la vigencia." }, 403);
  const body = await request.json().catch(() => null) as { budgetValidityDays?: unknown } | null;
  const days = Number(body?.budgetValidityDays);
  if (!Number.isInteger(days) || days < 7 || days > 730) return json({ error: "La vigencia debe estar entre 7 y 730 días." }, 400);
  try { return json({ budgetValidityDays: await setBudgetValidityDays(user.userId, days) }); }
  catch { return json({ error: "No se pudo guardar la vigencia." }, 500); }
}
