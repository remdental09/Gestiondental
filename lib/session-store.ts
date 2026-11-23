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
/** Equipo propio: a las 2 horas sin actividad la sesión se cierra y hay que volver a entrar (Google + código del correo). */
export const OWN_IDLE_MS = 2 * 3_600_000;
/** En equipo propio la actividad se anota como máximo cada 5 minutos (basta para un tope de 2 horas). */
export const OWN_TOUCH_MS = 5 * 60_000;
/** Equipo compartido (cibercafé, aeropuerto): se cierra a los 15 min sin actividad y, pase lo que pase, a las 2 horas. No se desliza. */
export const SHARED_IDLE_MS = 15 * 60_000;
export const SHARED_MAX_MS = 2 * 3_600_000;
/** En equipo compartido se anota la actividad como máximo una vez por minuto. */
export const SHARED_TOUCH_MS = 60_000;
/** Código de ingreso por correo: la sesión nace «pendiente» y solo vale tras escribir el código. */
export const PENDING_MS = 15 * 60_000;
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_MS = 30_000;
/** Cada cuánto se corre el vencimiento (y se reescribe la fila): como máximo una escritura al día por sesión. */
export const SLIDE_EVERY_MS = 86_400_000;
const CACHE_MS = 60_000;
export const LOGIN_LIMIT = 30;
export const LOGIN_WINDOW_MS = 10 * 60_000;

export const AUTH_SESSIONS_DDL = "CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, shared INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 1, code_hash TEXT, code_expires_at INTEGER, code_attempts INTEGER NOT NULL DEFAULT 0, code_sent_at INTEGER)";
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
const cache = new Map<string, { session: StoredSession; expiresAt: number; lastSeenAt: number; shared: boolean; checkedAt: number }>();
export function forgetCachedSessions() { cache.clear(); }

/**
 * Crea una sesión y devuelve el token para la cookie. `shared`: equipo ajeno (sesión corta, sin deslizar).
 * `pending`: falta el código enviado al correo; la sesión no da acceso y muere a los 15 min si no se confirma.
 */
