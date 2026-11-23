/** Textos del código de ingreso por correo y de su pantalla. Sin dependencias del runtime. */
export const CODE_PATH = "/auth/codigo";
export const CODE_RESEND_PATH = "/auth/codigo/reenviar";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** «remdental09@gmail.com» → «re•••••09@gmail.com»: suficiente para reconocer la cuenta sin exponerla entera. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "";
  if (user.length <= 3) return user[0] + "•••@" + domain;
  return user.slice(0, 2) + "•".repeat(Math.min(6, user.length - 4) || 1) + user.slice(-2) + "@" + domain;
}

export function loginCodeEmail(code: string, when: Date) {
  const hour = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", dateStyle: "long", timeStyle: "short" }).format(when);
  const subject = `${code} es tu código de ingreso a SpeakDent`;
  const text = [
    `Tu código de ingreso a SpeakDent es: ${code}`,
    "",
    "Escríbelo en la pantalla de ingreso. Vence en 10 minutos.",
    `Solicitado el ${hour} (hora de Chile).`,
    "",
    "Si no fuiste tú, alguien tiene abierta tu cuenta de Google: no compartas este código y cambia tu clave de Google.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;color:#2b2a36">
<p style="margin:0 0 6px;font-size:15px">Tu código de ingreso a <strong>SpeakDent</strong> es:</p>
<p style="margin:0 0 14px;font-size:34px;letter-spacing:8px;font-weight:700;color:#473a6d">${escape(code)}</p>
<p style="margin:0 0 6px;font-size:14px">Escríbelo en la pantalla de ingreso. Vence en 10 minutos.</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b6a7c">Solicitado el ${escape(hour)} (hora de Chile).</p>
<p style="margin:0;font-size:13px;color:#9a3412">Si no fuiste tú, alguien tiene abierta tu cuenta de Google: no compartas este código y cambia tu clave de Google.</p>
</div>`;
  return { subject, text, html };
}

const MESSAGES: Record<string, string> = {
  incorrecto: "El código no coincide. Revisa el último correo y vuelve a escribirlo.",
  envio: "No pudimos enviar el código. Pulsa «Enviar otro código» en unos segundos.",
  espera: "Ya te enviamos un código hace poco. Espera unos segundos antes de pedir otro.",
  vencido: "El código venció. Pide uno nuevo.",
  reenviado: "Te enviamos un código nuevo. El anterior ya no sirve.",
};

export function loginCodePage(email: string, messageCode?: string | null): string {
  const message = messageCode ? MESSAGES[messageCode] ?? "" : "";
  const isError = Boolean(message) && messageCode !== "reenviado";
  return `<!doctype html>
<html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Código de ingreso · SpeakDent</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6eefc;background:#060a17}
main{width:min(400px,100%)}h1{font-size:24px;margin:0 0 8px}p{color:#aebbd4;margin:0 0 14px}
label{display:block;font-size:14px;margin:0 0 6px;color:#c9d6ee}
input{width:100%;box-sizing:border-box;min-height:56px;border-radius:12px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:28px;letter-spacing:10px;text-align:center}
input:focus{outline:2px solid #fb923c;outline-offset:2px}
button{width:100%;min-height:48px;margin-top:12px;border:0;border-radius:12px;background:#fff;color:#1c1530;font-size:16px;font-weight:700;cursor:pointer}
.link{background:none;color:#c9d6ee;text-decoration:underline;font-weight:500;min-height:40px}
.msg{padding:10px 12px;border-radius:10px;font-size:14px}.err{background:#4c0519;color:#fecdd3}.ok{background:#052e16;color:#bbf7d0}
a{color:#c9d6ee}</style></head>
<body><main>
<h1>Revisa tu correo</h1>
<p>Te enviamos un código de 6 dígitos a <strong>${escape(maskEmail(email))}</strong>. Vence en 10 minutos.</p>
${message ? `<p class="msg ${isError ? "err" : "ok"}" role="${isError ? "alert" : "status"}">${escape(message)}</p>` : ""}
<form method="post" action="${CODE_PATH}">
<label for="codigo">Código de ingreso</label>
<input id="codigo" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>
<button type="submit">Entrar</button>
</form>
<form method="post" action="${CODE_RESEND_PATH}"><button class="link" type="submit">Enviar otro código</button></form>
<p style="margin-top:14px;font-size:13px">¿No es tu cuenta? <a href="/auth/salir">Cancelar y entrar con otra</a></p>
</main></body></html>`;
}
