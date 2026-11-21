/** Bloqueo de la firma del profesional: una vez guardada, cambiarla o quitarla exige un código enviado al correo con que se ingresó. */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const UNLOCK_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const RESEND_WAIT_MS = 60 * 1000;

/** Código de 6 dígitos con azar criptográfico (sin sesgo de módulo). */
export function newUnlockCode(random: (n: number) => Uint32Array = n => crypto.getRandomValues(new Uint32Array(n))): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  for (;;) {
    const [value] = random(1);
    if (value! < limit) return String(value! % 1_000_000).padStart(6, "0");
  }
}

export const cleanCode = (value: unknown): string => (typeof value === "string" ? value.replace(/\D/g, "") : "");
export const isCodeShape = (value: string) => /^\d{6}$/.test(value);

export type LockRow = { code_hash: string; expires_at: string; attempts: number; unlocked_until: string; last_sent_at: string };
export type VerifyResult = "ok" | "expired" | "wrong" | "blocked" | "none";

/** Decide el resultado de un intento sin tocar la base: `matches` es si la huella del código escrito coincide. */
export function judgeAttempt(row: LockRow | null, matches: boolean, now: number): VerifyResult {
  if (!row || !row.code_hash) return "none";
  if (row.attempts >= MAX_ATTEMPTS) return "blocked";
  if (Date.parse(row.expires_at) <= now) return "expired";
  return matches ? "ok" : "wrong";
}

export const isUnlocked = (row: Pick<LockRow, "unlocked_until"> | null, now: number) => !!row?.unlocked_until && Date.parse(row.unlocked_until) > now;
export const canResend = (row: Pick<LockRow, "last_sent_at"> | null, now: number) => !row?.last_sent_at || now - Date.parse(row.last_sent_at) >= RESEND_WAIT_MS;

/** ¿Este guardado cambia la firma ya guardada? (Guardar la misma imagen, o la primera vez, no pide código.) */
export const changesSavedMark = (saved: string, next: string) => !!saved && saved !== next;

const esc = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function unlockCodeEmail(code: string, clinicName?: string): { subject: string; text: string; html: string } {
  const subject = `Código para cambiar tu firma: ${code}`;
  const text = [`Tu código es ${code}.`, "", "Úsalo en la aplicación para cambiar o quitar tu firma. Vale 10 minutos y sirve una sola vez.", "Si no lo pediste tú, ignora este correo: tu firma sigue protegida."].join("\n");
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#35343f"><div style="max-width:480px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e6e4ee">
<p style="margin:0 0 12px;font-size:15px">Código para cambiar tu firma${clinicName ? ` · ${esc(clinicName)}` : ""}</p>
<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:6px;color:#473a6d">${esc(code)}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5">Vale 10 minutos y sirve una sola vez.</p>
<p style="margin:0;font-size:13px;color:#6b6a7c">Si no lo pediste tú, ignora este correo: tu firma sigue protegida.</p></div></div></body></html>`;
  return { subject, text, html };
}

export function signatureChangedEmail(action: "cambiada" | "quitada", whenLabel: string): { subject: string; text: string; html: string } {
  const subject = `Tu firma fue ${action}`;
  const text = [`Tu firma fue ${action} el ${whenLabel}.`, "La anterior quedó archivada.", "Si no fuiste tú, avísanos de inmediato."].join("\n");
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#35343f"><p>Tu firma fue <strong>${action}</strong> el ${esc(whenLabel)}.</p><p>La anterior quedó archivada.</p><p style="color:#6b6a7c">Si no fuiste tú, avísanos de inmediato.</p></body></html>`;
  return { subject, text, html };
}
