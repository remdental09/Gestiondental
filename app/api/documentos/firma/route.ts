// Firma del paciente en un consentimiento emitido: en pantalla (en la consulta) o por un enlace personal que se le envía.
// Requiere sesión del clínico. La página pública a la que llega el paciente está en /api/firmar.
import { and, eq } from "drizzle-orm";
import { ensureDocumentIssuanceColumns } from "@/app/document-issuance-db";
import { ensureConsentSignatureTable, signatureView } from "@/app/consent-signature-db";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { getDb } from "@/db";
import { consentSignatures, patientDocuments, patients } from "@/db/schema";
import { SIGN_PATH, cleanSignatureImage, cleanSignerText, isSignerRole, sha256Hex, signLinkExpiry, signMessage, signUrl, signatureHash, whatsappSignLink } from "@/lib/consent-signature";
import { newVerifyToken } from "@/lib/document-verification";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const headersNoStore = { "Cache-Control": "no-store" };
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: headersNoStore });

type Body = { id?: unknown; action?: unknown; image?: unknown; signerRole?: unknown; signerName?: unknown; signerRelation?: unknown; accept?: unknown };

export async function POST(request: Request) {
  await ensureDocumentIssuanceColumns();
  await ensureConsentSignatureTable();
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para registrar la firma.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as Body | null;
  const id = Number(body?.id);
  const action = body?.action;
  if (!Number.isSafeInteger(id) || id < 1 || (action !== "firmar" && action !== "enlace" && action !== "cancelar")) return fail("Solicitud no válida.");
  try {
    const db = getDb();
    const [doc] = await db.select().from(patientDocuments).where(and(eq(patientDocuments.id, id), eq(patientDocuments.ownerId, user.userId))).limit(1);
    if (!doc) return fail("Documento no encontrado.", 404);
    if (doc.kind !== "consentimiento") return fail("Solo el consentimiento informado lleva firma del paciente.");
    if (doc.status !== "emitido" || !doc.contentHash || doc.revokedAt) return fail("Para firmarlo, el consentimiento debe estar emitido y vigente. Emítelo con QR primero.", 409);
    const [patient] = await db.select({ id: patients.id, name: patients.name, phone: patients.phone }).from(patients).where(and(eq(patients.id, doc.patientId), eq(patients.ownerId, user.userId))).limit(1);
    if (!patient) return fail("Paciente no encontrado.", 404);
    const [signed] = await db.select({ id: consentSignatures.id }).from(consentSignatures).where(and(eq(consentSignatures.documentId, id), eq(consentSignatures.status, "firmado"))).limit(1);
    if (signed && action !== "cancelar") return fail("Este consentimiento ya fue firmado.", 409);
    const now = new Date();

    if (action === "cancelar") {
      await db.update(consentSignatures).set({ status: "cancelado", tokenHash: null }).where(and(eq(consentSignatures.documentId, id), eq(consentSignatures.ownerId, user.userId), eq(consentSignatures.status, "pendiente")));
      return Response.json({ signature: null }, { headers: headersNoStore });
    }

    if (action === "enlace") {
      // Un solo enlace vigente por documento: el anterior deja de servir.
      await db.update(consentSignatures).set({ status: "cancelado", tokenHash: null }).where(and(eq(consentSignatures.documentId, id), eq(consentSignatures.ownerId, user.userId), eq(consentSignatures.status, "pendiente")));
      const token = newVerifyToken();
      const [row] = await db.insert(consentSignatures).values({
        documentId: id, ownerId: user.userId, patientId: doc.patientId, status: "pendiente",
        tokenHash: await sha256Hex(token), tokenExpiresAt: signLinkExpiry(now), createdAt: now.toISOString(),
      }).returning();
      const url = signUrl(new URL(request.url).origin, token);
      const profile = await loadProfile(personalIdOf(user)).catch(() => null);
      const message = signMessage(patient.name, profile?.clinicName ?? "", url);
      // El enlace completo solo se entrega ahora; si se pierde, se genera otro.
      return Response.json({ signature: signatureView(row!, now), link: { url, message, whatsapp: whatsappSignLink(patient.phone, message), path: SIGN_PATH } }, { status: 201, headers: headersNoStore });
    }

    // Firma en pantalla, en la consulta: el paciente (o su representante) firma en el dispositivo del profesional.
    if (body?.accept !== true) return fail("Falta la aceptación de la declaración antes de firmar.");
    const image = cleanSignatureImage(body.image);
    if (!image) return fail("La firma no es válida. Vuelve a firmar en el recuadro.");
    const role = isSignerRole(body.signerRole) ? body.signerRole : "paciente";
    const relation = role === "representante" ? cleanSignerText(body.signerRelation, 60) : "";
    const signerName = role === "representante" ? cleanSignerText(body.signerName, 120) : patient.name;
    if (role === "representante" && (!signerName || !relation)) return fail("Indica el nombre y la relación del representante legal.");
    const signedAt = now.toISOString();
    const hash = await signatureHash({ documentHash: doc.contentHash, image, signedAt, signerName, signerRole: role, signerRelation: relation, method: "presencial" });
    // Cualquier enlace pendiente deja de servir: la firma ya quedó registrada.
    await db.update(consentSignatures).set({ status: "cancelado", tokenHash: null }).where(and(eq(consentSignatures.documentId, id), eq(consentSignatures.ownerId, user.userId), eq(consentSignatures.status, "pendiente")));
    const [row] = await db.insert(consentSignatures).values({
      documentId: id, ownerId: user.userId, patientId: doc.patientId, status: "firmado",
      signerName, signerRole: role, signerRelation: relation, image, signedAt, method: "presencial",
      ip: (request.headers.get("cf-connecting-ip") ?? "").slice(0, 64), userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300),
      signatureHash: hash, createdAt: signedAt,
    }).returning();
    return Response.json({ signature: signatureView(row!, now) }, { status: 201, headers: headersNoStore });
  } catch (reason) {
    // El índice único impide dos firmas del mismo documento si dos pantallas firman a la vez.
    if (reason instanceof Error && /UNIQUE/i.test(reason.message)) return fail("Este consentimiento ya fue firmado.", 409);
    return fail("No se pudo registrar la firma.", 500);
  }
}
