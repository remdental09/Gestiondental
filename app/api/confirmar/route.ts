// Página PÚBLICA a la que llega el paciente desde su correo. No usa la sesión del clínico: solo un enlace secreto de un solo uso por cita.
// En Cloudflare Access debe haber una política «Bypass» para esta ruta (/api/confirmar).
import { hashToken } from "@/app/appointment-mail";
import { reminderByHash, setResponse } from "@/app/appointment-mail-db";
import { setConfirmation } from "@/app/appointment-confirmations-db";
import { loadProfile } from "@/app/clinician-profile-db";
import { whenParts } from "@/lib/appointment-mail";
import { env } from "cloudflare:workers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>` +
  `<body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><div style="max-width:460px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e6e4ee">${body}</div></div></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin", "X-Robots-Tag": "noindex" } });
const notFound = () => page("Enlace no válido", "<h1 style=\"font-size:20px;margin:0 0 8px\">Este enlace no es válido</h1><p style=\"margin:0\">Puede haber vencido o la cita cambió. Comunícate con la clínica para confirmar tu hora.</p>", 404);

async function resolve(token: string) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const hash = await hashToken(token);
  const reminder = await reminderByHash(hash);
  if (!reminder) return null;
  const db = (env as unknown as { DB?: { prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null> } } } }).DB;
  const event = await db?.prepare("SELECT start_at, end_at, status FROM calendar_events WHERE id = ? AND owner_id = ?").bind(reminder.event_id, reminder.owner_id).first<{ start_at: string; end_at: string; status: string }>();
  // La cita debe seguir existiendo, a la misma hora y sin haber pasado.
  if (!event || event.status !== "confirmed" || event.start_at !== reminder.start_at || new Date(event.end_at).getTime() < Date.now()) return null;
  const profile = await loadProfile(reminder.owner_id).catch(() => null);
  return { hash, reminder, clinic: profile?.clinicName || "" };
}

// El GET solo muestra la cita y los botones: los programas que revisan enlaces de los correos no deben confirmar por error.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const found = await resolve(url.searchParams.get("t") || "");
  if (!found) return notFound();
  const { day, time } = whenParts(found.reminder.start_at);
  const token = esc(url.searchParams.get("t") || "");
  const decline = url.searchParams.get("a") === "no";
  const btn = (answer: string, label: string, primary: boolean) => `<form method="post" style="margin:0 0 10px"><input type="hidden" name="t" value="${token}"><input type="hidden" name="a" value="${answer}"><button style="width:100%;padding:14px;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;${primary ? "background:#473a6d;color:#fff;border:0" : "background:#fff;color:#473a6d;border:1px solid #bdb7d3"}">${label}</button></form>`;
  return page("Confirma tu cita", `<h1 style="font-size:20px;margin:0 0 8px">Tu cita${found.clinic ? ` en ${esc(found.clinic)}` : ""}</h1><p style="font-size:18px;margin:0 0 20px"><strong>${esc(day)}</strong> a las <strong>${esc(time)}</strong></p>${decline ? btn("no", "No podré asistir", true) + btn("si", "Confirmo mi asistencia", false) : btn("si", "Confirmo mi asistencia", true) + btn("no", "No podré asistir", false)}`);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return page("No permitido", "<p>Solicitud no permitida.</p>", 403);
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("t") ?? "");
  const answer = String(form?.get("a") ?? "");
  if (answer !== "si" && answer !== "no") return notFound();
  const found = await resolve(token);
  if (!found) return notFound();
  try {
    await setResponse(found.hash, answer === "si" ? "confirmed" : "declined");
    // Confirmar marca la cita como confirmada en la agenda del clínico; avisar que no asiste la deja desmarcada y visible.
    await setConfirmation(found.reminder.owner_id, found.reminder.event_id, answer === "si");
  } catch { return page("Error", "<p>No pudimos registrar tu respuesta. Intenta de nuevo o comunícate con la clínica.</p>", 500); }
  return answer === "si"
    ? page("Cita confirmada", "<h1 style=\"font-size:20px;margin:0 0 8px\">¡Gracias! Tu cita quedó confirmada ✔</h1><p style=\"margin:0\">Te esperamos.</p>")
    : page("Aviso recibido", "<h1 style=\"font-size:20px;margin:0 0 8px\">Gracias por avisar</h1><p style=\"margin:0\">Registramos que no podrás asistir. La clínica se pondrá en contacto para reagendar.</p>");
}
