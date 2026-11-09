import { and, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { clinicalImages, patients } from "@/db/schema";
import { loadAllEndo, loadEndo, saveEndo } from "@/app/endodontics-db";
import { caseStatus, emptyEndo, normalizeEndo, referencedEndoImageIds } from "@/lib/endodontics";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers });
const todayChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** Sin patientId: casos endodónticos abiertos o con control pendiente de todos los pacientes. Con patientId: el endograma completo. */
export async function GET(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  try {
    const param = new URL(request.url).searchParams.get("patientId");
    if (param === null) {
      const today = todayChile();
      const all = await loadAllEndo(ownerId);
      return Response.json({ cases: all.flatMap(item => item.data.cases.map(c => ({ patientId: item.patientId, caseId: c.id, tooth: c.tooth, type: c.type, status: caseStatus(c, today), nextControlDate: c.nextControlDate }))).filter(c => c.status !== "Cerrado") }, { headers });
    }
    const patientId = Number(param);
    if (!Number.isSafeInteger(patientId) || patientId < 1) return fail("Paciente inválido.");
    const [patient] = await getDb().select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!patient) return fail("Paciente no encontrado.", 404);
    const found = await loadEndo(ownerId, patientId);
    return Response.json({ data: found?.data ?? emptyEndo() }, { headers });
  } catch { return fail("No se pudo leer el endograma.", 500); }
}

export async function PUT(request: Request) {
  const ownerId = (await getChatGPTUser())?.userId;
  if (!ownerId) return fail("Inicia sesión.", 401);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  try {
    const body = await request.json() as { patientId?: unknown; data?: unknown };
    const patientId = Number(body.patientId);
    if (!Number.isSafeInteger(patientId) || patientId < 1) return fail("Paciente inválido.");
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
    if (!patient) return fail("Paciente no encontrado.", 404);
    const data = normalizeEndo(body.data);
    const ids = referencedEndoImageIds(data);
    if (ids.length) {
      const owned = await db.select({ id: clinicalImages.id }).from(clinicalImages).where(and(eq(clinicalImages.ownerId, ownerId), eq(clinicalImages.patientId, patientId), inArray(clinicalImages.id, ids)));
      if (owned.length !== ids.length) return fail("Una de las radiografías no pertenece a este paciente.", 400);
    }
    await saveEndo(ownerId, patientId, data, false);
    return Response.json({ data }, { headers });
  } catch { return fail("No se pudo guardar el endograma.", 500); }
}
