import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { renderBudgetPdf } from "@/app/budget-mail";
import { checkBudgetFormat, type BudgetFormat } from "@/lib/budget-format";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const MODES = new Set(["detailed", "total", "no-prices"]);

/** GET ?budgetId=&mode=: el mismo PDF que se envía por correo, para descargarlo. */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "Inicia sesión." }, { status: 401 });
  const url = new URL(request.url);
  const budgetId = Number(url.searchParams.get("budgetId"));
  const modeParam = url.searchParams.get("mode") ?? "detailed";
  if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !MODES.has(modeParam)) return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  try {
    const { bytes, fileName } = await renderBudgetPdf(user.userId, budgetId, modeParam as "detailed" | "total" | "no-prices");
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo generar el PDF." }, { status: 409 }); }
}

/**
 * POST {budgetId, mode, format?}: el mismo PDF, con el diseño en borrador si quien lo pide es quien armó el presupuesto.
 * La vista previa y la descarga salen de aquí, así que lo que se ve es exactamente lo que se entrega. No guarda nada.
 * La cabecera X-Format-Editable dice si el diseño enviado se aplicó (si no, es el diseño guardado de quien lo armó).
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return Response.json({ error: "Inicia sesión." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Origen no permitido." }, { status: 403 });
  const body = await request.json().catch(() => null) as { budgetId?: unknown; mode?: unknown; format?: unknown } | null;
  const budgetId = Number(body?.budgetId);
  const mode = typeof body?.mode === "string" ? body.mode : "detailed";
  if (!Number.isSafeInteger(budgetId) || budgetId < 1 || !MODES.has(mode)) return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  let draft: { viewerId: string; format: BudgetFormat } | undefined;
  if (body?.format !== undefined) {
    const checked = checkBudgetFormat(body.format);
    if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });
    draft = { viewerId: personalIdOf(user), format: checked.format };
  }
  try {
    const { bytes, fileName, editable } = await renderBudgetPdf(user.userId, budgetId, mode as "detailed" | "total" | "no-prices", draft);
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"`, "X-Format-Editable": editable ? "1" : "0", "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo generar el PDF." }, { status: 409 }); }
}
