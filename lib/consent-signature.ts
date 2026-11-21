// Firma electrónica simple del paciente en el consentimiento informado (firma manuscrita en pantalla).
// El paciente firma un documento YA emitido (su contenido y huella no cambian). La firma queda ligada a esa huella,
// con fecha, hora, método y dispositivo, y su propia huella: si algo cambia después, la verificación lo muestra.
// Límite: es firma electrónica simple (Ley 19.799), no avanzada; acredita la voluntad registrada, no reemplaza el consejo legal.

export const SIGN_LINK_HOURS = 72;
export const SIGNER_ROLES = ["paciente", "representante"] as const;
export type SignerRole = typeof SIGNER_ROLES[number];
export const SIGN_METHODS = ["presencial", "enlace"] as const;
export type SignMethod = typeof SIGN_METHODS[number];

export const SIGNER_ROLE_LABEL: Record<SignerRole, string> = { paciente: "Paciente", representante: "Representante legal" };
export const SIGN_METHOD_LABEL: Record<SignMethod, string> = { presencial: "en pantalla, en la consulta", enlace: "desde un enlace enviado al paciente" };

/** Texto que el firmante acepta antes de firmar; se guarda tal cual en la huella para dejar constancia. */
export const SIGN_ACCEPTANCE = "Declaro que leí este consentimiento informado, que el profesional me explicó el procedimiento, sus riesgos y las alternativas, que pude hacer preguntas y que acepto realizarlo. Mi firma manuscrita en pantalla se registra como firma electrónica simple.";

export const SIGNATURE_IMAGE_MIN = 500;
export const SIGNATURE_IMAGE_MAX = 250_000;

export const isSignerRole = (value: unknown): value is SignerRole => typeof value === "string" && (SIGNER_ROLES as readonly string[]).includes(value);
export const isSignMethod = (value: unknown): value is SignMethod => typeof value === "string" && (SIGN_METHODS as readonly string[]).includes(value);

/** Imagen PNG de la firma como data URL. Devuelve "" si no es un PNG en base64 de tamaño razonable. */
export function cleanSignatureImage(value: unknown): string {
  if (typeof value !== "string") return "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return "";
  return value.length >= SIGNATURE_IMAGE_MIN && value.length <= SIGNATURE_IMAGE_MAX ? value : "";
}

export const cleanSignerText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export type SignatureHashInput = { documentHash: string; image: string; signedAt: string; signerName: string; signerRole: string; signerRelation: string; method: string };

/** Huella de la firma: liga la imagen, quién firmó, cuándo y cómo a la huella del documento emitido. */
export async function signatureHash(input: SignatureHashInput): Promise<string> {
  return sha256Hex(JSON.stringify([input.documentHash, await sha256Hex(input.image), input.signedAt, input.signerName, input.signerRole, input.signerRelation, input.method, SIGN_ACCEPTANCE]));
}

/** Enlace de firma: código secreto largo (el mismo formato del QR de verificación). Solo se guarda su huella. */
export const signLinkExpiry = (now: Date, hours = SIGN_LINK_HOURS): string => new Date(now.getTime() + hours * 3_600_000).toISOString();

export type SignatureRowState = { status: string; tokenExpiresAt: string };

/** Un enlace sirve solo si la firma sigue pendiente y no venció. */
export const isSignLinkActive = (row: SignatureRowState, now = new Date()): boolean =>
  row.status === "pendiente" && Boolean(row.tokenExpiresAt) && new Date(row.tokenExpiresAt).getTime() > now.getTime();

export const SIGN_PATH = "/api/firmar";
export const signUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, "")}${SIGN_PATH}?t=${token}`;

const alnum = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const IDENTITY_TAIL = 4;

/** Verificación de identidad en el enlace: el firmante escribe los últimos 4 caracteres del documento de identidad del paciente.
 *  Si la ficha no tiene documento, no se puede exigir y solo queda el secreto del enlace. */
export function identityRequired(storedDocument: string | null | undefined): boolean {
  return alnum(storedDocument ?? "").length >= IDENTITY_TAIL;
}
export function identityMatches(typed: unknown, storedDocument: string | null | undefined): boolean {
  if (!identityRequired(storedDocument)) return true;
  const typedTail = alnum(typeof typed === "string" ? typed : "").slice(-IDENTITY_TAIL);
  return typedTail.length === IDENTITY_TAIL && typedTail === alnum(storedDocument!).slice(-IDENTITY_TAIL);
}

/** Nombre abreviado para la página pública del enlace: nombre de pila e inicial del apellido. */
export function shortPatientName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/** Mensaje para enviar el enlace al paciente por WhatsApp o correo. */
export function signMessage(patientName: string, clinic: string, url: string): string {
  const first = patientName.trim().split(/\s+/)[0] ?? "";
  return `Hola${first ? ` ${first}` : ""}, te enviamos${clinic ? ` desde ${clinic}` : ""} el consentimiento informado para que lo leas y firmes en tu teléfono. El enlace es personal y vence en ${SIGN_LINK_HOURS} horas: ${url}`;
}

/** Enlace de WhatsApp con el mensaje listo (número chileno de 9 dígitos o con código de país). Null si no hay un número usable. */
export function whatsappSignLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 9 ? `56${digits}` : digits.length === 11 && digits.startsWith("56") ? digits : digits.length >= 10 && digits.length <= 15 ? digits : "";
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
}

/** Lo que ve el clínico (nunca el secreto del enlace ni la IP). */
export type SignatureView = {
  status: "pendiente" | "firmado";
  signerName: string; signerRole: string; signerRelation: string;
  image: string; signedAt: string; method: string; signatureHash: string;
  tokenExpiresAt: string; linkActive: boolean;
};
