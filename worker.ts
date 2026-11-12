import { AuthorizationError, OAuthProvider, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createRemoteJWKSet, jwtVerify } from "jose";
import app from "vinext/server/fetch-handler";
import { aboutPage, privacyPage } from "./lib/public-pages";
import { portadaPage, PORTADA_CSP } from "./lib/portada-page";
import {
  SESSION_COOKIE, STATE_COOKIE, SESSION_DAYS, LOGIN_PATH, CALLBACK_PATH, LOGOUT_PATH,
  signSession, verifySession, readCookie, cookie, randomToken, googleAuthUrl, acceptedGoogleProfile,
} from "./lib/google-login";
import { resolveOwner, resolveOwnerWithRegistration, type OwnerConfig, type ClinicOwner } from "./app/access-owners";

type AccessIdentity = { email?: string | null };
type AccessContext = {
  aud?: string;
  getIdentity: () => Promise<AccessIdentity | null>;
};
type DentalOAuthProps = { ownerId: string; displayName: string };
type WorkerContext = ExecutionContext & {
  access?: AccessContext;
  props?: DentalOAuthProps;
  auth?: { scope?: string[] };
};
type OAuthEnv = Cloudflare.Env & OwnerConfig & {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  MCP_OAUTH_ALLOWED_EMAIL?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

const ACCESS_EMAIL_HEADER = "x-clinic-access-email";
const ACCESS_OWNER_ID_HEADER = "x-clinic-access-owner-id";
const ACCESS_NAME_HEADER = "x-clinic-access-name";
const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const MCP_RESOURCE = "https://gestion-dental-luis-rodriguez.remdental09.workers.dev/mcp";
const OAUTH_ISSUER = "https://gestion-dental-luis-rodriguez.remdental09.workers.dev";
const OAUTH_SCOPES = ["dental:access", "offline_access"];

const denied = () => new Response("Acceso privado requerido.", {
  status: 401,
  headers: { "Cache-Control": "no-store" },
});
const notReady = () => new Response("Acceso privado en configuración.", {
  status: 503,
  headers: { "Cache-Control": "no-store" },
});

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getAccessKeySet(issuer: string) {
  const existing = keySets.get(issuer);
  if (existing) return existing;

  const keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer));
  keySets.set(issuer, keys);
  return keys;
}

function accessIssuer(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function issuerFromAccessJwt(assertion: string) {
  try {
    const payloadPart = assertion.split(".")[1];
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { iss?: unknown };
    return typeof payload.iss === "string" ? accessIssuer(payload.iss) : null;
  } catch {
    return null;
  }
}

function ownerConfig(env: OAuthEnv): OwnerConfig {
  return {
    CLINIC_OWNERS: env.CLINIC_OWNERS,
    ACCESS_ALLOWED_EMAIL: env.ACCESS_ALLOWED_EMAIL,
    CLINIC_OWNER_ID: env.CLINIC_OWNER_ID,
    CLINIC_OPEN_REGISTRATION: env.CLINIC_OPEN_REGISTRATION,
  };
}

async function accessOwner(
  request: Request,
  env: OAuthEnv,
  context: ExecutionContext,
  allowRegistration = true,
): Promise<{ email: string; owner: ClinicOwner } | Response> {
  const configuredIssuerValue = env.ACCESS_TEAM_DOMAIN?.trim();
  const configuredIssuer = configuredIssuerValue ? accessIssuer(configuredIssuerValue) : null;
  const audience = env.ACCESS_POLICY_AUD?.trim();
  if (configuredIssuerValue && !configuredIssuer) return notReady();

  const config = ownerConfig(env);
  const configCheck = resolveOwner("", config);
  if (!configCheck.ok && configCheck.status === 503) return notReady();

  let email = "";
  const access = (context as WorkerContext).access;
  if (access) {
    if (audience && access.aud !== audience) return denied();
    try {
      email = (await access.getIdentity())?.email?.trim().toLowerCase() ?? "";
    } catch {
      return denied();
    }
  } else {
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!assertion) return denied();
    const issuer = issuerFromAccessJwt(assertion);
    if (!issuer || (configuredIssuer && issuer !== configuredIssuer)) return denied();
    try {
      const { payload } = await jwtVerify(assertion, getAccessKeySet(issuer), {
        issuer,
        ...(audience ? { audience } : {}),
      });
      const tokenAudience = payload.aud;
      if (!(typeof tokenAudience === "string" && tokenAudience) && !(Array.isArray(tokenAudience) && tokenAudience.length > 0)) return denied();
      email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    } catch {
      return denied();
    }
  }

  const resolved = allowRegistration
    ? await resolveOwnerWithRegistration(email, config)
    : resolveOwner(email, config);
  if (!resolved.ok) return resolved.status === 503 ? notReady() : denied();
  return { email, owner: resolved.owner };
}

