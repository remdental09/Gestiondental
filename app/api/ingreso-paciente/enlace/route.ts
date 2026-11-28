import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";
import { loadProfile } from "@/app/clinician-profile-db";
import { buildRawMessage, isValidEmail } from "@/lib/appointment-mail";
import { newVerifyToken } from "@/lib/document-verification";
import { patientIntakeLinks } from "@/db/schema";
import { getDb } from "@/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const PUBLIC_INTAKE_URL = "https://speakdent.cl/api/ingreso-paciente";
const INTAKE_EMAIL_FROM = "ingreso@speakdent.cl";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: noStore });
const tokenHash = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Crea un enlace de un solo uso y, si se indicó un correo, intenta enviarlo desde la cuenta conectada. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para crear el formulario.", 401);
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  if (!body || (body.email !== undefined && typeof body.email !== "string")) return fail("Solicitud inválida.");
  const recipient = typeof body.email === "string" ? body.email.trim() : "";
  if (recipient && !isValidEmail(recipient)) return fail("Revisa el correo del paciente.");

  const token = newVerifyToken();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await getDb().insert(patientIntakeLinks).values({
      ownerId: user.userId,
      tokenHash: await tokenHash(token),
      expiresAt,
      createdAt: createdAt.toISOString(),
    });
  } catch {
    return fail("No se pudo preparar el formulario. Intenta de nuevo.", 503);
  }

  let emailStatus: "not_requested" | "sent" | "failed" = "not_requested";
  const url = `${PUBLIC_INTAKE_URL}?t=${token}`;
  if (recipient) {
    try {
      const binding = (env as unknown as Cloudflare.Env).EMAIL;
      if (!binding) throw new Error("Cloudflare Email Service no está disponible.");
      const profile = await loadProfile(user.personalId || user.userId).catch(() => null);
      const clinic = profile?.clinicName?.trim() || "la clínica";
      const subject = "Completa tus datos para tu atención dental";
      const text = `Hola. ${clinic} te invita a completar tus datos básicos antes de tu atención. El enlace es personal, se puede usar una vez y vence en 7 días:\n\n${url}\n\nEl formulario solo solicita datos de identificación y contacto; no contiene preguntas clínicas.`;
      const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#35343f"><div style="max-width:520px;margin:24px auto;padding:24px;border:1px solid #e6e4ee;border-radius:12px"><h1 style="font-size:20px">Completa tus datos de ingreso</h1><p>${esc(clinic)} te invita a completar tus datos básicos antes de tu atención dental.</p><p><a href="${esc(url)}" style="display:inline-block;background:#473a6d;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Completar formulario</a></p><p style="font-size:13px;color:#6b6a7c">El enlace es personal, se puede usar una vez y vence en 7 días. El formulario solo solicita datos de identificación y contacto; no contiene preguntas clínicas.</p></div></body></html>`;
      await binding.send({
        from: { email: INTAKE_EMAIL_FROM, name: "SpeakDent" },
        to: recipient,
        subject,
        text,
        html,
      });
      emailStatus = "sent";
    } catch {
      emailStatus = "failed";
    }
  }
  return Response.json({ url, expiresAt, emailStatus }, { status: 201, headers: noStore });
}
