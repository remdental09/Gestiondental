import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { confirmDriveSnapshot, getDriveSnapshot, listDriveBackupQueue } from "@/app/drive-backup";
import { saveSender, type MailSender } from "@/app/appointment-mail-db";

type DriveStatement = {
  bind(...values: unknown[]): DriveStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};
type DriveDatabase = { prepare(sql: string): DriveStatement };
type DriveEnvironment = {
  DB?: DriveDatabase;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
};
type DriveConnection = {
  owner_id: string;
  google_sub: string;
  google_email: string;
  refresh_token_ciphertext: string;
  root_folder_id: string | null;
  connected_at: string;
  updated_at: string;
};
type GoogleFile = { id: string; name?: string; mimeType?: string; parents?: string[] };
type GoogleTokens = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
type GoogleDocument = { documentId?: string; body?: { content?: Array<{ endIndex?: number; paragraph?: { elements?: Array<{ textRun?: { content?: string } }> }; table?: { tableRows?: Array<{ tableCells?: Array<{ content?: Array<unknown> }> }> } }> } };

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_FOLDER = "application/vnd.google-apps.folder";
const encoder = new TextEncoder();
const now = () => new Date().toISOString();
const getEnvironment = () => env as unknown as DriveEnvironment;

function database(): DriveDatabase {
  const db = getEnvironment().DB;
  if (!db) throw new Error("La base de datos de la aplicación no está disponible.");
  return db;
}

function configuration() {
  const values = getEnvironment();
  const clientId = values.GOOGLE_DRIVE_CLIENT_ID?.trim() || "";
  const clientSecret = values.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || "";
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

async function ensureConnectionTable() {
  await database().prepare(
    "CREATE TABLE IF NOT EXISTS google_drive_connections (" +
    "owner_id TEXT PRIMARY KEY, google_sub TEXT NOT NULL, google_email TEXT NOT NULL, " +
    "refresh_token_ciphertext TEXT NOT NULL, root_folder_id TEXT, connected_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();
}

async function connectionFor(ownerId: string): Promise<DriveConnection | null> {
  await ensureConnectionTable();
  return database().prepare(
    "SELECT owner_id, google_sub, google_email, refresh_token_ciphertext, root_folder_id, connected_at, updated_at " +
    "FROM google_drive_connections WHERE owner_id = ?"
  ).bind(ownerId).first<DriveConnection>();
}

export async function googleDriveStatus(user: ChatGPTUser) {
  const config = configuration();
  if (!config.configured) return { configured: false, connected: false, email: null as string | null };
  const connection = await connectionFor(user.userId);
  return {
    configured: true,
    connected: Boolean(connection),
    email: connection?.google_email ?? null,
    connectedAt: connection?.connected_at ?? null,
    lastRun: connection ? await lastBackupRun(user.userId) : null,
    lastCheck: connection ? await lastHeartbeat(user.userId) : null,
    mirrors: await mirrorStatus(user.userId),
  };
}

function randomToken(byteCount: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function safeReturnPath(request: Request) {
  const origin = new URL(request.url).origin;
  const referer = request.headers.get("referer");
  if (!referer) return "/";
  try {
    const url = new URL(referer);
    if (url.origin !== origin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

function redirectWithDriveStatus(request: Request, returnTo: string, status: string, clearCookies = false) {
  const origin = new URL(request.url).origin;
  let destination: URL;
  try {
    destination = new URL(returnTo, origin);
    if (destination.origin !== origin) destination = new URL("/", origin);
  } catch {
    destination = new URL("/", origin);
  }
  destination.searchParams.set("drive", status);
  const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
  if (clearCookies) {
    headers.append("Set-Cookie", "__Host-gd-drive-state=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    headers.append("Set-Cookie", "__Host-gd-drive-verifier=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    headers.append("Set-Cookie", "__Host-gd-drive-mode=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  }
  return new Response(null, { status: 302, headers });
}

export async function beginGoogleDriveConnect(request: Request, user: ChatGPTUser) {
  const config = configuration();
  const returnTo = safeReturnPath(request);
  if (!config.configured) return redirectWithDriveStatus(request, returnTo, "not-configured");

  const state = randomToken(24);
  const ownerTag = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(user.userId))));
  const stateValue = state + "." + base64Url(encoder.encode(returnTo)) + "." + ownerTag;
  const verifier = randomToken(48);
  const redirectUri = new URL("/api/drive/callback", request.url).toString();
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", config.clientId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("response_type", "code");
  const calendarMode = new URL(request.url).searchParams.get("calendar") === "1";
  // ?mail=1: cuenta de Google desde la que se enviarán las confirmaciones de cita (solo permiso de enviar correo).
  const mailMode = !calendarMode && new URL(request.url).searchParams.get("mail") === "1";
  // ?withCalendar=1 (registro): un solo consentimiento para Drive y Calendar.
  const withCalendar = !calendarMode && new URL(request.url).searchParams.get("withCalendar") === "1";
  authorization.searchParams.set("scope", mailMode ? "openid email " + GMAIL_SEND_SCOPE : calendarMode ? "openid email " + CALENDAR_SCOPE + " " + CALENDAR_WRITE_SCOPE : "openid email https://www.googleapis.com/auth/drive.file" + (withCalendar ? " " + CALENDAR_SCOPE : ""));
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("include_granted_scopes", "true");
  // ?auto=1 (registro): Google parte con la misma cuenta con que se entró y no muestra el selector de cuentas.
  const auto = new URL(request.url).searchParams.get("auto") === "1" && new URL(request.url).searchParams.get("mirror") !== "1";
  if (auto && user.email) authorization.searchParams.set("login_hint", user.email);
  authorization.searchParams.set("prompt", auto && user.email ? "consent" : "consent select_account");
  authorization.searchParams.set("state", stateValue);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers({ Location: authorization.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", "__Host-gd-drive-state=" + stateValue + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600");
  headers.append("Set-Cookie", "__Host-gd-drive-verifier=" + verifier + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600");
  // ?mirror=1 conecta una segunda cuenta de Google Drive como copia adicional, sin reemplazar la principal.
  // ?calendar=1 conecta el Google Calendar de cualquier cuenta (solo lectura), sin tocar Drive.
  headers.append("Set-Cookie", "__Host-gd-drive-mode=" + (mailMode ? "mail" : calendarMode ? "calendar" : new URL(request.url).searchParams.get("mirror") === "1" ? "mirror" : withCalendar ? "primary-calendar" : "primary") + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600");
  return new Response(null, { status: 302, headers });
}

async function deriveTokenKey(ownerId: string, clientSecret: string) {
  const source = await crypto.subtle.importKey("raw", encoder.encode(clientSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("gestion-dental-google-drive-v1"), info: encoder.encode(ownerId) },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptRefreshToken(ownerId: string, token: string, clientSecret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveTokenKey(ownerId, clientSecret);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(token)));
  const combined = new Uint8Array(nonce.length + cipher.length);
  combined.set(nonce);
  combined.set(cipher, nonce.length);
  return base64Url(combined);
}

async function decryptRefreshToken(ownerId: string, value: string, clientSecret: string) {
  const combined = fromBase64Url(value);
  if (combined.length < 29) throw new Error("La conexión de Google Drive necesita renovarse.");
  const nonce = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const key = await deriveTokenKey(ownerId, clientSecret);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher);
  return new TextDecoder().decode(plain);
}

export async function finishGoogleDriveConnect(request: Request, user: ChatGPTUser) {
  const config = configuration();
  const url = new URL(request.url);
  const stateCookie = cookieValue(request, "__Host-gd-drive-state");
  const verifier = cookieValue(request, "__Host-gd-drive-verifier");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const returnedError = url.searchParams.get("error");
  const origin = url.origin;

  if (returnedError) return redirectWithDriveStatus(request, "/", "denied", true);
  if (!config.configured) return redirectWithDriveStatus(request, "/", "not-configured", true);
  if (!code || !state || !verifier || state !== stateCookie) return redirectWithDriveStatus(request, "/", "error", true);

  const stateParts = state.split(".");
  if (stateParts.length !== 3) return redirectWithDriveStatus(request, "/", "error", true);
  const ownerTag = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(user.userId))));
  if (ownerTag !== stateParts[2]) return redirectWithDriveStatus(request, "/", "error", true);
  let returnTo = "/";
  try {
    returnTo = new TextDecoder().decode(fromBase64Url(stateParts[1]));
  } catch {
    return redirectWithDriveStatus(request, "/", "error", true);
  }
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) returnTo = "/";

  try {
    const redirectUri = new URL("/api/drive/callback", origin).toString();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!tokenResponse.ok) throw new Error("Google no pudo completar la autorización.");
    const tokens = await tokenResponse.json() as GoogleTokens;
    if (!tokens.access_token || !tokens.refresh_token) throw new Error("Google no entregó autorización permanente para Drive.");
    if (cookieValue(request, "__Host-gd-drive-mode") === "mail") {
      if (!(tokens.scope || "").split(/\s+/).includes(GMAIL_SEND_SCOPE)) return redirectWithDriveStatus(request, returnTo, "mail-scope-missing", true);
      const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + tokens.access_token } });
      const person = who.ok ? await who.json() as { sub?: string; email?: string } : {};
      if (!person.sub || !person.email) throw new Error("No se pudo confirmar la cuenta de Google.");
      await saveSender(user.userId, person.sub, person.email, await encryptRefreshToken(user.userId, tokens.refresh_token, config.clientSecret), new URL(request.url).origin);
      return redirectWithDriveStatus(request, returnTo, "mail-connected", true);
    }
    if (cookieValue(request, "__Host-gd-drive-mode") === "calendar") {
      if (!(tokens.scope || "").split(/\s+/).includes(CALENDAR_SCOPE)) return redirectWithDriveStatus(request, returnTo, "calendar-scope-missing", true);
      const who = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + tokens.access_token } });
      const person = who.ok ? await who.json() as { sub?: string; email?: string } : {};
      if (!person.sub || !person.email) throw new Error("No se pudo confirmar la cuenta de Google.");
      await saveCalendarConnection(user.userId, person.sub, person.email, tokens.refresh_token, config.clientSecret, (tokens.scope || "").split(/\s+/).includes(CALENDAR_WRITE_SCOPE));
      return redirectWithDriveStatus(request, returnTo, "calendar-connected", true);
    }
    // Google permite desmarcar el permiso de Drive en la pantalla de consentimiento: sin él, todo respaldo falla con 403.
    if (!(tokens.scope || "").split(/\s+/).includes("https://www.googleapis.com/auth/drive.file")) {
      return redirectWithDriveStatus(request, returnTo, "scope-missing", true);
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    if (!profileResponse.ok) throw new Error("No se pudo confirmar la cuenta de Google.");
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!profile.sub || !profile.email || profile.email_verified === false) throw new Error("No se pudo verificar el correo de Google.");

    if (cookieValue(request, "__Host-gd-drive-mode") === "mirror") {
      const primary = await connectionFor(user.userId);
      if (primary && primary.google_sub === profile.sub) return redirectWithDriveStatus(request, returnTo, "mirror-same", true);
      await ensureMirrorTables();
      const stamp = now();
      await database().prepare(
        "INSERT INTO google_drive_mirrors (owner_id, google_sub, google_email, refresh_token_ciphertext, root_folder_id, connected_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?) " +
        "ON CONFLICT(owner_id, google_sub) DO UPDATE SET google_email = excluded.google_email, refresh_token_ciphertext = excluded.refresh_token_ciphertext, updated_at = excluded.updated_at"
      ).bind(user.userId, profile.sub, profile.email, await encryptRefreshToken(user.userId, tokens.refresh_token, config.clientSecret), stamp, stamp).run();
      return redirectWithDriveStatus(request, returnTo, "mirror-connected", true);
    }

    const db = database();
    await ensureConnectionTable();
    const previous = await connectionFor(user.userId);
    const encrypted = await encryptRefreshToken(user.userId, tokens.refresh_token, config.clientSecret);
    const timestamp = now();
    await db.prepare(
      "INSERT INTO google_drive_connections (owner_id, google_sub, google_email, refresh_token_ciphertext, root_folder_id, connected_at, updated_at) " +
      "VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET " +
      "google_sub = excluded.google_sub, google_email = excluded.google_email, refresh_token_ciphertext = excluded.refresh_token_ciphertext, " +
      "root_folder_id = CASE WHEN google_drive_connections.google_sub = excluded.google_sub THEN google_drive_connections.root_folder_id ELSE NULL END, " +
      "connected_at = excluded.connected_at, updated_at = excluded.updated_at"
    ).bind(user.userId, profile.sub, profile.email, encrypted, timestamp, timestamp).run();

    if (!previous || previous.google_sub !== profile.sub) {
      await db.prepare("UPDATE drive_backups SET snapshot_digest = '' WHERE owner_id = ?").bind(user.userId).run();
    }
    // Registro con «Ver mis citas de Google Calendar»: el mismo permiso sirve para la agenda.
    if (cookieValue(request, "__Host-gd-drive-mode") === "primary-calendar" && (tokens.scope || "").split(/\s+/).includes(CALENDAR_SCOPE)) {
      await saveCalendarConnection(user.userId, profile.sub, profile.email, tokens.refresh_token, config.clientSecret).catch(() => undefined);
    }
    return redirectWithDriveStatus(request, returnTo, "connected", true);
  } catch {
    return redirectWithDriveStatus(request, returnTo, "error", true);
  }
}

