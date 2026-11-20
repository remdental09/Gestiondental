// Habilitación del profesional para emitir recetas: sube su Certificado de inscripción del Registro Nacional de Prestadores Individuales (PDF de la Superintendencia de Salud).
// El PDF original se GUARDA de forma segura en R2 (prestador/<id del profesional>/), se puede ver, descargar y reemplazar.
// Se leen del texto el N° de registro, la profesión y el código de validación; el QR del certificado (leído en el teléfono) se guarda y se imprime en recetas y certificados.
// El desarrollador aprueba tras comparar los datos con el registro oficial.
import { env } from "cloudflare:workers";
import { extractText, getDocumentProxy } from "unpdf";
import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { loadProfile } from "@/app/clinician-profile-db";
import { loadRegistration, saveRegistration, type StoredFile, type StoredQr } from "@/app/prestador-db";
import { registrationView } from "@/app/prestador-view";
import { parsePrestadorCertificate, sameRun } from "@/lib/prestador-certificate";
import { QR_IMAGE_MAX_BYTES, certificateKey, cleanQrPayload, ownsKey } from "@/lib/prestador-qr";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const MAX_BYTES = 1_500_000;
const MAX_TEXT = 30_000;
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
type Bucket = { put(key: string, value: ArrayBuffer | Uint8Array, options?: unknown): Promise<unknown>; delete(key: string): Promise<void> };
const bucket = () => (env as unknown as { BUCKET?: Bucket }).BUCKET;

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  try { return json({ registration: registrationView(await loadRegistration(personalIdOf(user))) }); } catch { return json({ error: "No se pudo leer tu habilitación." }, 500); }
}

const isPng = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return json({ error: "Inicia sesión." }, 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Origen no permitido." }, 403);
  const personalId = personalIdOf(user);
  let text = "";
  let bytes: Uint8Array;
  let pdf: { bytes: Uint8Array; name: string } | null = null;
  let qrImage: Uint8Array | null = null;
  let qrPayload = "";
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    // Respaldo: texto pegado desde el visor del celular (Seleccionar todo → Copiar → Pegar). Conserva el PDF ya guardado, si hay.
    const body = await request.json().catch(() => null) as { texto?: unknown } | null;
    text = typeof body?.texto === "string" ? body.texto : "";
    if (text.length < 200 || text.length > MAX_TEXT) return json({ error: "Pega el texto completo del certificado (Seleccionar todo en el PDF, Copiar y Pegar)." }, 400);
    bytes = new TextEncoder().encode(text);
  } else {
    const form = await request.formData().catch(() => null);
    const file = form?.get("certificado");
    if (!(file instanceof File)) return json({ error: "Elige el PDF del certificado o pega su texto." }, 400);
    if (file.size < 1000 || file.size > MAX_BYTES) return json({ error: "El PDF debe pesar menos de 1,5 MB. Usa el original descargado de la Superintendencia." }, 400);
    bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return json({ error: "El archivo no es un PDF." }, 400);
    try { text = (await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text; } catch { return json({ error: "No se pudo leer el PDF. Descarga de nuevo el original, sin escanearlo." }, 400); }
    pdf = { bytes, name: (file.name || "certificado.pdf").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 120) || "certificado.pdf" };
    // QR leído en el teléfono desde la página del PDF (opcional: si no se pudo leer, se usa el validador con el código).
    qrPayload = cleanQrPayload(form?.get("qrPayload"));
    const image = form?.get("qrImage");
    if (qrPayload && image instanceof File && image.size > 0 && image.size <= QR_IMAGE_MAX_BYTES) {
      const imageBytes = new Uint8Array(await image.arrayBuffer());
      if (isPng(imageBytes)) qrImage = imageBytes;
    }
  }
  const profile = await loadProfile(personalId).catch(() => null);
  if (!profile) return json({ error: "Primero completa tu registro profesional (nombre, RUT y especialidad)." }, 409);
  const parsed = parsePrestadorCertificate(text);
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  if (!sameRun(parsed.data.run, profile.rut)) return json({ error: "El RUN del certificado no coincide con el RUT de tu registro en la aplicación." }, 422);
  const previous = await loadRegistration(personalId).catch(() => null);
  const written: string[] = [];
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    const fileHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    let stored: StoredFile | null = null, qr: StoredQr | null = null;
    if (pdf) {
      const store = bucket();
      if (!store) return json({ error: "El almacenamiento de archivos no está disponible. Intenta más tarde." }, 503);
      const id = crypto.randomUUID();
      const key = certificateKey(personalId, id, "pdf");
      await store.put(key, pdf.bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sha256: fileHash } });
      written.push(key);
      stored = { key, name: pdf.name, size: pdf.bytes.length };
      if (qrPayload) {
        let qrKey = "";
        if (qrImage) { qrKey = certificateKey(personalId, id, "qr"); await store.put(qrKey, qrImage, { httpMetadata: { contentType: "image/png" } }); written.push(qrKey); }
        qr = { key: qrKey, payload: qrPayload, source: "pdf" };
      }
    }
    const row = await saveRegistration(personalId, user.email ?? "", parsed.data, fileHash, stored, qr);
    // El certificado anterior se reemplaza: se borran sus objetos (solo los de este profesional).
    if (stored && previous) for (const old of [previous.cert_key, previous.qr_key]) if (old && ownsKey(personalId, old) && !written.includes(old)) await bucket()?.delete(old).catch(() => undefined);
    return json({ registration: registrationView(row) }, 201);
  } catch {
    for (const key of written) await bucket()?.delete(key).catch(() => undefined);
    return json({ error: "No se pudo guardar tu habilitación." }, 500);
  }
}
