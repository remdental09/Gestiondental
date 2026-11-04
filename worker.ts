import { createRemoteJWKSet, jwtVerify } from "jose";
import app from "vinext/server/fetch-handler";
import { resolveOwner, resolveOwnerWithRegistration } from "./app/access-owners";

type AccessIdentity = { email?: string | null };
type AccessContext = {
  aud?: string;
  getIdentity: () => Promise<AccessIdentity | null>;
};
type WorkerContext = ExecutionContext & { access?: AccessContext };

const ACCESS_EMAIL_HEADER = "x-clinic-access-email";
const ACCESS_OWNER_ID_HEADER = "x-clinic-access-owner-id";
const ACCESS_NAME_HEADER = "x-clinic-access-name";
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

  const keys = createRemoteJWKSet(
    new URL("/cdn-cgi/access/certs", issuer),
  );
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

export default {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    context: ExecutionContext,
  ): Promise<Response> {
    const configuredIssuerValue = env.ACCESS_TEAM_DOMAIN?.trim();
    const configuredIssuer = configuredIssuerValue ? accessIssuer(configuredIssuerValue) : null;
    const audience = env.ACCESS_POLICY_AUD?.trim();
    if (configuredIssuerValue && !configuredIssuer) return notReady();
    // Configuración de cuentas antes de verificar la identidad: si falta o está mal, nadie entra.
    const ownerConfig = { CLINIC_OWNERS: env.CLINIC_OWNERS, ACCESS_ALLOWED_EMAIL: env.ACCESS_ALLOWED_EMAIL, CLINIC_OWNER_ID: env.CLINIC_OWNER_ID, CLINIC_OPEN_REGISTRATION: env.CLINIC_OPEN_REGISTRATION };
    const configCheck = resolveOwner("", ownerConfig);
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

    // Cada correo autorizado tiene su propio owner_id; un correo desconocido no hereda el del titular.
    const resolved = await resolveOwnerWithRegistration(email, ownerConfig);
    if (!resolved.ok) return resolved.status === 503 ? notReady() : denied();

    const headers = new Headers(request.headers);
    headers.delete(ACCESS_EMAIL_HEADER);
    headers.delete(ACCESS_OWNER_ID_HEADER);
    headers.delete(ACCESS_NAME_HEADER);
    headers.delete("Cf-Access-Jwt-Assertion");
    headers.delete("oai-authenticated-user-id");
    headers.delete("oai-authenticated-user-email");
    headers.delete("oai-authenticated-user-full-name");
    headers.delete("oai-authenticated-user-full-name-encoding");
    headers.set(ACCESS_EMAIL_HEADER, email);
    headers.set(ACCESS_OWNER_ID_HEADER, resolved.owner.ownerId);
    headers.set(ACCESS_NAME_HEADER, encodeURIComponent(resolved.owner.name));
    // El endpoint MCP existente usa la identidad del Site. Solo el Worker, después
    // de validar Access y descartar cabeceras entrantes, puede establecerla aquí.
    if (new URL(request.url).pathname === "/mcp") {
      headers.set("oai-authenticated-user-id", resolved.owner.ownerId);
    }

    return app.fetch(new Request(request, { headers }), env, context);
  },
};