function clearInboundIdentityHeaders(headers: Headers) {
  for (const name of [
    ACCESS_EMAIL_HEADER,
    ACCESS_OWNER_ID_HEADER,
    ACCESS_NAME_HEADER,
    "Cf-Access-Jwt-Assertion",
    USER_ID_HEADER,
    USER_EMAIL_HEADER,
    USER_FULL_NAME_HEADER,
    USER_FULL_NAME_ENCODING_HEADER,
  ]) {
    headers.delete(name);
  }
}

// ---------- Inicio de sesión con Google (portada) ----------

function googleLoginConfig(env: OAuthEnv) {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID?.trim() || "";
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() || "";
  // SESSION_SECRET propio si existe; si no, una clave derivada del secreto de Google (nunca se expone).
  const sessionSecret = env.SESSION_SECRET?.trim() || (clientSecret ? "google-client:" + clientSecret : "");
  return { clientId, clientSecret, sessionSecret, configured: Boolean(clientId && clientSecret && sessionSecret) };
}

function portadaResponse(errorCode: string | null, method = "GET", status = 200) {
  const headers = securePageHeaders();
  headers.set("Content-Security-Policy", PORTADA_CSP);
  return new Response(method === "HEAD" ? null : portadaPage(errorCode), { status, headers });
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

function startGoogleLogin(request: Request, env: OAuthEnv): Response {
  const config = googleLoginConfig(env);
  if (!config.configured) return redirect("/?error=configuracion");
  const state = randomToken();
  const redirectUri = new URL(CALLBACK_PATH, request.url).toString();
  return redirect(googleAuthUrl(config.clientId, redirectUri, state), [cookie(STATE_COOKIE, state, 600)]);
}

async function finishGoogleLogin(request: Request, env: OAuthEnv): Promise<Response> {
  const config = googleLoginConfig(env);
  const clearState = cookie(STATE_COOKIE, "", 0);
  if (!config.configured) return redirect("/?error=configuracion", [clearState]);
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirect("/?error=cancelado", [clearState]);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const expected = readCookie(request.headers.get("Cookie"), STATE_COOKIE);
  if (!code || !state || !expected || state !== expected) return redirect("/?error=vencido", [clearState]);
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: new URL(CALLBACK_PATH, request.url).toString(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) return redirect("/?error=vencido", [clearState]);
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokens.access_token) return redirect("/?error=vencido", [clearState]);
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: "Bearer " + tokens.access_token } });
    if (!profileResponse.ok) return redirect("/?error=vencido", [clearState]);
    const profile = acceptedGoogleProfile(await profileResponse.json());
    if (!profile) return redirect("/?error=no-verificado", [clearState]);
    const resolved = await resolveOwnerWithRegistration(profile.email, ownerConfig(env));
    if (!resolved.ok) return redirect(resolved.status === 503 ? "/?error=configuracion" : "/?error=sin-acceso", [clearState]);
    const token = await signSession({ email: profile.email, name: profile.name, exp: Date.now() + SESSION_DAYS * 86_400_000 }, config.sessionSecret);
    return redirect("/", [clearState, cookie(SESSION_COOKIE, token, SESSION_DAYS * 86_400)]);
  } catch {
    return redirect("/?error=vencido", [clearState]);
  }
}

function logout(request: Request): Response {
  // Si aún se entró por Cloudflare Access, también se cierra esa sesión.
  const viaAccess = Boolean(request.headers.get("Cf-Access-Jwt-Assertion"));
  return redirect(viaAccess ? "/cdn-cgi/access/logout" : "/", [cookie(SESSION_COOKIE, "", 0)]);
}

