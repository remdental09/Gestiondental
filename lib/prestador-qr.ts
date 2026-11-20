// QR de habilitación del profesional (Certificado de inscripción del RNPI, Superintendencia de Salud).
// Se imprime en recetas y certificados para que quien lo escanee verifique que el profesional está habilitado.
// Orden de preferencia: 1) el contenido del QR leído del PDF original o de una imagen del QR, si apunta a un sitio de
// la Superintendencia; 2) el enlace al validador oficial con el código de validación del certificado.

/** Validador oficial: su página lee el parámetro «id» de la dirección y lo pone en el campo del ID del certificado. */
export const VALIDATOR_URL = "https://emisorcertificados.superdesalud.gob.cl/ValidacionCertificados/";
export const QR_PAYLOAD_MAX = 1000;
export const QR_IMAGE_MAX_BYTES = 300_000;
export type QrSource = "pdf" | "imagen" | "codigo" | "";

/** Limpia lo leído de un QR: sin caracteres de control, recortado. "" si no sirve. */
export function cleanQrPayload(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text && text.length <= QR_PAYLOAD_MAX ? text : "";
}

/** Solo se imprime un QR que lleve a un sitio oficial de la Superintendencia de Salud (https). */
export function isOfficialQr(payload: string): boolean {
  try {
    const url = new URL(payload);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && ["superdesalud.gob.cl", "supersalud.gob.cl"].some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

/** Enlace al validador oficial con el ID (código de validación) del certificado; "" si el código no tiene forma válida. */
export function validatorUrlFromCode(code: string): string {
  const clean = (code ?? "").trim();
  return /^[A-Za-z0-9]{6,10}$/.test(clean) ? `${VALIDATOR_URL}?id=${encodeURIComponent(clean)}` : "";
}

/** Lo que va en el QR impreso: el QR oficial leído, o el validador con el código. "" si no hay ninguno. */
export function printableQr(reg: { qrPayload?: string; validationCode?: string }): { url: string; from: "qr" | "codigo" | "" } {
  const payload = cleanQrPayload(reg.qrPayload ?? "");
  if (payload && isOfficialQr(payload)) return { url: payload, from: "qr" };
  const built = validatorUrlFromCode(reg.validationCode ?? "");
  return built ? { url: built, from: "codigo" } : { url: "", from: "" };
}

/** Leyenda bajo el QR en el documento impreso. */
export const qrCaption = (regSis: string) => `Verifique la habilitación del profesional – Superintendencia de Salud, N° registro ${regSis}`;

/** Clave del objeto en R2, siempre bajo la carpeta del profesional (aislamiento por profesional). */
export const certificateKey = (professionalId: string, id: string, kind: "pdf" | "qr") => `prestador/${professionalId}/${id}${kind === "pdf" ? ".pdf" : "-qr.png"}`;
export const ownsKey = (professionalId: string, key: string) => Boolean(key) && key.startsWith(`prestador/${professionalId}/`) && !key.includes("..");