/** Estado HTTP y motivo que informa Google (por ejemplo «403 accessNotConfigured»); nunca incluye datos clínicos. */
async function googleErrorReason(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = await response.json() as { error?: string | { status?: string; errors?: Array<{ reason?: string }>; message?: string }; error_description?: string };
    if (typeof body.error === "string") detail = body.error;
    else if (body.error) detail = body.error.errors?.[0]?.reason || body.error.status || "";
  } catch { /* cuerpo no JSON */ }
  return ("HTTP " + response.status + (detail ? " " + detail : "")).replace(/[^\w .:-]/g, "").slice(0, 80);
}

async function ensureRunLogTable() {
  await database().prepare(
    "CREATE TABLE IF NOT EXISTS backup_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, source TEXT NOT NULL, ran_at TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT NOT NULL)"
  ).run();
}

/** Registra el resultado de un respaldo (manual o automático) para poder ver por qué falla. Solo guarda mensajes de error, sin datos de pacientes. */
async function recordBackupRun(ownerId: string, source: "manual" | "cron" | "guardado", ok: boolean, detail: string) {
  try {
    await ensureRunLogTable();
    await database().prepare("INSERT INTO backup_runs (owner_id, source, ran_at, ok, detail) VALUES (?,?,?,?,?)").bind(ownerId, source, now(), ok ? 1 : 0, detail.slice(0, 300)).run();
    await database().prepare("DELETE FROM backup_runs WHERE owner_id = ? AND id NOT IN (SELECT id FROM backup_runs WHERE owner_id = ? ORDER BY id DESC LIMIT 60)").bind(ownerId, ownerId).run();
  } catch { /* el registro nunca debe impedir el respaldo */ }
}

async function lastBackupRun(ownerId: string) {
  try {
    await ensureRunLogTable();
    return await database().prepare("SELECT source, ran_at AS ranAt, ok, detail FROM backup_runs WHERE owner_id = ? ORDER BY id DESC LIMIT 1").bind(ownerId).first<{ source: string; ranAt: string; ok: number; detail: string }>();
  } catch { return null; }
}

