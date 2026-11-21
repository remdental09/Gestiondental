import { getChatGPTUser, spaceRoleOf } from "@/app/chatgpt-auth";
import { canManageTeam } from "@/lib/clinic-team";
import { MAX_ROWS, existingRuts, importAppointments, importNotes, importPatients, loadMapping, saveMapping } from "@/app/patient-import-db";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
const MAX_BODY = 2_000_000;

/** RUT que ya existen en la cuenta y el mapeo de columnas recordado (para la vista previa; no guarda nada). */
export async function GET() {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  try { return Response.json({ ruts: await existingRuts(ownerId), mapping: await loadMapping(ownerId) }, { headers }); }
  catch { return fail("No se pudieron leer las fichas existentes.", 500); }
}

/** Guarda un lote ya confirmado: «pacientes», «evoluciones», «citas» o el «mapeo» de columnas. */
export async function POST(request: Request) {
  const viewer = await getChatGPTUser();
  const ownerId = viewer?.userId;
  if (!viewer || !ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  if (!canManageTeam(spaceRoleOf(viewer))) return fail("Solo un administrador de la clínica puede importar pacientes.", 403);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail("El lote es demasiado grande.", 413);
    const body = JSON.parse(text) as { action?: unknown; rows?: unknown; mode?: unknown; mapping?: unknown };
    if (body.action === "mapeo") { await saveMapping(ownerId, body.mapping); return Response.json({ ok: true }, { headers }); }
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > MAX_ROWS) return fail("Lote no válido.");
    if (body.action === "pacientes") return Response.json({ results: await importPatients(ownerId, body.rows, body.mode === "completar" ? "completar" : "omitir") }, { headers });
    if (body.action === "evoluciones") return Response.json({ results: await importNotes(ownerId, body.rows) }, { headers });
    if (body.action === "citas") return Response.json({ results: await importAppointments(ownerId, body.rows) }, { headers });
    return fail("Acción no válida.");
  } catch { return fail("No se pudo importar este lote. Puedes reintentar: no se duplica nada.", 500); }
}