async function sessionOwner(request: Request, env: OAuthEnv, allowRegistration: boolean): Promise<{ email: string; owner: ClinicOwner } | null> {
  const config = googleLoginConfig(env);
  const session = await verifySession(readCookie(request.headers.get("Cookie"), SESSION_COOKIE), config.sessionSecret);
  if (!session) return null;
  const owners = ownerConfig(env);
  const resolved = allowRegistration ? await resolveOwnerWithRegistration(session.email, owners) : resolveOwner(session.email, owners);
  return resolved.ok ? { email: session.email, owner: resolved.owner } : null;
}

/** Sesión de Google primero; Cloudflare Access sigue sirviendo mientras se retira. Sin ninguna: portada (páginas) o 401 (API). */
async function identify(request: Request, env: OAuthEnv, context: ExecutionContext, allowRegistration = true): Promise<{ email: string; owner: ClinicOwner } | Response> {
  const fromSession = await sessionOwner(request, env, allowRegistration);
  if (fromSession) return fromSession;
  const hasAccess = Boolean((context as WorkerContext).access) || Boolean(request.headers.get("Cf-Access-Jwt-Assertion"));
  if (hasAccess) return accessOwner(request, env, context, allowRegistration);
  const wantsPage = (request.method === "GET" || request.method === "HEAD") && (request.headers.get("Accept") ?? "").includes("text/html");
  return wantsPage ? portadaResponse(new URL(request.url).searchParams.get("error"), request.method) : denied();
}

