/**
 * Envío del código de ingreso (6 dígitos) al correo con que se entra a SpeakDent.
 * Sale de SpeakDent mismo (codigo@speakdent.cl, Cloudflare Email Service). Solo si ese envío falla se usa, de respaldo,
 * un Gmail ya conectado con permiso «solo enviar» (primero el de la propia consulta, luego el del desarrollador).
 */
import { env } from "cloudflare:workers";
import { getSender } from "@/app/appointment-mail-db";
import { sendMailWithSender } from "@/app/drive-oauth";
import { buildRawMessage } from "@/lib/appointment-mail";
import { loginCodeEmail } from "@/lib/login-code";

export const LOGIN_CODE_FROM = "codigo@speakdent.cl";

export type LoginCodeSend = { status: "sent"; from: string } | { status: "no-sender" } | { status: "failed"; reason: string };

export async function sendLoginCode(to: string, code: string, senderOwnerIds: string[], when: Date = new Date()): Promise<LoginCodeSend> {
  const mail = loginCodeEmail(code, when);
  const failures: string[] = [];
  const binding = (env as unknown as Cloudflare.Env).EMAIL;
  if (binding) {
    try {
      await binding.send({ from: { email: LOGIN_CODE_FROM, name: "SpeakDent" }, to, subject: mail.subject, text: mail.text, html: mail.html });
      return { status: "sent", from: LOGIN_CODE_FROM };
    } catch (error) {
      failures.push("speakdent.cl: " + (error instanceof Error ? error.message.slice(0, 120) : "error"));
    }
  }
  let any = Boolean(binding);
  for (const ownerId of [...new Set(senderOwnerIds.filter(Boolean))]) {
    const sender = await getSender(ownerId).catch(() => null);
    if (!sender) continue;
    any = true;
    try {
      await sendMailWithSender(sender, buildRawMessage({ from: sender.google_email, fromName: "SpeakDent", to, subject: mail.subject, text: mail.text, html: mail.html }));
      return { status: "sent", from: sender.google_email };
    } catch (error) {
      failures.push(error instanceof Error ? error.message.slice(0, 120) : "error");
    }
  }
  return any ? { status: "failed", reason: failures.join(" · ") } : { status: "no-sender" };
}
