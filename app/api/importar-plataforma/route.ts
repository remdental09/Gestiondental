import { getChatGPTUser, personalIdOf, spaceRoleOf } from "@/app/chatgpt-auth";
import { canManageTeam } from "@/lib/clinic-team";
import { MAX_BUNDLES_PER_CALL, MAX_ROWS_PER_CALL, importBundles, importTariffs, importedTotals } from "@/app/platform-import";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
const MAX_BODY = 1_500_000;

export async function GET() {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  try { return Response.json({ totals: await importedTotals(ownerId) }, { headers }); } catch { return fail("No se pudo comprobar lo importado.", 500); }
}

/** Recibe fichas ya leídas en el navegador (action "fichas") o aranceles (action "aranceles") y las guarda sin duplicar. */
export async function POST(request: Request) {
  const viewer = await getChatGPTUser();
  const ownerId = viewer?.userId;
  if (!viewer || !ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail("El grupo es demasiado grande.", 413);
    const body = JSON.parse(raw) as { action?: unknown; bundles?: unknown; tariffs?: unknown };
    if (body.action === "aranceles") {
      if (!Array.isArray(body.tariffs) || body.tariffs.length > 600) return fail("Solicitud no válida.");
      // Los aranceles son de cada profesional, también dentro de una clínica.
      return Response.json({ result: await importTariffs(personalIdOf(viewer), body.tariffs) }, { headers });
    }
    if (body.action !== "fichas" || !Array.isArray(body.bundles) || !body.bundles.length || body.bundles.length > MAX_BUNDLES_PER_CALL) return fail("Solicitud no válida.");
    const rows = (body.bundles as Array<{ plans?: unknown[]; notes?: unknown[]; payments?: unknown[] }>)
      .reduce((total, b) => total + (b?.plans?.length ?? 0) + (b?.notes?.length ?? 0) + (b?.payments?.length ?? 0), 0);
    if (rows > MAX_ROWS_PER_CALL) return fail("El grupo es demasiado grande.", 413);
    // Las fichas entran al espacio compartido: dentro de una clínica, solo un administrador las carga.
    if (!canManageTeam(spaceRoleOf(viewer))) return fail("Solo un administrador de la clínica puede importar fichas.", 403);
    return Response.json({ result: await importBundles(ownerId, body.bundles) }, { headers });
  } catch { return fail("No se pudo importar este grupo. Puedes reintentar: no se duplica nada.", 500); }
}