async function privateAppFetch(request: Request, env: OAuthEnv, context: ExecutionContext): Promise<Response> {
  const identity = await identify(request, env, context);
  if (identity instanceof Response) return identity;

  const headers = new Headers(request.headers);
  clearInboundIdentityHeaders(headers);
  headers.set(ACCESS_EMAIL_HEADER, identity.email);
  headers.set(ACCESS_OWNER_ID_HEADER, identity.owner.ownerId);
  headers.set(ACCESS_NAME_HEADER, encodeURIComponent(identity.owner.name));
  return app.fetch(new Request(request, { headers }), env, context);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function scopeLabel(scope: string) {
  if (scope === "dental:access") return "Consultar y gestionar las fichas del espacio vinculado a esta cuenta.";
  if (scope === "offline_access") return "Mantener y renovar la conexión de forma segura.";
  return scope;
}

function consentPage(details: ConsentDescription, handle: string, ownerName: string) {
  const name = escapeHtml(details.clientName);
  const domain = details.clientDomain
    ? `Dominio verificado: <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "Este cliente no declara un dominio verificado.";
  const scopes = details.scope.map((scope) => `
    <label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked>
      <strong>${escapeHtml(scopeLabel(scope))}</strong></label>`).join("\n");
  const localWarning = details.redirectIsLoopback
    ? "<p><strong>La respuesta de autorización se enviará a una aplicación de este equipo.</strong> Continúa solo si acabas de iniciar esta conexión.</p>"
    : "";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar Gestión Dental</title></head><body>
<main><h1>Conectar con Gestión Dental</h1>
<p>Cuenta clínica: <strong>${escapeHtml(ownerName)}</strong></p>
<p>Cliente que solicita acceso: <strong>${name}</strong></p>
<p>${domain} Los códigos de autorización se enviarán a <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${localWarning}
<h2>Permisos solicitados</h2><form method="post">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
${scopes}
<p>El cliente podrá utilizar las herramientas disponibles para esta cuenta. Las acciones clínicas mantienen sus validaciones y confirmaciones.</p>
<p><button name="decision" value="approve">Autorizar</button>
<button name="decision" value="deny">Cancelar</button></p>
</form></main></body></html>`;
}

function securePageHeaders(headers = new Headers()) {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", "default-src 'none'; form-action 'self' https://chatgpt.com; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return headers;
}

async function authorize(request: Request, env: OAuthEnv, context: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Método no permitido.", { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
  }

  const identity = await identify(request, env, context, false);
  if (identity instanceof Response) return identity;
  const allowedEmail = env.MCP_OAUTH_ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowedEmail) return notReady();
  if (identity.email !== allowedEmail) return denied();
  const oauth = env.OAUTH_PROVIDER;

  if (request.method === "GET") {
    try {
      const oauthRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(oauthRequest);
      const consent = await oauth.beginConsent(oauthRequest);
      const headers = securePageHeaders(consent.headers);
      return new Response(consentPage(details, consent.handle, identity.owner.name), { headers });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        if (error.redirectTo) return new Response(null, { status: 302, headers: { Location: error.redirectTo, "Cache-Control": "no-store" } });
        return new Response(escapeHtml(error.description), { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }
      return new Response("No se pudo iniciar la autorización. Vuelve a conectar el complemento.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  const form = await request.formData();
  const handle = typeof form.get("handle") === "string" ? String(form.get("handle")) : "";
  if (form.get("decision") !== "approve") {
    try {
      const deniedConsent = await oauth.denyConsent(request, handle);
      deniedConsent.headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 302, headers: deniedConsent.headers });
    } catch {
      return new Response("La solicitud de autorización venció. Vuelve a conectar el complemento.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }

  try {
    const approved = await oauth.approveConsent(request, handle, {
      scope: form.getAll("scope").filter((scope): scope is string => typeof scope === "string"),
    });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: `owner-${encodeURIComponent(identity.owner.ownerId)}`,
      metadata: {},
      scope: approved.request.scope,
      props: { ownerId: identity.owner.ownerId, displayName: identity.owner.name },
    });
    approved.headers.set("Location", redirectTo);
    approved.headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 302, headers: approved.headers });
  } catch {
    return new Response("La autorización venció o no pudo completarse. Vuelve a conectar el complemento.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

const mcpHandler = {
  async fetch(request: Request, env: OAuthEnv, context: ExecutionContext): Promise<Response> {
    const ownerId = (context as WorkerContext).props?.ownerId;
    if (!ownerId) return denied();

    const headers = new Headers(request.headers);
    clearInboundIdentityHeaders(headers);
    headers.set(USER_ID_HEADER, ownerId);
    return app.fetch(new Request(request, { headers }), env, context);
  },
};

const oauthProvider = new OAuthProvider<OAuthEnv>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler: {
    async fetch(request, env, context) {
      const path = new URL(request.url).pathname;
      // Páginas públicas que Google exige para publicar la app de OAuth: no requieren sesión.
      if ((path === "/acerca" || path === "/privacidad") && (request.method === "GET" || request.method === "HEAD")) {
        return new Response(request.method === "HEAD" ? null : path === "/acerca" ? aboutPage() : privacyPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
        });
      }
      // Confirmación de cita desde el correo del paciente: pública, sin sesión. Solo esta ruta; cada enlace lleva un código secreto de un solo uso.
      if (path === "/api/confirmar" && (request.method === "GET" || request.method === "HEAD" || request.method === "POST")) {
        const headers = new Headers(request.headers);
        for (const name of [ACCESS_EMAIL_HEADER, ACCESS_OWNER_ID_HEADER, ACCESS_NAME_HEADER, USER_ID_HEADER, USER_EMAIL_HEADER, USER_FULL_NAME_HEADER, USER_FULL_NAME_ENCODING_HEADER]) headers.delete(name);
        return app.fetch(new Request(request, { headers }), env, context);
      }
      // Portada: imágenes públicas, inicio y cierre de sesión con Google.
      if (path.startsWith("/portada/") && (request.method === "GET" || request.method === "HEAD")) return (env as unknown as { ASSETS: Fetcher }).ASSETS.fetch(request);
      if (path === LOGIN_PATH && request.method === "GET") return startGoogleLogin(request, env);
      if (path === CALLBACK_PATH && request.method === "GET") return finishGoogleLogin(request, env);
      if (path === LOGOUT_PATH && (request.method === "GET" || request.method === "POST")) return logout(request);
      if (path === "/authorize") return authorize(request, env, context);
      return privateAppFetch(request, env, context);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  scopesSupported: OAUTH_SCOPES,
  requiredScopes: ["dental:access"],
  resourceMetadata: {
    resource: MCP_RESOURCE,
    authorization_servers: [OAUTH_ISSUER],
    resource_name: "Gestión Dental",
  },
  clientIdMetadataDocumentEnabled: true,
});

const worker = {
  fetch(request: Request, env: OAuthEnv, context: ExecutionContext) {
    return oauthProvider.fetch(request, env, context);
  },
  async scheduled(controller: ScheduledController, env: OAuthEnv, context: ExecutionContext) {
    const { runScheduled } = await import("./app/scheduled");
    context.waitUntil(runScheduled(controller.cron, env as unknown as Parameters<typeof runScheduled>[1]));
  },
};

export default worker;
