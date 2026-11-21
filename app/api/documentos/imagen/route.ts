import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadDocumentMark, saveDocumentMark } from "@/app/document-mark-db";
import { archiveMark, consumeUnlock, loadLock } from "@/app/signature-lock-db";
import { ensureMailTables, getSender, mailDb } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { buildRawMessage, isValidEmail } from "@/lib/appointment-mail";
import { changesSavedMark, isUnlocked, signatureChangedEmail } from "@/lib/signature-lock";
import { validSignature } from "@/lib/signature-image";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para ver tu imagen de documentos.", 401);
  try {
    const professionalId = personalIdOf(user), documentMark = await loadDocumentMark(professionalId);
    const unlocked = documentMark ? isUnlocked(await loadLock(professionalId).catch(() => null), Date.now()) : false;
    return Response.json({ documentMark, locked: !!documentMark && !unlocked, unlocked }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return fail("No se pudo leer tu imagen de documentos.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para guardar tu imagen de documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { documentMark?: unknown } | null;
  const mark = typeof body?.documentMark === "string" ? body.documentMark.trim() : "";
  if (mark && !validSignature(mark)) return fail("La firma debe ser una imagen PNG, JPG o WebP de hasta 400 KB.");
  try {
    const professionalId = personalIdOf(user), now = Date.now(), saved = await loadDocumentMark(professionalId);
    const changes = changesSavedMark(saved, mark);
    // La firma guardada solo se cambia o se quita con el código enviado al correo: el permiso se gasta aquí, de forma atómica
    // (un permiso = un cambio, aunque lleguen dos guardados a la vez).
    if (changes) {
      if (!await consumeUnlock(professionalId, new Date(now).toISOString())) return Response.json({ error: "Tu firma está protegida. Pide el código a tu correo para cambiarla.", locked: true }, { status: 403, headers: { "Cache-Control": "no-store" } });
      await archiveMark(professionalId, saved, mark ? "cambiada" : "quitada", new Date(now).toISOString());
    }
    await saveDocumentMark(professionalId, mark);
    if (changes) await notifyChange(user.userId, user.email, mark ? "cambiada" : "quitada", now).catch(() => undefined);
    return Response.json({ documentMark: mark, locked: !!mark }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail("No se pudo guardar tu imagen de documentos.", 500); }
}

/** Aviso por correo de que la firma cambió (si falla el envío, el cambio igual queda registrado en el archivo). */
async function notifyChange(ownerId: string, email: string, action: "cambiada" | "quitada", now: number) {
  if (!isValidEmail(email)) return;
  const db = mailDb(); if (db) await ensureMailTables(db);
  const sender = await getSender(ownerId);
  if (!sender) return;
  const when = new Date(now).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" });
  await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: "Gestión Dental", to: email.trim(), ...signatureChangedEmail(action, when) }));
}
