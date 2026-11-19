import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { getDb } from "@/db";
import { patientDocuments, patients, professionalDocumentSettings } from "@/db/schema";
import { loadDocumentMark } from "@/app/document-mark-db";
import { cleanClinicalDocumentContent, isClinicalDocumentKind, type ClinicalDocumentKind } from "@/lib/clinical-documents";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para ver los documentos.", 401);
  const patientId = Number(new URL(request.url).searchParams.get("patientId"));
  if (!Number.isSafeInteger(patientId) || patientId < 1) return fail("Selecciona un paciente válido.");
  try {
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, user.userId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    const rows = await db.select({ document: patientDocuments, documentMark: professionalDocumentSettings.documentMark })
      .from(patientDocuments).leftJoin(professionalDocumentSettings, eq(patientDocuments.createdBy, professionalDocumentSettings.professionalId))
      .where(and(eq(patientDocuments.ownerId, user.userId), eq(patientDocuments.patientId, patientId)))
      .orderBy(desc(patientDocuments.id)).limit(100);
    const documents = rows.map(row => ({ ...row.document, documentMark: row.documentMark ?? "" }));
    return Response.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudieron cargar los documentos.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para guardar documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { patientId?: unknown; kind?: unknown; content?: unknown } | null;
  const patientId = Number(body?.patientId);
  if (!Number.isSafeInteger(patientId) || patientId < 1 || !isClinicalDocumentKind(body?.kind)) return fail("Revisa el paciente y el tipo de documento.");
  const kind: ClinicalDocumentKind = body.kind;
  const content = cleanClinicalDocumentContent(kind, body?.content);
  const personalId = personalIdOf(user);
  const profile = await loadProfile(personalId).catch(() => null);
  const authorName = (profile ? displayName(profile) : user.displayName).trim().slice(0, 120);
  const title = kind === "consentimiento" ? "Consentimiento informado" : kind === "receta" ? "Receta" : "Certificado";
  try {
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, user.userId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    const [document] = await db.insert(patientDocuments).values({
      ownerId: user.userId, patientId, kind, title, content: JSON.stringify(content), status: "borrador",
      createdBy: personalId, createdByName: authorName, createdAt: new Date().toISOString(),
    }).returning();
    const documentMark = await loadDocumentMark(personalId).catch(() => "");
    return Response.json({ document: { ...document, documentMark } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo guardar el borrador.", 500); }
}
