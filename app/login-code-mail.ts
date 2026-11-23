/**
 * Envío del código de ingreso (6 dígitos) al correo con que se entra a SpeakDent.
 * Usa un Gmail ya conectado con permiso «solo enviar»: primero el de la propia consulta (se lo envía a sí mismo)
 * y, si no tiene, el del desarrollador (cuenta del sistema). Nunca lee la bandeja.
 */
import { getSender } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { buildRawMessage } from "@/lib/appointment-mail";
import { loginCodeEmail } from "@/lib/login-code";

export type LoginCodeSend = { status: "sent"; from: string } | { status: "no-sender" } | { status: "failed"; reason: string };

export async function sendLoginCode(to: string, code: string, senderOwnerIds: string[], when: Date = new Date()): Promise<LoginCodeSend> {
  const tried: string[] = [];
  let any = false;
  for (const ownerId of [...new Set(senderOwnerIds.filter(Boolean))]) {
    const sender = await getSender(ownerId).catch(() => null);
    if (!sender) continue;
    any = true;
    try {
      const mail = loginCodeEmail(code, when);
      await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: "SpeakDent", to, subject: mail.subject, text: mail.text, html: mail.html }));
      return { status: "sent", from: sender.google_email };
    } catch (error) {
      tried.push(error instanceof Error ? error.message.slice(0, 120) : "error");
    }
  }
  return any ? { status: "failed", reason: tried.join(" · ") } : { status: "no-sender" };
}