async function getAccessToken(user: ChatGPTUser, connection: DriveConnection, clientSecret: string) {
  const refreshToken = await decryptRefreshToken(user.userId, connection.refresh_token_ciphertext, clientSecret);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration().clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    const reason = await googleErrorReason(response);
    throw new Error("La autorización de Google Drive venció o fue rechazada (" + reason + "). Vuelve a conectarla.");
  }
  const tokens = await response.json() as GoogleTokens;
  if (!tokens.access_token) throw new Error("Google no entregó un token de acceso.");
  return tokens.access_token;
}

async function googleApi<T>(accessToken: string, url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", "Bearer " + accessToken);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const reason = await googleErrorReason(response);
    const service = new URL(url).hostname.startsWith("docs") ? "Docs" : "Drive";
    throw new Error("Google " + service + " rechazó una operación de respaldo (" + reason + ")." + (reason.includes("insufficientPermissions") ? " Falta el permiso de Drive: vuelve a conectar Google Drive y deja marcada la casilla de Drive." : ""));
  }
  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

async function getGoogleFile(accessToken: string, fileId: string) {
  const query = new URLSearchParams({ fields: "id,name,mimeType,parents" });
  return googleApi<GoogleFile>(
    accessToken,
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?" + query.toString(),
  );
}

async function createGoogleFolder(accessToken: string, name: string, parentId?: string | null) {
  const body: { name: string; mimeType: string; parents?: string[] } = { name, mimeType: GOOGLE_FOLDER };
  if (parentId) body.parents = [parentId];
  return googleApi<GoogleFile>(
    accessToken,
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType",
    { method: "POST", body: JSON.stringify(body) },
  );
}

async function ensureRootFolder(connection: DriveConnection, accessToken: string, ownerId: string) {
  if (connection.root_folder_id) {
    try {
      const existing = await getGoogleFile(accessToken, connection.root_folder_id);
      if (existing.mimeType === GOOGLE_FOLDER) return existing.id;
    } catch {
      // Si se revocó la carpeta antigua, se crea una nueva dentro del Drive autorizado.
    }
  }
  const created = await createGoogleFolder(accessToken, "Pacientes");
  if (!created.id) throw new Error("No se pudo crear la carpeta de respaldos.");
  await database().prepare(
    "UPDATE google_drive_connections SET root_folder_id = ?, updated_at = ? WHERE owner_id = ?"
  ).bind(created.id, now(), ownerId).run();
  return created.id;
}

async function ensurePatientFolder(
  accessToken: string,
  rootFolderId: string,
  patientId: number,
  patientName: string,
  existingFolderId: string | null,
) {
  if (existingFolderId) {
    try {
      const existing = await getGoogleFile(accessToken, existingFolderId);
      if (existing.mimeType === GOOGLE_FOLDER) return { id: existing.id, replaced: false };
    } catch {
      // El ID antiguo puede pertenecer a otra cuenta de Google; se crea una carpeta en la cuenta actual.
    }
  }
  const created = await createGoogleFolder(
    accessToken,
    patientName + " - ficha " + patientId,
    rootFolderId,
  );
  if (!created.id) throw new Error("No se pudo crear la carpeta del paciente.");
  return { id: created.id, replaced: Boolean(existingFolderId) };
}

function textInDocument(document: GoogleDocument): string {
  const output: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const textRun = record.textRun;
    if (textRun && typeof textRun === "object") {
      const content = (textRun as { content?: unknown }).content;
      if (typeof content === "string") output.push(content);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== "textRun") visit(child);
    }
  };
  visit(document.body?.content || []);
  return output.join("");
}

async function createGoogleDocument(accessToken: string, title: string, folderId: string) {
  return googleApi<GoogleFile>(
    accessToken,
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType",
    { method: "POST", body: JSON.stringify({ name: title, mimeType: GOOGLE_DOC, parents: [folderId] }) },
  );
}

async function replaceDocumentText(accessToken: string, documentId: string, text: string) {
  const documentUrl = "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(documentId);
  const current = await googleApi<GoogleDocument>(accessToken, documentUrl);
  const content = current.body?.content || [];
  const endIndex = content.reduce((maximum, item) => Math.max(maximum, item.endIndex || 0), 1);
  const requests: Array<Record<string, unknown>> = [];
  if (endIndex > 2) {
    requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
  }
  requests.push({ insertText: { location: { index: 1 }, text } });
  await googleApi(accessToken, documentUrl + ":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
  const verified = await googleApi<GoogleDocument>(accessToken, documentUrl);
  if (!textInDocument(verified).includes(text)) throw new Error("No se pudo verificar el contenido guardado en Drive.");
}


// ---------------------------------------------------------------------------
// Copia en Markdown (.md) de cada ficha, junto al documento de Google Docs.
async function ensureMarkdownTable() {
  await database().prepare("CREATE TABLE IF NOT EXISTS drive_md_files (owner_id TEXT NOT NULL, account TEXT NOT NULL, patient_id INTEGER NOT NULL, file_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, account, patient_id))").run();
}

/** Crea o actualiza `ficha.md` en la carpeta del paciente. `account` = "principal" o la cuenta adicional. Una sola llamada a Google por ficha. */
async function writeMarkdownFile(accessToken: string, ownerId: string, account: string, patientId: number, folderId: string, fileName: string, markdown: string) {
  await ensureMarkdownTable();
  const row = await database().prepare("SELECT file_id FROM drive_md_files WHERE owner_id = ? AND account = ? AND patient_id = ?").bind(ownerId, account, patientId).first<{ file_id: string }>();
  let fileId = row?.file_id ?? null;
  if (fileId) {
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(fileId) + "?uploadType=media&fields=id", {
      method: "PATCH", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "text/markdown; charset=UTF-8" }, body: markdown,
    });
    if (response.status === 404) fileId = null; // borrado en Drive: se vuelve a crear
    else if (!response.ok) throw new Error("Google Drive rechazó la copia .md (" + await googleErrorReason(response) + ").");
  }
  if (!fileId) {
    const boundary = "gd" + randomToken(12);
    const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name: fileName, mimeType: "text/markdown", parents: [folderId] }) +
      "\r\n--" + boundary + "\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n" + markdown + "\r\n--" + boundary + "--";
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "multipart/related; boundary=" + boundary }, body,
    });
    if (!response.ok) throw new Error("Google Drive rechazó la copia .md (" + await googleErrorReason(response) + ").");
    fileId = (await response.json() as { id?: string }).id ?? null;
    if (!fileId) throw new Error("Google Drive no devolvió la copia .md.");
  }
  await database().prepare("INSERT INTO drive_md_files (owner_id, account, patient_id, file_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, account, patient_id) DO UPDATE SET file_id = excluded.file_id, updated_at = excluded.updated_at")
    .bind(ownerId, account, patientId, fileId, now()).run();
  return fileId;
}

const markdownName = (patientId: number, name: string) => `Ficha ${patientId} - ${name.replace(/[\\/:*?"<>|]/g, " ").trim()}.md`;

