import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { confirmDriveSnapshot, getDriveSnapshot, listDriveBackupQueue } from "@/app/drive-backup";

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
  authorization.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive.file");
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("include_granted_scopes", "true");
  authorization.searchParams.set("prompt", "consent select_account");
  authorization.searchParams.set("state", stateValue);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers({ Location: authorization.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", "__Host-gd-drive-state=" + stateValue + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600");
  headers.append("Set-Cookie", "__Host-gd-drive-verifier=" + verifier + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600");
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
async function recordBackupRun(ownerId: string, source: "manual" | "cron", ok: boolean, detail: string) {
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
      await recordBackupRun(user.userId, "manual", Boolean(single.saved), single.saved ? "ficha " + patientId + " respaldada" : String((single as { message?: string }).message || "no se respaldó"));
      return { configured: true, connected: true, results: [single], complete: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      await recordBackupRun(user.userId, "manual", false, "ficha " + patientId + ": " + message);
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
export async function runScheduledDriveBackup(maxPatients = 6) {
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
  return { configured: true, owners: connections.length, results, budgetLeft: budget };
}
