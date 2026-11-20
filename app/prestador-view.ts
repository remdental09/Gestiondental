import { publicRegistration, type RegistrationRow } from "@/app/prestador-db";
import { isOfficialQr, printableQr, type QrSource } from "@/lib/prestador-qr";

/** Lo que ve el propio profesional: datos, estado, archivo guardado y QR que se imprimirá. */
export function registrationView(row: RegistrationRow | null) {
  if (!row) return null;
  const printable = printableQr({ qrPayload: row.qr_payload ?? "", validationCode: row.validation_code });
  return {
    status: row.status, reviewNote: row.review_note, ...publicRegistration(row),
    certificate: row.cert_key ? { name: row.cert_name || "certificado.pdf", size: Number(row.cert_size) || 0, uploadedAt: row.cert_uploaded_at || "" } : null,
    qr: { payload: row.qr_payload ?? "", source: (row.qr_source ?? "") as QrSource, official: Boolean(row.qr_payload && isOfficialQr(row.qr_payload)), hasImage: Boolean(row.qr_key), printUrl: printable.url, printFrom: printable.from },
  };
}