async function backupPatient(user: ChatGPTUser, patientId: number, tokenCache?: Map<string, string>) {
  const config = configuration();
  if (!config.configured) return { saved: false, configured: false, connected: false, message: "Google Drive requiere configuración." };
  const connection = await connectionFor(user.userId);
  if (!connection) return { saved: false, configured: true, connected: false, message: "Conecta un Google Drive para activar el respaldo." };

  const snapshot = await getDriveSnapshot(user.userId, patientId, connection.connected_at);
  if (!snapshot) return { saved: false, configured: true, connected: true, message: "No se encontró la ficha de este usuario." };
  if (!snapshot.pending) return { saved: true, skipped: true, patientId };

  const accessToken = tokenCache?.get(user.userId) || await getAccessToken(user, connection, config.clientSecret);
  tokenCache?.set(user.userId, accessToken);
  const rootFolderId = await ensureRootFolder(connection, accessToken, user.userId);
  const patientFolder = await ensurePatientFolder(
    accessToken, rootFolderId, patientId, snapshot.name, snapshot.driveFolderId,
  );

  let documentId: string | null = snapshot.previousDocumentId;
  let replacedDocument = false;
  if (documentId) {
    try {
      const existing = await getGoogleFile(accessToken, documentId);
      if (existing.mimeType !== GOOGLE_DOC) throw new Error("El respaldo anterior ya no está disponible.");
    } catch {
      documentId = null;
      replacedDocument = true;
    }
  }
  if (!documentId) {
    const created = await createGoogleDocument(accessToken, snapshot.documentTitle, patientFolder.id);
    if (!created.id) throw new Error("No se pudo crear el documento de respaldo.");
    documentId = created.id;
  }

  await replaceDocumentText(accessToken, documentId, snapshot.documentText);
  await writeMarkdownFile(accessToken, user.userId, "principal", patientId, patientFolder.id, markdownName(patientId, snapshot.name), snapshot.markdown);
  const confirmed = await confirmDriveSnapshot(
    user.userId,
    patientId,
    documentId,
    snapshot.digest,
    patientFolder.id,
    replacedDocument || patientFolder.replaced || Boolean(snapshot.verifiedAt && snapshot.verifiedAt < connection.connected_at),
    connection.connected_at,
  );
  if (!confirmed.saved) throw new Error(confirmed.message || confirmed.error || "No se pudo confirmar el respaldo.");
  return {
    saved: true,
    patientId,
    documentId,
    folderId: patientFolder.id,
    verifiedAt: confirmed.verifiedAt,
    attachmentCount: confirmed.attachmentCount,
  };
}

