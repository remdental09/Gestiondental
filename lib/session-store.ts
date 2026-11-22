/**
 * Sesiones propias guardadas en D1 (reemplazo de Cloudflare Access).
 * La cookie lleva un token aleatorio («v2.…»); la base guarda solo su SHA-256, así un respaldo filtrado
 * no sirve para entrar. Vence a los 30 días sin uso (deslizante), se revoca al cerrar sesión y
 * hay un límite de intentos de inicio de sesión por IP. Sin dependencias: WebCrypto (Workers y Node).
 */
export type SessionDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

export type StoredSession = { email: string; name: string };
export const SESSION_TTL_MS = 30 * 86_400_000;
/** Cada cuánto se corre el vencimiento (y se reescribe la fila): como máximo una escritura al día por sesión. */
export const SLIDE_EVERY_MS = 86_400_000;
const CACHE_MS = 60_000;
export const LOGIN_LIMIT = 30;
export const LOGIN_WINDOW_MS = 10 * 60_000;

export const AUTH_SESSIONS_DDL = "CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)";
export const AUTH_RATE_DDL = "CREATE TABLE IF NOT EXISTS auth_rate_limits (key TEXT PRIMARY KEY NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL)";

const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const isStoredToken = (token: string | null | undefined): token is string => typeof token === "string" && /^v2\.[A-Za-z0-9_-]{40,64}$/.test(token);

/** Caché por instancia (60 s): evita una lectura de D1 en cada solicitud de la misma sesión. */
const cache = new Map<string, { session: StoredSession; expiresAt: number; lastSeenAt: number; checkedAt: number }>();
export function forgetCachedSessions() { cache.clear(); }

/** Crea una sesión y devuelve el token para la cookie. */
export async function createSession(db: SessionDb, session: StoredSession, now = Date.now()): Promise<string> {
  const token = "v2." + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  await db.prepare("INSERT INTO auth_sessions (id, email, name, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, session.email.trim().toLowerCase(), session.name.slice(0, 80), now, now, now + SESSION_TTL_MS).run();
  return token;
}

/**
 * Lee la sesión del token. `refresh` = true cuando se corrió el vencimiento: hay que reenviar la cookie
 * con 30 días nuevos. Devuelve null si no existe, venció o fue revocada.
 */
export async function readSession(db: SessionDb, token: string, now = Date.now()): Promise<{ session: StoredSession; refresh: boolean } | null> {
  if (!isStoredToken(token)) return null;
  const id = await sha256Hex(token);
  const hit = cache.get(id);
  const fromCache = Boolean(hit && now - hit.checkedAt < CACHE_MS && hit.expiresAt > now);
  let row: { email: string; name: string; expiresAt: number; lastSeenAt: number };
  if (fromCache && hit) row = { ...hit.session, expiresAt: hit.expiresAt, lastSeenAt: hit.lastSeenAt };
  else {
    const found = await db.prepare("SELECT email, name, expires_at, last_seen_at FROM auth_sessions WHERE id = ? AND revoked_at IS NULL")
      .bind(id).first<{ email: string; name: string; expires_at: number; last_seen_at: number }>();
    if (!found) { cache.delete(id); return null; }
    row = { email: found.email, name: found.name, expiresAt: Number(found.expires_at), lastSeenAt: Number(found.last_seen_at) };
  }
  if (row.expiresAt <= now) { cache.delete(id); return null; }
  let refresh = false;
  if (now - row.lastSeenAt >= SLIDE_EVERY_MS) {
    await db.prepare("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, now + SESSION_TTL_MS, id).run();
    row = { ...row, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS };
    refresh = true;
  }
  cache.set(id, { session: { email: row.email, name: row.name }, expiresAt: row.expiresAt, lastSeenAt: row.lastSeenAt, checkedAt: fromCache && hit && !refresh ? hit.checkedAt : now });
  return { session: { email: row.email, name: row.name }, refresh };
}

/** Cerrar sesión: la fila queda revocada (no se puede reutilizar la cookie aunque alguien la haya copiado). */
export async function revokeSession(db: SessionDb, token: string, now = Date.now()): Promise<void> {
  if (!isStoredToken(token)) return;
  const id = await sha256Hex(token);
  cache.delete(id);
  await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
}

/**
 * Límite de intentos de inicio de sesión por IP (ventana fija de 10 min). La IP se guarda como hash.
 * Devuelve true si se permite. Si la base falla, se permite (no dejar a nadie fuera por un error de D1).
 */
export async function allowLogin(db: SessionDb, ip: string, now = Date.now(), limit = LOGIN_LIMIT, windowMs = LOGIN_WINDOW_MS): Promise<boolean> {
  try {
    const key = "login:" + (await sha256Hex("speakdent-rate:" + (ip || "sin-ip"))).slice(0, 32);
    const windowStart = now - (now % windowMs);
    await db.prepare("INSERT INTO auth_rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN auth_rate_limits.window_start = excluded.window_start THEN auth_rate_limits.count + 1 ELSE 1 END, window_start = excluded.window_start")
      .bind(key, windowStart).run();
    const row = await db.prepare("SELECT count FROM auth_rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
    // Limpieza ocasional (los inicios de sesión son pocos): ventanas viejas y sesiones vencidas hace más de 30 días.
    if (Math.random() < 0.05) {
      await db.prepare("DELETE FROM auth_rate_limits WHERE window_start < ?").bind(now - 86_400_000).run();
      await db.prepare("DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at < ?").bind(now - SESSION_TTL_MS, now - SESSION_TTL_MS).run();
    }
    return !row || Number(row.count) <= limit;
  } catch {
    return true;
  }
}

/**
 * Protección CSRF para métodos que escriben: rechaza lo que el navegador marca como de otro sitio
 * (Sec-Fetch-Site) o con un Origin distinto. La cookie además es SameSite=Lax.
 */
export function crossSiteWrite(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("Origin");
  if (origin && origin !== "null") {
    try { return new URL(origin).origin !== new URL(request.url).origin; } catch { return true; }
  }
  return origin === "null";
}

/** Cerrar sesión por GET solo desde la propia app (un enlace de otro sitio no puede sacarte). */
export function sameSiteNavigation(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  return !site || site === "same-origin" || site === "none";
}
