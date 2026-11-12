/**
 * Inicio de sesión con Google para la portada (reemplaza a Cloudflare Access).
 * Google verifica que el correo es de quien entra; aquí solo se firma una cookie de sesión.
 * Sin dependencias del runtime: usa WebCrypto, que existe en Workers y en Node.
 */
export const SESSION_COOKIE = "sd_session";
export const STATE_COOKIE = "sd_oauth_state";
export const SESSION_DAYS = 30;
export const LOGIN_PATH = "/auth/google";
export const CALLBACK_PATH = "/auth/google/callback";
export const LOGOUT_PATH = "/auth/salir";

export type Session = { email: string; name: string; exp: number };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode("speakdent-session-v1:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Cookie firmada: datos.firma. El secreto nunca sale del servidor. */
export async function signSession(session: Session, secret: string): Promise<string> {
  if (!secret) throw new Error("Falta el secreto de sesión.");
  const body = base64url(encoder.encode(JSON.stringify(session)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body)));
  return body + "." + base64url(signature);
}

/** Devuelve la sesión si la firma es válida y no venció; si no, null. */
export async function verifySession(token: string | null | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64url(signature), encoder.encode(body));
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Partial<Session>;
    if (typeof parsed.email !== "string" || !parsed.email.includes("@") || typeof parsed.exp !== "number" || parsed.exp <= now) return null;
    return { email: parsed.email.trim().toLowerCase(), name: typeof parsed.name === "string" ? parsed.name.slice(0, 80) : "", exp: parsed.exp };
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

/** Pantalla de Google para elegir cuenta. Solo pide correo y nombre (openid email profile). */
export function googleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}

/** Solo se acepta un correo que Google marque como verificado. */
export function acceptedGoogleProfile(profile: unknown): { email: string; name: string } | null {
  if (!profile || typeof profile !== "object") return null;
  const value = profile as { email?: unknown; email_verified?: unknown; name?: unknown };
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const verified = value.email_verified === true || value.email_verified === "true";
  if (!verified || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return { email, name: typeof value.name === "string" ? value.name.trim().slice(0, 80) : "" };
}