export async function syncGoogleDrive(user: ChatGPTUser, body: unknown) {
  const config = configuration();
  if (!config.configured) return { configured: false, connected: false, results: [] as Array<Record<string, unknown>> };
  const connection = await connectionFor(user.userId);
  if (!connection) return { configured: true, connected: false, results: [] as Array<Record<string, unknown>> };

  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const patientId = Number(input.patientId);
  if (Number.isSafeInteger(patientId) && patientId > 0) {
    try {
      const single = await backupPatient(user, patientId);
      await recordBackupRun(user.userId, "guardado", Boolean(single.saved), single.saved ? "ficha " + patientId + " respaldada" : String((single as { message?: string }).message || "no se respaldó"));
      const extra = await syncDriveMirrors(user, "guardado", 1, patientId).catch(() => ({ results: [] as Array<Record<string, unknown>> }));
      return { configured: true, connected: true, results: [single, ...extra.results], complete: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      await recordBackupRun(user.userId, "guardado", false, "ficha " + patientId + ": " + message);
      return { configured: true, connected: true, results: [{ saved: false, patientId, message }], complete: true };
    }
  }

  const afterPatientId = Number.isSafeInteger(Number(input.afterPatientId)) && Number(input.afterPatientId) >= 0
    ? Number(input.afterPatientId)
    : 0;
  const queue = await listDriveBackupQueue(user.userId, afterPatientId, 3, connection.connected_at);
  const results: Array<Record<string, unknown>> = [];
  for (const item of queue.pending) {
    try {
      results.push(await backupPatient(user, item.patientId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo respaldar esta ficha; se puede reintentar.";
      results.push({ saved: false, patientId: item.patientId, message });
      await recordBackupRun(user.userId, "manual", false, "ficha " + item.patientId + ": " + message);
    }
  }
  if (results.length && results.every(item => item.saved)) await recordBackupRun(user.userId, "manual", true, results.length + " fichas respaldadas");
  // Cuando la cuenta principal terminó, se copian las cuentas adicionales de a 3 fichas por página.
  if (queue.nextAfterPatientId === null) {
    const extra = await syncDriveMirrors(user, "manual", 3);
    results.push(...extra.results);
    if (extra.budget <= 0) return { configured: true, connected: true, results, nextAfterPatientId: 0, complete: false };
  }
  return {
    configured: true,
    connected: true,
    results,
    nextAfterPatientId: queue.nextAfterPatientId,
    complete: queue.nextAfterPatientId === null,
  };
}

/**
 * Nightly Cron Trigger backup for every owner that connected Google Drive in the app.
 * Each ficha costs ~6 Google subrequests, so a run handles at most `maxPatients`
 * (Workers Free allows 50 subrequests per invocation); the cron repeats every 10 minutes.
 */
// Cada ficha usa ~7 llamadas a Google (documento + copia .md): 5 por corrida respetan el límite de 50 del plan gratuito.
export async function runScheduledDriveBackup(maxPatients = 5) {
  const config = configuration();
  if (!config.configured) return { configured: false, results: [] as Array<Record<string, unknown>> };
  await ensureConnectionTable();
  const { results: connections } = await database().prepare(
    "SELECT owner_id, google_email, connected_at FROM google_drive_connections ORDER BY owner_id"
  ).all<{ owner_id: string; google_email: string; connected_at: string }>();
  const tokens = new Map<string, string>();
  const results: Array<Record<string, unknown>> = [];
  let budget = maxPatients;
  for (const connection of connections) {
    const user: ChatGPTUser = { userId: connection.owner_id, displayName: "", email: connection.google_email, fullName: null };
    let after = 0;
    let ownerFailed = false;
    while (budget > 0 && !ownerFailed) {
      const queue = await listDriveBackupQueue(user.userId, after, 20, connection.connected_at);
      for (const item of queue.pending) {
        if (budget <= 0) break;
        budget--;
        try {
          const result = await backupPatient(user, item.patientId, tokens);
          results.push({ ownerId: user.userId, patientId: item.patientId, saved: Boolean(result.saved) });
          await recordBackupRun(user.userId, "cron", Boolean(result.saved), "ficha " + item.patientId + (result.saved ? " respaldada" : ": " + String((result as { message?: string }).message || "no se respaldó")));
        } catch (error) {
          const message = error instanceof Error ? error.message : "error";
          results.push({ ownerId: user.userId, patientId: item.patientId, saved: false, error: message });
          await recordBackupRun(user.userId, "cron", false, "ficha " + item.patientId + ": " + message);
          if (!tokens.has(user.userId)) { ownerFailed = true; break; } // token refresh failed: skip owner
        }
      }
      if (queue.nextAfterPatientId === null) break;
      after = queue.nextAfterPatientId;
    }
  }
  for (const connection of connections) {
    if (budget <= 0) break;
    const user: ChatGPTUser = { userId: connection.owner_id, displayName: "", email: connection.google_email, fullName: null };
    try {
      const extra = await syncDriveMirrors(user, "cron", budget);
      results.push(...extra.results.map(item => ({ ownerId: connection.owner_id, ...item })));
      budget = extra.budget;
    } catch (error) {
      results.push({ ownerId: connection.owner_id, saved: false, error: error instanceof Error ? error.message : "error en copia adicional" });
    }
  }
  // Constancia de cada revisión automática, aunque no haya nada que copiar: así se ve que la tarea corre.
  for (const connection of connections) {
    const own = results.filter(item => item.ownerId === connection.owner_id);
    const saved = own.filter(item => item.saved).length, failed = own.length - saved;
    await recordHeartbeat(connection.owner_id, own.length ? `${saved} copiada${saved === 1 ? "" : "s"}${failed ? `, ${failed} con error` : ""}${budget <= 0 ? ", continúa en la próxima revisión" : ""}` : "sin cambios pendientes");
  }
  return { configured: true, owners: connections.length, results, budgetLeft: budget };
}

async function ensureHeartbeatTable() {
  await database().prepare("CREATE TABLE IF NOT EXISTS backup_heartbeat (owner_id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, detail TEXT NOT NULL)").run();
}
async function recordHeartbeat(ownerId: string, detail: string) {
  try {
    await ensureHeartbeatTable();
    await database().prepare("INSERT INTO backup_heartbeat (owner_id, ran_at, detail) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET ran_at = excluded.ran_at, detail = excluded.detail").bind(ownerId, now(), detail.slice(0, 200)).run();
  } catch { /* la constancia nunca debe impedir el respaldo */ }
}
async function lastHeartbeat(ownerId: string) {
  try {
    await ensureHeartbeatTable();
    return await database().prepare("SELECT ran_at AS ranAt, detail FROM backup_heartbeat WHERE owner_id = ?").bind(ownerId).first<{ ranAt: string; detail: string }>();
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Copias adicionales: una o más cuentas de Google Drive que reciben la misma ficha.
// La cuenta principal no cambia; cada copia lleva su propia carpeta «Pacientes» y su propio control de versión.

type MirrorConnection = DriveConnection;
type MirrorBackup = { patient_id: number; document_id: string; folder_id: string | null; snapshot_digest: string; verified_at: string };

async function ensureMirrorTables() {
  await database().prepare(
    "CREATE TABLE IF NOT EXISTS google_drive_mirrors (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, google_email TEXT NOT NULL, " +
    "refresh_token_ciphertext TEXT NOT NULL, root_folder_id TEXT, connected_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, google_sub))"
  ).run();
  await database().prepare(
    "CREATE TABLE IF NOT EXISTS drive_mirror_backups (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, patient_id INTEGER NOT NULL, " +
    "document_id TEXT NOT NULL, folder_id TEXT, snapshot_digest TEXT NOT NULL, verified_at TEXT NOT NULL, PRIMARY KEY (owner_id, google_sub, patient_id))"
  ).run();
}

async function mirrorsFor(ownerId: string): Promise<MirrorConnection[]> {
  await ensureMirrorTables();
  const { results } = await database().prepare(
    "SELECT owner_id, google_sub, google_email, refresh_token_ciphertext, root_folder_id, connected_at, updated_at FROM google_drive_mirrors WHERE owner_id = ? ORDER BY connected_at"
  ).bind(ownerId).all<MirrorConnection>();
  return results;
}

async function mirrorStatus(ownerId: string) {
  try {
    const mirrors = await mirrorsFor(ownerId);
    const total = await database().prepare("SELECT COUNT(*) AS n FROM patients WHERE owner_id = ?").bind(ownerId).first<{ n: number }>();
    return await Promise.all(mirrors.map(async (mirror) => {
      const row = await database().prepare(
        "SELECT COUNT(*) AS n, MAX(verified_at) AS last FROM drive_mirror_backups WHERE owner_id = ? AND google_sub = ?"
      ).bind(ownerId, mirror.google_sub).first<{ n: number; last: string | null }>();
      return { email: mirror.google_email, backedUp: row?.n ?? 0, total: total?.n ?? 0, lastVerifiedAt: row?.last ?? null };
    }));
  } catch {
    return [];
  }
}

async function ensureMirrorRoot(mirror: MirrorConnection, accessToken: string) {
  if (mirror.root_folder_id) {
    try {
      const existing = await getGoogleFile(accessToken, mirror.root_folder_id);
      if (existing.mimeType === GOOGLE_FOLDER) return existing.id;
    } catch { /* carpeta revocada o borrada: se crea otra */ }
  }
  const created = await createGoogleFolder(accessToken, "Pacientes");
  if (!created.id) throw new Error("No se pudo crear la carpeta de respaldos en la cuenta adicional.");
  await database().prepare("UPDATE google_drive_mirrors SET root_folder_id = ?, updated_at = ? WHERE owner_id = ? AND google_sub = ?")
    .bind(created.id, now(), mirror.owner_id, mirror.google_sub).run();
  mirror.root_folder_id = created.id;
  return created.id;
}

async function mirrorBackupOf(mirror: MirrorConnection, patientId: number) {
  return database().prepare(
    "SELECT patient_id, document_id, folder_id, snapshot_digest, verified_at FROM drive_mirror_backups WHERE owner_id = ? AND google_sub = ? AND patient_id = ?"
  ).bind(mirror.owner_id, mirror.google_sub, patientId).first<MirrorBackup>();
}

/** Copia una ficha a una cuenta adicional. Relee el documento antes de darla por respaldada. */
async function backupPatientToMirror(user: ChatGPTUser, mirror: MirrorConnection, patientId: number, tokens: Map<string, string>) {
  const config = configuration();
  const snapshot = await getDriveSnapshot(user.userId, patientId);
  if (!snapshot) return { saved: false, patientId, message: "Ficha no encontrada." };
  const previous = await mirrorBackupOf(mirror, patientId);
  if (previous && previous.snapshot_digest === snapshot.digest) return { saved: true, skipped: true, patientId };

  const key = "mirror:" + mirror.google_sub;
  const accessToken = tokens.get(key) || await getAccessToken(user, mirror, config.clientSecret);
  tokens.set(key, accessToken);
  const root = await ensureMirrorRoot(mirror, accessToken);
  const folder = await ensurePatientFolder(accessToken, root, patientId, snapshot.name, previous?.folder_id ?? null);
  let documentId = previous?.document_id ?? null;
  if (documentId) {
    try {
      const existing = await getGoogleFile(accessToken, documentId);
      if (existing.mimeType !== GOOGLE_DOC) documentId = null;
    } catch { documentId = null; }
  }
  if (!documentId) {
    const created = await createGoogleDocument(accessToken, snapshot.documentTitle, folder.id);
    if (!created.id) throw new Error("No se pudo crear el documento de respaldo en la cuenta adicional.");
    documentId = created.id;
  }
  await replaceDocumentText(accessToken, documentId, snapshot.documentText);
  await writeMarkdownFile(accessToken, user.userId, "copia:" + mirror.google_sub, patientId, folder.id, markdownName(patientId, snapshot.name), snapshot.markdown);
  const current = await getDriveSnapshot(user.userId, patientId);
  if (!current || current.digest !== snapshot.digest) return { saved: false, patientId, message: "La ficha cambió durante el respaldo; se copiará en el próximo intento." };
  await database().prepare(
    "INSERT INTO drive_mirror_backups (owner_id, google_sub, patient_id, document_id, folder_id, snapshot_digest, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(owner_id, google_sub, patient_id) DO UPDATE SET document_id = excluded.document_id, folder_id = excluded.folder_id, snapshot_digest = excluded.snapshot_digest, verified_at = excluded.verified_at"
  ).bind(user.userId, mirror.google_sub, patientId, documentId, folder.id, snapshot.digest, now()).run();
  return { saved: true, patientId };
}

/**
 * Copia a todas las cuentas adicionales las fichas que cambiaron. `budget` limita cuántas fichas se escriben
 * (cada ficha usa ~6 llamadas a Google). Devuelve resultados y el presupuesto restante.
 */
export async function syncDriveMirrors(user: ChatGPTUser, source: "manual" | "cron" | "guardado", budget = 6, onlyPatientId?: number) {
  const config = configuration();
  if (!config.configured) return { results: [] as Array<Record<string, unknown>>, budget };
  const mirrors = await mirrorsFor(user.userId);
  const results: Array<Record<string, unknown>> = [];
  const tokens = new Map<string, string>();
  for (const mirror of mirrors) {
    const { results: ids } = onlyPatientId
      ? { results: [{ id: onlyPatientId }] }
      : await database().prepare("SELECT id FROM patients WHERE owner_id = ? ORDER BY id").bind(user.userId).all<{ id: number }>();
    for (const { id } of ids) {
      if (budget <= 0) break;
      try {
        const result = await backupPatientToMirror(user, mirror, id, tokens);
        if ((result as { skipped?: boolean }).skipped) continue;
        budget--;
        results.push({ mirror: mirror.google_email, ...result });
        await recordBackupRun(user.userId, source, Boolean(result.saved), "copia en " + mirror.google_email + ": ficha " + id + (result.saved ? " respaldada" : " " + String((result as { message?: string }).message || "")));
      } catch (error) {
        budget--;
        const message = error instanceof Error ? error.message : "error";
        results.push({ mirror: mirror.google_email, saved: false, patientId: id, message });
        await recordBackupRun(user.userId, source, false, "copia en " + mirror.google_email + ": ficha " + id + ": " + message);
        if (!tokens.has("mirror:" + mirror.google_sub)) break; // token inválido: no insistir con esta cuenta
      }
    }
  }
  return { results, budget };
}


// ---------------------------------------------------------------------------
// Google Calendar de cualquier cuenta (solo lectura). Se conecta con «Conectar con Google», como Drive.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Crear y modificar citas en el calendario (sin acceso a borrar calendarios ni a ajustes). */
const CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
type CalendarConnection = { owner_id: string; google_sub: string; google_email: string; refresh_token_ciphertext: string; connected_at: string; last_sync_at: string | null; last_result: string | null; ok: number; can_write?: number };

async function ensureCalendarTable() {
  await database().prepare(
    "CREATE TABLE IF NOT EXISTS google_calendar_connections (owner_id TEXT NOT NULL, google_sub TEXT NOT NULL, google_email TEXT NOT NULL, refresh_token_ciphertext TEXT NOT NULL, " +
    "connected_at TEXT NOT NULL, last_sync_at TEXT, last_result TEXT, ok INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, google_sub))"
  ).run();
  try { await database().prepare("ALTER TABLE google_calendar_connections ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0").run(); } catch { /* la columna ya existe */ }
  await database().prepare("CREATE TABLE IF NOT EXISTS appointment_google_events (owner_id TEXT NOT NULL, appointment_id INTEGER NOT NULL, google_sub TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY (owner_id, appointment_id))").run();
}

async function saveCalendarConnection(ownerId: string, googleSub: string, email: string, refreshToken: string, clientSecret: string, canWrite = false) {
  await ensureCalendarTable();
  const stamp = now();
  await database().prepare(
    "INSERT INTO google_calendar_connections (owner_id, google_sub, google_email, refresh_token_ciphertext, connected_at, last_sync_at, last_result, ok, can_write) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?) " +
    "ON CONFLICT(owner_id, google_sub) DO UPDATE SET google_email = excluded.google_email, refresh_token_ciphertext = excluded.refresh_token_ciphertext, can_write = excluded.can_write"
  ).bind(ownerId, googleSub, email, await encryptRefreshToken(ownerId, refreshToken, clientSecret), stamp, canWrite ? 1 : 0).run();
  await syncGoogleCalendars(ownerId).catch(() => undefined);
}

export async function listCalendarConnections(ownerId: string) {
  await ensureCalendarTable();
  const { results } = await database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ? ORDER BY connected_at").bind(ownerId).all<CalendarConnection>();
  return results.map(row => ({ id: row.google_sub, email: row.google_email, connectedAt: row.connected_at, lastSyncAt: row.last_sync_at, lastResult: row.last_result, ok: Boolean(row.ok), canWrite: Boolean(row.can_write) }));
}

export async function removeCalendarConnection(ownerId: string, googleSub: string) {
  await ensureCalendarTable();
  await database().prepare("DELETE FROM google_calendar_connections WHERE owner_id = ? AND google_sub = ?").bind(ownerId, googleSub).run();
  await database().prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND calendar_id LIKE ?").bind(now(), ownerId, "g:" + googleSub + ":%").run();
}

type GoogleEvent = { id?: string; status?: string; summary?: string; description?: string; attendees?: Array<{ email?: string; self?: boolean; resource?: boolean }>; updated?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } };

/** Lee los calendarios visibles de cada cuenta conectada y los copia a la agenda (ventana de 2 semanas). La escritura de citas está en pushAppointmentToGoogle. */
export async function syncGoogleCalendars(ownerId?: string) {
  const config = configuration();
  if (!config.configured) return [];
  await ensureCalendarTable();
  const { syncWindow } = await import("@/app/calendar-ics");
  const { UPSERT_EVENT, PRUNE_EVENTS } = await import("@/app/calendar-sync");
  const query = ownerId
    ? database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ?").bind(ownerId)
    : database().prepare("SELECT * FROM google_calendar_connections").bind();
  const { results } = await query.all<CalendarConnection>();
  const out: Array<{ email: string; ok: boolean; detail: string }> = [];
  for (const row of results.slice(0, 20)) {
    const user: ChatGPTUser = { userId: row.owner_id, displayName: "", email: row.google_email, fullName: null };
    let detail: string, ok = false;
    try {
      const token = await getAccessToken(user, row as unknown as DriveConnection, config.clientSecret);
      const list = await googleApi<{ items?: Array<{ id: string; summary?: string; selected?: boolean; primary?: boolean }> }>(token,
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&fields=items(id,summary,selected,primary)");
      const calendars = (list.items ?? []).filter(cal => cal.primary || cal.selected).slice(0, 5);
      const win = syncWindow(new Date());
      const stamp = now();
      let count = 0;
      for (const cal of calendars) {
        const params = new URLSearchParams({ timeMin: win.fromIso, timeMax: win.toIso, singleEvents: "true", orderBy: "startTime", maxResults: "2500", showDeleted: "false", fields: "items(id,status,summary,description,attendees(email,self,resource),updated,start,end)" });
        const events = await googleApi<{ items?: GoogleEvent[] }>(token, "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(cal.id) + "/events?" + params.toString());
        const calendarId = "g:" + row.google_sub + ":" + cal.id;
        const rows = (events.items ?? []).filter(e => e.id && (e.start?.dateTime || e.start?.date));
        const stmts = rows.map(e => {
          const allDay = !e.start?.dateTime;
          const startAt = e.start?.dateTime ? new Date(e.start.dateTime).toISOString() : e.start!.date! + "T03:00:00.000Z";
          const endAt = e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : (e.end?.date ?? e.start!.date!) + "T03:00:00.000Z";
          return database().prepare(UPSERT_EVENT).bind(row.owner_id, calendarId, e.id, (e.summary || "(sin título)").slice(0, 300), startAt, endAt, "America/Santiago", e.status === "cancelled" ? "cancelled" : "confirmed", allDay ? 1 : 0, stamp, e.updated ?? null);
        });
        stmts.push(database().prepare(PRUNE_EVENTS).bind(stamp, row.owner_id, calendarId, win.fromIso, win.toIso, JSON.stringify(rows.map(e => e.id))));
        for (const stmt of stmts) await stmt.run();
        // Celulares y correos de la descripción o de los invitados, para reconocer al paciente de cada cita (solo esos datos, no el texto).
        try {
          const { HINTS_DDL, HINTS_UPSERT, HINTS_DELETE } = await import("@/app/calendar-hints-db");
          const { contactTokens } = await import("@/lib/today-agenda");
          await database().prepare(HINTS_DDL).run();
          for (const e of rows) {
            const guests = (e.attendees ?? []).filter(a => a.email && !a.self && !a.resource).map(a => a.email!.toLowerCase());
            const tokens = [...new Set([...contactTokens(e.description ?? ""), ...guests])].slice(0, 12);
            if (tokens.length) await database().prepare(HINTS_UPSERT).bind(row.owner_id, calendarId, e.id, tokens.join(" ")).run();
            else await database().prepare(HINTS_DELETE).bind(row.owner_id, calendarId, e.id).run();
          }
        } catch { /* las pistas son un extra: la agenda ya quedó importada */ }
        count += rows.length;
      }
      ok = true;
      detail = `${count} citas en ${calendars.length} ${calendars.length === 1 ? "calendario" : "calendarios"}`;
    } catch (error) {
      const raw = error instanceof Error ? error.message : "error";
      const code = raw.match(/\((HTTP [^)]*)\)/)?.[1] ?? "";
      detail = /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(raw)
        ? "Falta activar la «Google Calendar API» en el proyecto de Google Cloud de la app (" + code + ")."
        : /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|HTTP 403/.test(raw)
          ? "Google no dio permiso para ver el calendario: desconecta y vuelve a conectar marcando la casilla del calendario (" + code + ")."
          : /venció|invalid_grant|rechazada/.test(raw)
            ? "Google pide volver a conectar esta cuenta."
            : "No se pudo leer el calendario (" + (code || raw.slice(0, 60)) + "); se reintentará en la próxima actualización.";
    }
    await database().prepare("UPDATE google_calendar_connections SET last_sync_at = ?, last_result = ?, ok = ? WHERE owner_id = ? AND google_sub = ?").bind(now(), detail, ok ? 1 : 0, row.owner_id, row.google_sub).run();
    out.push({ email: row.google_email, ok, detail });
  }
  return out;
}


/** Envía un correo con la cuenta de Google elegida por el clínico (permiso «solo enviar»). Nunca lee la bandeja. */
export async function sendMailWithSender(sender: MailSender, raw: string): Promise<void> {
  const config = configuration();
  if (!config.configured) throw new Error("Falta configurar Google en la aplicación.");
  const user: ChatGPTUser = { userId: sender.owner_id, displayName: "", email: sender.google_email, fullName: null };
  const token = await getAccessToken(user, sender as unknown as DriveConnection, config.clientSecret);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const reason = await googleErrorReason(response);
    throw new Error(/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason) ? "Falta activar la «Gmail API» en el proyecto de Google Cloud (" + reason + ")." : "Gmail no aceptó el envío (" + reason + ").");
  }
}


export type CalendarPushStatus = "ok" | "sin-conexion" | "solo-lectura" | "error";
type AppointmentForGoogle = { id: number; day: string; time: string; reason: string };

/** Crea la cita agendada en la ficha dentro del calendario principal de Google del profesional (si dio permiso de escritura). */
export async function pushAppointmentToGoogle(ownerId: string, appointment: AppointmentForGoogle, patientName: string, patientId?: number): Promise<CalendarPushStatus> {
  const config = configuration();
  if (!config.configured) return "sin-conexion";
  await ensureCalendarTable();
  const { results } = await database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ? ORDER BY connected_at").bind(ownerId).all<CalendarConnection>();
  if (!results.length) return "sin-conexion";
  const row = results.find(r => r.can_write);
  if (!row) return "solo-lectura";
  try {
    const { chileLocalToIso } = await import("@/lib/appointment-events");
    const startIso = chileLocalToIso(appointment.day, appointment.time);
    if (!startIso) return "error";
    const endIso = new Date(new Date(startIso).getTime() + 30 * 60000).toISOString();
    const user: ChatGPTUser = { userId: row.owner_id, displayName: "", email: row.google_email, fullName: null };
    const token = await getAccessToken(user, row as unknown as DriveConnection, config.clientSecret);
    const summary = [patientName, appointment.reason].filter(Boolean).join(" · ").slice(0, 300);
    const wall = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
    const created = await googleApi<{ id?: string; organizer?: { email?: string } }>(token, "https://www.googleapis.com/calendar/v3/calendars/primary/events?fields=id,organizer(email)", {
      method: "POST",
      body: JSON.stringify({ summary, start: { dateTime: wall(startIso), timeZone: "America/Santiago" }, end: { dateTime: wall(endIso), timeZone: "America/Santiago" } }),
    });
    if (!created.id) return "error";
    const calendarId = "g:" + row.google_sub + ":" + (created.organizer?.email || row.google_email);
    const { UPSERT_EVENT } = await import("@/app/calendar-sync");
    await database().prepare(UPSERT_EVENT).bind(ownerId, calendarId, created.id, summary, startIso, endIso, "America/Santiago", "confirmed", 0, now(), null).run();
    if (patientId) await database().prepare("UPDATE calendar_events SET patient_id = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(patientId, ownerId, calendarId, created.id).run();
    await database().prepare("INSERT OR REPLACE INTO appointment_google_events (owner_id, appointment_id, google_sub, calendar_id, event_id) VALUES (?, ?, ?, ?, ?)").bind(ownerId, appointment.id, row.google_sub, calendarId, created.id).run();
    return "ok";
  } catch { return "error"; }
}

/** Si la cita ya está en Google, actualiza su título cuando cambia el motivo. */
export async function updateAppointmentInGoogle(ownerId: string, appointmentId: number, patientName: string, reason: string): Promise<CalendarPushStatus> {
  const config = configuration();
  if (!config.configured) return "sin-conexion";
  await ensureCalendarTable();
  const link = await database().prepare("SELECT * FROM appointment_google_events WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, appointmentId).first<{ google_sub: string; calendar_id: string; event_id: string }>();
  if (!link) return "sin-conexion";
  const row = await database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ? AND google_sub = ?").bind(ownerId, link.google_sub).first<CalendarConnection>();
  if (!row?.can_write) return "solo-lectura";
  try {
    const user: ChatGPTUser = { userId: row.owner_id, displayName: "", email: row.google_email, fullName: null };
    const token = await getAccessToken(user, row as unknown as DriveConnection, config.clientSecret);
    const summary = [patientName, reason].filter(Boolean).join(" · ").slice(0, 300);
    await googleApi(token, "https://www.googleapis.com/calendar/v3/calendars/primary/events/" + encodeURIComponent(link.event_id) + "?fields=id", { method: "PATCH", body: JSON.stringify({ summary }) });
    await database().prepare("UPDATE calendar_events SET title = ? WHERE owner_id = ? AND calendar_id = ? AND google_event_id = ?").bind(summary, ownerId, link.calendar_id, link.event_id).run();
    return "ok";
  } catch { return "error"; }
}

export type AgendaEventResult = { ok: true } | { ok: false; error: string };
type StoredEvent = { id: number; calendar_id: string; google_event_id: string; title: string; start_at: string; end_at: string };

async function writableGoogleEvent(ownerId: string, eventId: number): Promise<{ ev: StoredEvent; row: CalendarConnection; calendar: string } | { error: string }> {
  await ensureCalendarTable();
  const ev = await database().prepare("SELECT id, calendar_id, google_event_id, title, start_at, end_at FROM calendar_events WHERE owner_id = ? AND id = ?").bind(ownerId, eventId).first<StoredEvent>();
  if (!ev) return { error: "No encontré esa cita en la agenda." };
  const match = ev.calendar_id.match(/^g:([^:]+):(.+)$/);
  if (!match) return { error: "Esta cita viene de un calendario de solo lectura (dirección iCal); se cambia en su calendario original." };
  const row = await database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ? AND google_sub = ?").bind(ownerId, match[1]).first<CalendarConnection>();
  if (!row) return { error: "La cuenta de Google de esta cita ya no está conectada." };
  if (!row.can_write) return { error: "Tu Google Calendar está en solo lectura. En Agenda → Google Calendar, toca «reconecta» y acepta el permiso de editar." };
  return { ev, row, calendar: match[2] };
}

/** Borra una cita de la agenda: en Google (si hay permiso) y, si venía de «Agendar control», también de la ficha. */
export async function deleteAgendaEvent(ownerId: string, eventId: number): Promise<AgendaEventResult> {
  const config = configuration();
  if (eventId < 0) { // cita de la ficha que no está en Google
    await database().prepare("DELETE FROM appointments WHERE owner_id = ? AND id = ?").bind(ownerId, -eventId).run();
    return { ok: true };
  }
  if (!config.configured) return { ok: false, error: "Falta configurar Google en la aplicación." };
  const found = await writableGoogleEvent(ownerId, eventId);
  if ("error" in found) return { ok: false, error: found.error };
  try {
    const user: ChatGPTUser = { userId: found.row.owner_id, displayName: "", email: found.row.google_email, fullName: null };
    const token = await getAccessToken(user, found.row as unknown as DriveConnection, config.clientSecret);
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(found.calendar) + "/events/" + encodeURIComponent(found.ev.google_event_id), { method: "DELETE", headers: { Authorization: "Bearer " + token } });
    if (!response.ok && response.status !== 404 && response.status !== 410) return { ok: false, error: "Google no permitió borrar la cita (HTTP " + response.status + ")." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No se pudo borrar en Google." }; }
  const link = await database().prepare("SELECT appointment_id FROM appointment_google_events WHERE owner_id = ? AND calendar_id = ? AND event_id = ?").bind(ownerId, found.ev.calendar_id, found.ev.google_event_id).first<{ appointment_id: number }>();
  if (link) {
    await database().prepare("DELETE FROM appointments WHERE owner_id = ? AND id = ?").bind(ownerId, link.appointment_id).run();
    await database().prepare("DELETE FROM appointment_google_events WHERE owner_id = ? AND appointment_id = ?").bind(ownerId, link.appointment_id).run();
  }
  await database().prepare("UPDATE calendar_events SET status = 'cancelled', imported_at = ? WHERE owner_id = ? AND id = ?").bind(now(), ownerId, eventId).run();
  return { ok: true };
}

/** Cambia título, día y hora de una cita (mantiene su duración). */
export async function updateAgendaEvent(ownerId: string, eventId: number, change: { title: string; day: string; time: string }): Promise<AgendaEventResult> {
  const config = configuration();
  const { chileLocalToIso } = await import("@/lib/appointment-events");
  const startIso = chileLocalToIso(change.day, change.time);
  const title = change.title.trim().slice(0, 300);
  if (!startIso || !title) return { ok: false, error: "Revisa el título, el día y la hora." };
  const splitReason = (value: string) => value.includes(" · ") ? value.slice(value.indexOf(" · ") + 3) : value;
  const isoDay = change.day.split("-")[0].length === 4 ? change.day : change.day.split("-").reverse().join("-");
  if (eventId < 0) {
    await database().prepare("UPDATE appointments SET day = ?, time = ?, reason = ? WHERE owner_id = ? AND id = ?").bind(isoDay, change.time, splitReason(title).slice(0, 500), ownerId, -eventId).run();
    return { ok: true };
  }
  if (!config.configured) return { ok: false, error: "Falta configurar Google en la aplicación." };
  const found = await writableGoogleEvent(ownerId, eventId);
  if ("error" in found) return { ok: false, error: found.error };
  const duration = Math.max(15 * 60000, new Date(found.ev.end_at).getTime() - new Date(found.ev.start_at).getTime());
  const endIso = new Date(new Date(startIso).getTime() + duration).toISOString();
  const wall = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
  try {
    const user: ChatGPTUser = { userId: found.row.owner_id, displayName: "", email: found.row.google_email, fullName: null };
    const token = await getAccessToken(user, found.row as unknown as DriveConnection, config.clientSecret);
    await googleApi(token, "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(found.calendar) + "/events/" + encodeURIComponent(found.ev.google_event_id) + "?fields=id", {
      method: "PATCH", body: JSON.stringify({ summary: title, start: { dateTime: wall(startIso), timeZone: "America/Santiago" }, end: { dateTime: wall(endIso), timeZone: "America/Santiago" } }),
    });
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No se pudo cambiar en Google." }; }
  await database().prepare("UPDATE calendar_events SET title = ?, start_at = ?, end_at = ?, all_day = 0, imported_at = ? WHERE owner_id = ? AND id = ?").bind(title, startIso, endIso, now(), ownerId, eventId).run();
  const link = await database().prepare("SELECT appointment_id FROM appointment_google_events WHERE owner_id = ? AND calendar_id = ? AND event_id = ?").bind(ownerId, found.ev.calendar_id, found.ev.google_event_id).first<{ appointment_id: number }>();
  if (link) await database().prepare("UPDATE appointments SET day = ?, time = ?, reason = ? WHERE owner_id = ? AND id = ?").bind(isoDay, change.time, splitReason(title).slice(0, 500), ownerId, link.appointment_id).run();
  return { ok: true };
}

/** Cita nueva directamente en la agenda (p. ej. un paciente que aún no tiene ficha): se crea en el Google Calendar principal con permiso de escritura. */
export async function createAgendaEvent(ownerId: string, input: { title: string; day: string; time: string; minutes?: number }): Promise<AgendaEventResult> {
  const config = configuration();
  if (!config.configured) return { ok: false, error: "Falta configurar Google en la aplicación." };
  const { chileLocalToIso } = await import("@/lib/appointment-events");
  const startIso = chileLocalToIso(input.day, input.time);
  const title = input.title.trim().slice(0, 300);
  if (!startIso || !title) return { ok: false, error: "Revisa el nombre, el día y la hora." };
  await ensureCalendarTable();
  const { results } = await database().prepare("SELECT * FROM google_calendar_connections WHERE owner_id = ? ORDER BY connected_at").bind(ownerId).all<CalendarConnection>();
  if (!results.length) return { ok: false, error: "Primero conecta tu Google Calendar." };
  const row = results.find(r => r.can_write);
  if (!row) return { ok: false, error: "Tu Google Calendar está conectado solo para lectura: vuelve a conectarlo dando permiso para modificar eventos." };
  const minutes = [15, 30, 45, 60, 90, 120].includes(Number(input.minutes)) ? Number(input.minutes) : 30;
  const endIso = new Date(new Date(startIso).getTime() + minutes * 60000).toISOString();
  const wall = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
  try {
    const user: ChatGPTUser = { userId: row.owner_id, displayName: "", email: row.google_email, fullName: null };
    const token = await getAccessToken(user, row as unknown as DriveConnection, config.clientSecret);
    const created = await googleApi<{ id?: string; organizer?: { email?: string } }>(token, "https://www.googleapis.com/calendar/v3/calendars/primary/events?fields=id,organizer(email)", {
      method: "POST",
      body: JSON.stringify({ summary: title, start: { dateTime: wall(startIso), timeZone: "America/Santiago" }, end: { dateTime: wall(endIso), timeZone: "America/Santiago" } }),
    });
    if (!created.id) return { ok: false, error: "Google no devolvió la cita creada." };
    const calendarId = "g:" + row.google_sub + ":" + (created.organizer?.email || row.google_email);
    const { UPSERT_EVENT } = await import("@/app/calendar-sync");
    await database().prepare(UPSERT_EVENT).bind(ownerId, calendarId, created.id, title, startIso, endIso, "America/Santiago", "confirmed", 0, now(), null).run();
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No se pudo crear la cita en Google." }; }
}

/** Cita de la ficha → id de su evento en la agenda (si se escribió en Google Calendar). */
async function agendaEventForAppointment(ownerId: string, appointmentId: number): Promise<number | null> {
  await ensureCalendarTable();
  const row = await database().prepare("SELECT e.id AS id FROM appointment_google_events l JOIN calendar_events e ON e.owner_id = l.owner_id AND e.calendar_id = l.calendar_id AND e.google_event_id = l.event_id WHERE l.owner_id = ? AND l.appointment_id = ?").bind(ownerId, appointmentId).first<{ id: number }>();
  return row?.id ?? null;
}

/** Cambia fecha, hora y motivo de una cita de la ficha también en Google Calendar (si está allá). */
export async function rescheduleAppointmentInGoogle(ownerId: string, appointmentId: number, change: { day: string; time: string; title: string }): Promise<CalendarPushStatus> {
  const eventId = await agendaEventForAppointment(ownerId, appointmentId).catch(() => null);
  if (!eventId) return "sin-conexion";
  const result = await updateAgendaEvent(ownerId, eventId, change).catch(() => ({ ok: false as const, error: "error" }));
  return result.ok ? "ok" : /solo lectura/.test(result.error) ? "solo-lectura" : "error";
}

/** Borra la cita de la ficha y, si está en Google Calendar, también allá. */
export async function deleteAppointmentEverywhere(ownerId: string, appointmentId: number): Promise<CalendarPushStatus> {
  const eventId = await agendaEventForAppointment(ownerId, appointmentId).catch(() => null);
  let status: CalendarPushStatus = "sin-conexion";
  if (eventId) {
    const result = await deleteAgendaEvent(ownerId, eventId).catch(() => ({ ok: false as const, error: "error" }));
    status = result.ok ? "ok" : /solo lectura/.test(result.error) ? "solo-lectura" : "error";
  }
  await database().prepare("DELETE FROM appointments WHERE owner_id = ? AND id = ?").bind(ownerId, appointmentId).run();
  return status;
}
