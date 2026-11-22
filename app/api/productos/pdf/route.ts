import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { renderProductsPdf } from "@/app/products-pdf";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** GET ?patientId=N[&ids=1,2]: PDF «Registro de trazabilidad» del paciente (o de los productos elegidos). */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para generar el registro.", 401);
  const params = new URL(request.url).searchParams;
  const patientId = Number(params.get("patientId"));
  if (!Number.isSafeInteger(patientId) || patientId < 1) return fail("Selecciona un paciente válido.");
  const ids = (params.get("ids") ?? "").split(",").map(Number).filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 100);
  try {
    const result = await renderProductsPdf(user.userId, personalIdOf(user), user.displayName, patientId, ids);
    if (!result) return fail("Paciente no encontrado.", 404);
    if (result.empty) return fail("Este paciente aún no tiene productos registrados.", 404);
    return new Response(result.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${result.fileName}"`, "Cache-Control": "private, no-store" } });
  } catch { return fail("No se pudo generar el registro.", 500); }
}
