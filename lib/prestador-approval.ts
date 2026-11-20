// Habilitación automática para emitir recetas (beta): si el certificado del RNPI se leyó bien y todo coincide,
// el profesional queda habilitado al instante (es responsable de lo que sube). Si algo no coincide, queda en revisión
// manual y se le dice exactamente qué no coincidió.
import type { PrestadorCertificate } from "./prestador-certificate.ts";
import { isOfficialQr, printableQr } from "./prestador-qr.ts";

export const AUTO_REVIEWER = "automático (certificado verificado)";

const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
export const isDentist = (profession: string) => /\bcirujano dentista\b/.test(plain(profession));
const VALID_CODE = /^[A-Za-z0-9]{6,10}$/;

/** id del validador dentro del QR (…/ValidacionCertificados/?id=XXXX), o "" si no trae. */
function qrId(payload: string): string {
  try { return new URL(payload).searchParams.get("id") ?? ""; } catch { return ""; }
}

export type ApprovalCheck = { approved: boolean; reasons: string[] };

/** El RUN ya se comprobó contra el RUT del perfil antes de llamar a esto. */
export function autoApproval(cert: PrestadorCertificate, qrPayload = ""): ApprovalCheck {
  const reasons: string[] = [];
  if (!isDentist(cert.profession)) reasons.push(`La profesión del certificado es «${cert.profession || "sin profesión"}», no «Cirujano Dentista».`);
  if (!VALID_CODE.test(cert.validationCode)) reasons.push("No se encontró un código de validación válido en el certificado.");
  const printable = printableQr({ qrPayload, validationCode: cert.validationCode });
  if (!printable.url || !isOfficialQr(printable.url)) reasons.push("Ni el QR ni el enlace de validación llevan al sitio de la Superintendencia de Salud.");
  const id = qrPayload ? qrId(qrPayload) : "";
  if (id && VALID_CODE.test(cert.validationCode) && id !== cert.validationCode) reasons.push(`El QR del PDF (código ${id}) no corresponde al código de validación del texto (${cert.validationCode}).`);
  return { approved: reasons.length === 0, reasons };
}