export async function createSession(db: SessionDb, session: StoredSession, now = Date.now(), shared = false, pending = false): Promise<string> {
  const token = "v2." + base64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  const expires = now + (pending ? PENDING_MS : shared ? SHARED_MAX_MS : SESSION_TTL_MS);
  await db.prepare("INSERT INTO auth_sessions (id, email, name, created_at, last_seen_at, expires_at, shared, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, session.email.trim().toLowerCase(), session.name.slice(0, 80), now, now, expires, shared ? 1 : 0, pending ? 0 : 1).run();
  return token;
}

/** Código de 6 dígitos sin sesgo (rechazo de valores sobre el último múltiplo de 1.000.000). */
export function newLoginCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  for (;;) {
    const value = crypto.getRandomValues(new Uint32Array(1))[0];
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

const codeHash = (id: string, code: string) => sha256Hex("speakdent-code:" + id + ":" + code);

/** Guarda (solo el hash de) un código nuevo para una sesión pendiente. Devuelve false si se pidió otro hace menos de 30 s o la sesión no está pendiente. */
export async function setLoginCode(db: SessionDb, token: string, code: string, now = Date.now()): Promise<boolean> {
  if (!isStoredToken(token) || !/^\d{6}$/.test(code)) return false;
  const id = await sha256Hex(token);
  const row = await db.prepare("SELECT verified, code_sent_at, expires_at FROM auth_sessions WHERE id = ? AND revoked_at IS NULL")
    .bind(id).first<{ verified: number; code_sent_at: number | null; expires_at: number }>();
  if (!row || Number(row.verified) === 1 || Number(row.expires_at) <= now) return false;
  if (row.code_sent_at && now - Number(row.code_sent_at) < CODE_RESEND_MS) return false;
  await db.prepare("UPDATE auth_sessions SET code_hash = ?, code_expires_at = ?, code_attempts = 0, code_sent_at = ? WHERE id = ?")
    .bind(await codeHash(id, code), now + CODE_TTL_MS, now, id).run();
  return true;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "locked";

/**
 * Comprueba el código. Correcto: la sesión queda confirmada con su duración normal (30 días, o 2 horas en equipo compartido).
 * Cinco intentos fallidos o sesión vencida: la sesión se revoca y hay que volver a entrar con Google.
 */
export async function verifyLoginCode(db: SessionDb, token: string, code: string, now = Date.now()): Promise<CodeCheck> {
  if (!isStoredToken(token)) return "expired";
  const id = await sha256Hex(token);
  const row = await db.prepare("SELECT verified, shared, expires_at, code_hash, code_expires_at, code_attempts FROM auth_sessions WHERE id = ? AND revoked_at IS NULL")
    .bind(id).first<{ verified: number; shared: number; expires_at: number; code_hash: string | null; code_expires_at: number | null; code_attempts: number }>();
  if (!row || Number(row.expires_at) <= now) return "expired";
  if (Number(row.verified) === 1) return "ok";
  if (!row.code_hash || !row.code_expires_at || Number(row.code_expires_at) <= now) return "expired";
  const clean = code.replace(/\D/g, "");
  if (clean.length === 6 && (await codeHash(id, clean)) === row.code_hash) {
    const shared = Number(row.shared) === 1;
    await db.prepare("UPDATE auth_sessions SET verified = 1, code_hash = NULL, code_expires_at = NULL, last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(now, now + (shared ? SHARED_MAX_MS : SESSION_TTL_MS), id).run();
    cache.delete(id);
    return "ok";
  }
  const attempts = Number(row.code_attempts) + 1;
  if (attempts >= CODE_MAX_ATTEMPTS) {
    await db.prepare("UPDATE auth_sessions SET revoked_at = ?, code_attempts = ? WHERE id = ?").bind(now, attempts, id).run();
    cache.delete(id);
    return "locked";
  }
  await db.prepare("UPDATE auth_sessions SET code_attempts = ? WHERE id = ?").bind(attempts, id).run();
  return "wrong";
}

/** Sin envío de correo posible: la sesión pendiente se confirma igual (no dejar a nadie fuera por falta de configuración). */
export async function confirmWithoutCode(db: SessionDb, token: string, now = Date.now()): Promise<void> {
  if (!isStoredToken(token)) return;
  const id = await sha256Hex(token);
  const row = await db.prepare("SELECT shared FROM auth_sessions WHERE id = ?").bind(id).first<{ shared: number }>();
  await db.prepare("UPDATE auth_sessions SET verified = 1, last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, now + (Number(row?.shared) === 1 ? SHARED_MAX_MS : SESSION_TTL_MS), id).run();
  cache.delete(id);
}

/**
 * Lee la sesión del token. `refresh` = true cuando se corrió el vencimiento: hay que reenviar la cookie
 * con 30 días nuevos. Devuelve null si no existe, venció o fue revocada.
 * Sesión de equipo compartido (`shared`): vence a los 15 min sin actividad y a las 2 horas de creada; nunca se desliza ni renueva la cookie.
 */
export async function readSession(db: SessionDb, token: string, now = Date.now()): Promise<{ session: StoredSession; refresh: boolean; shared: boolean; pending: boolean } | null> {
  if (!isStoredToken(token)) return null;
  const id = await sha256Hex(token);
  const hit = cache.get(id);
  const fromCache = Boolean(hit && now - hit.checkedAt < CACHE_MS && hit.expiresAt > now);
  let row: { email: string; name: string; expiresAt: number; lastSeenAt: number; shared: boolean };
  if (fromCache && hit) row = { ...hit.session, expiresAt: hit.expiresAt, lastSeenAt: hit.lastSeenAt, shared: hit.shared };
  else {
    const found = await db.prepare("SELECT email, name, expires_at, last_seen_at, shared, verified FROM auth_sessions WHERE id = ? AND revoked_at IS NULL")
      .bind(id).first<{ email: string; name: string; expires_at: number; last_seen_at: number; shared: number | null; verified: number | null }>();
    if (!found) { cache.delete(id); return null; }
    if (Number(found.expires_at) <= now) { cache.delete(id); return null; }
    // Pendiente de código: no se guarda en caché ni se desliza; solo sirve para mostrar la pantalla del código.
    if (found.verified !== null && found.verified !== undefined && Number(found.verified) === 0) {
      cache.delete(id);
      return { session: { email: found.email, name: found.name }, refresh: false, shared: Number(found.shared) === 1, pending: true };
    }
    row = { email: found.email, name: found.name, expiresAt: Number(found.expires_at), lastSeenAt: Number(found.last_seen_at), shared: Number(found.shared) === 1 };
  }
  if (row.expiresAt <= now || now - row.lastSeenAt > (row.shared ? SHARED_IDLE_MS : OWN_IDLE_MS)) { cache.delete(id); return null; }
  let refresh = false;
  if (row.shared) {
    if (now - row.lastSeenAt >= SHARED_TOUCH_MS) {
      await db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
      row = { ...row, lastSeenAt: now };
    }
  } else if (now - row.lastSeenAt >= OWN_TOUCH_MS) {
    // La cookie solo se reenvía una vez al día; el vencimiento de 30 días y la actividad se anotan cada 5 minutos.
    refresh = now - row.lastSeenAt >= SLIDE_EVERY_MS;
    await db.prepare("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, now + SESSION_TTL_MS, id).run();
    row = { ...row, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS };
  }
  cache.set(id, { session: { email: row.email, name: row.name }, expiresAt: row.expiresAt, lastSeenAt: row.lastSeenAt, shared: row.shared, checkedAt: fromCache && hit && row.lastSeenAt === hit.lastSeenAt ? hit.checkedAt : now });
  return { session: { email: row.email, name: row.name }, refresh, shared: row.shared, pending: false };
}

/** Cerrar sesión: la fila queda revocada (no se puede reutilizar la cookie aunque alguien la haya copiado). Devuelve si era de equipo compartido. */
export async function revokeSession(db: SessionDb, token: string, now = Date.now()): Promise<boolean> {
  if (!isStoredToken(token)) return false;
  const id = await sha256Hex(token);
  cache.delete(id);
  const row = await db.prepare("SELECT shared FROM auth_sessions WHERE id = ?").bind(id).first<{ shared: number | null }>();
  await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, id).run();
  return Number(row?.shared) === 1;
}

/** «Cerrar sesión en todos los equipos»: revoca todas las sesiones abiertas de ese correo (la caché de otras instancias dura como máximo 60 s). */
export async function revokeAllSessions(db: SessionDb, email: string, now = Date.now()): Promise<void> {
  cache.clear();
  await db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL").bind(now, email.trim().toLowerCase()).run();
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
  if (site === "cross-site" || site === "same-site") return true;
  // El navegador marca la solicitud como de este mismo sitio (no se puede falsificar desde una página):
  // se acepta aunque Origin llegue como «null» (formularios en páginas con Referrer-Policy: no-referrer).
  if (site === "same-origin") return false;
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
