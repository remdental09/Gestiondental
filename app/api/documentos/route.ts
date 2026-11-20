import { and, desc, eq } from "drizzle-orm";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { displayName } from "@/lib/clinician-profile";
import { getDb } from "@/db";
import { patientDocuments, patients, professionalDocumentSettings } from "@/db/schema";
import { loadDocumentMark } from "@/app/document-mark-db";
import { loadApprovedRegistrations } from "@/app/prestador-db";
import { CLINICAL_DOCUMENT_LABEL, cleanClinicalDocumentContent, isClinicalDocumentKind, type ClinicalDocumentKind } from "@/lib/clinical-documents";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  await ensureDocumentIssuanceColumns();
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
    const registrations = await loadApprovedRegistrations(rows.map(row => row.document.createdBy)).catch(() => new Map());
    const documents = rows.map(row => ({ ...row.document, documentMark: row.documentMark ?? "", registration: registrations.get(row.document.createdBy) ?? null }));
    return Response.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudieron cargar los documentos.", 500); }
}

export async function POST(request: Request) {
  await ensureDocumentIssuanceColumns();
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para guardar documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { patientId?: unknown; kind?: unknown; content?: unknown; replacesId?: unknown } | null;
  const patientId = Number(body?.patientId);
  if (!Number.isSafeInteger(patientId) || patientId < 1 || !isClinicalDocumentKind(body?.kind)) return fail("Revisa el paciente y el tipo de documento.");
  const kind: ClinicalDocumentKind = body.kind;
  const content = cleanClinicalDocumentContent(kind, body?.content);
  const personalId = personalIdOf(user);
  const profile = await loadProfile(personalId).catch(() => null);
  const authorName = (profile ? displayName(profile) : user.displayName).trim().slice(0, 120);
  const title = CLINICAL_DOCUMENT_LABEL[kind];
  try {
    const db = getDb();
    const [patient] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, user.userId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    // Una nueva versión puede reemplazar un documento ya emitido del mismo paciente; se anula solo al emitir la nueva.
    const replacesId = Number(body?.replacesId);
    let replaces: number | null = null;
    if (Number.isSafeInteger(replacesId) && replacesId > 0) {
      const [previous] = await db.select({ id: patientDocuments.id }).from(patientDocuments).where(and(eq(patientDocuments.id, replacesId), eq(patientDocuments.ownerId, user.userId), eq(patientDocuments.patientId, patientId), eq(patientDocuments.status, "emitido"))).limit(1);
      replaces = previous?.id ?? null;
    }
    const [document] = await db.insert(patientDocuments).values({
      ownerId: user.userId, patientId, kind, title, content: JSON.stringify(content), status: "borrador",
      createdBy: personalId, createdByName: authorName, createdAt: new Date().toISOString(), replacesId: replaces,
    }).returning();
    const documentMark = await loadDocumentMark(personalId).catch(() => "");
    // La habilitación va con el documento desde el primer momento (antes llegaba solo al recargar: la receta recién creada salía sin el QR).
    const registration = (await loadApprovedRegistrations([personalId]).catch(() => new Map())).get(personalId) ?? null;
    return Response.json({ document: { ...document, documentMark, registration } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo guardar el borrador.", 500); }
}
