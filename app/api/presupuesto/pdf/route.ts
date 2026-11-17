import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { renderBudgetPdf } from "@/app/budget-mail";

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
    const { bytes, fileName } = await renderBudgetPdf(user.userId, budgetId, modeParam as "detailed" | "total" | "no-prices", personalIdOf(user));
    return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo generar el PDF." }, { status: 409 }); }
}
