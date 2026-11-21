// Código de seguridad para cambiar o quitar la firma guardada. Llega al correo con que se ingresó a la aplicación.
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { ensureMailTables, getSender, mailDb } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { loadDocumentMark } from "@/app/document-mark-db";
import { grantUnlock, loadLock, reserveAttempt, storeCode } from "@/app/signature-lock-db";
import { buildRawMessage, isValidEmail } from "@/lib/appointment-mail";
import { sha256Hex } from "@/lib/consent-signature";
import { CODE_TTL_MS, UNLOCK_TTL_MS, canResend, cleanCode, isCodeShape, judgeAttempt, newUnlockCode, unlockCodeEmail } from "@/lib/signature-lock";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const maskEmail = (email: string) => email.replace(/^(.).*(@.*)$/, "$1•••$2");

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const body = await request.json().catch(() => null) as { action?: unknown; code?: unknown } | null;
  const professionalId = personalIdOf(user);
  const now = Date.now();
  try {
    if (body?.action === "enviar") {
      if (!await loadDocumentMark(professionalId)) return json({ error: "Aún no tienes una firma guardada." }, 409);
      if (!isValidEmail(user.email)) return json({ error: "Tu cuenta no tiene un correo válido para recibir el código." }, 409);
      const lock = await loadLock(professionalId);
      if (!canResend(lock, now)) return json({ error: "Espera un minuto antes de pedir otro código." }, 429);
      const db = mailDb(); if (db) await ensureMailTables(db);
      const sender = await getSender(user.userId);
      if (!sender) return json({ error: "Primero conecta el correo de envío (Agenda → correo a pacientes): desde ahí se manda el código." }, 409);
      const code = newUnlockCode();
      // Primero se guarda (solo su huella) y luego se envía: si el envío falla, el código anterior queda invalidado igual.
      await storeCode(professionalId, await sha256Hex(`${professionalId}:${code}`), new Date(now + CODE_TTL_MS).toISOString(), new Date(now).toISOString());
      const mail = unlockCodeEmail(code);
      await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: "Gestión Dental", to: user.email.trim(), ...mail }));
      return json({ ok: true, to: maskEmail(user.email.trim()) });
    }
    if (body?.action === "verificar") {
      const code = cleanCode(body.code);
      if (!isCodeShape(code)) return json({ error: "El código tiene 6 dígitos." }, 400);
      // El intento se reserva de forma atómica antes de comparar: pedidos simultáneos no pasan del límite.
      const reserved = await reserveAttempt(professionalId);
      const matches = !!reserved && await sha256Hex(`${professionalId}:${code}`) === reserved.code_hash;
      const result = reserved ? judgeAttempt({ ...reserved, attempts: reserved.attempts - 1, unlocked_until: "", last_sent_at: "" }, matches, now) : ((await loadLock(professionalId))?.code_hash ? "blocked" : "none");
      if (result === "ok" && reserved) {
        if (await grantUnlock(professionalId, reserved.code_hash, new Date(now + UNLOCK_TTL_MS).toISOString())) return json({ ok: true, minutes: UNLOCK_TTL_MS / 60000 });
        return json({ error: "Pide un código nuevo.", result: "none" }, 409);
      }
      const message = { ok: "Pide un código nuevo.", none: "Pide un código nuevo.", expired: "El código venció. Pide uno nuevo.", blocked: "Demasiados intentos. Pide un código nuevo.", wrong: "Código incorrecto." }[result];
      return json({ error: message, result }, result === "wrong" ? 400 : 409);
    }
    return json({ error: "Solicitud no válida." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "No se pudo completar." }, 502);
  }
}
