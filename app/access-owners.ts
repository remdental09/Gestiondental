/**
 * Cuentas independientes detrás de Cloudflare Access.
 *
 * CLINIC_OWNERS (secreto del Worker) es un JSON que asigna a cada correo autorizado su propio owner_id:
 *   {"correo@ejemplo.cl": {"ownerId": "…", "name": "Dr. Nombre Apellido"}}
 * (también se acepta "correo": "ownerId"). Cada owner_id ve solo sus fichas, imágenes y agenda.
 *
 * ACCESS_ALLOWED_EMAIL + CLINIC_OWNER_ID quedan solo como respaldo para ese mismo correo (el del titular).
 * Un correo que no está en la lista recibe 401: nunca hereda el owner_id del titular.
 */
export type ClinicOwner = { ownerId: string; name: string };
export type OwnerConfig = { CLINIC_OWNERS?: string; ACCESS_ALLOWED_EMAIL?: string; CLINIC_OWNER_ID?: string; CLINIC_OPEN_REGISTRATION?: string };
export type OwnerResolution = { ok: true; owner: ClinicOwner } | { ok: false; status: 401 | 503 };

const OWNER_ID = /^[A-Za-z0-9_.:@-]{8,200}$/;

/** Nombre visible si el secreto no lo trae: «Dr(a). usuario» a partir del correo. */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim() || email;
  return `Dr(a). ${local}`;
}

/** Lee y valida CLINIC_OWNERS. null si no está configurado; "invalid" si está mal formado o comparte owner_id. */
export function parseClinicOwners(raw: string | undefined, legacy: { email?: string; ownerId?: string } = {}): Map<string, ClinicOwner> | null | "invalid" {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return "invalid"; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid";
  const owners = new Map<string, ClinicOwner>();
  const usedIds = new Set<string>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const email = key.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || owners.has(email)) return "invalid";
    const entry = typeof value === "string" ? { ownerId: value } : value;
    if (!entry || typeof entry !== "object") return "invalid";
    const ownerId = typeof (entry as { ownerId?: unknown }).ownerId === "string" ? (entry as { ownerId: string }).ownerId.trim() : "";
    const rawName = (entry as { name?: unknown }).name;
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 80) : nameFromEmail(email);
    if (!OWNER_ID.test(ownerId) || usedIds.has(ownerId)) return "invalid";
    // El owner_id del titular solo puede pertenecer al correo del titular.
    if (legacy.ownerId && ownerId === legacy.ownerId && legacy.email && email !== legacy.email) return "invalid";
    usedIds.add(ownerId);
    owners.set(email, { ownerId, name });
  }
  return owners.size ? owners : "invalid";
}

/** Dueño de los datos para un correo ya verificado por Access. */
export function resolveOwner(emailInput: string, config: OwnerConfig): OwnerResolution {
  const email = emailInput.trim().toLowerCase();
  const legacyEmail = config.ACCESS_ALLOWED_EMAIL?.trim().toLowerCase() || undefined;
  const legacyOwner = config.CLINIC_OWNER_ID?.trim() || undefined;
  const owners = parseClinicOwners(config.CLINIC_OWNERS, { email: legacyEmail, ownerId: legacyOwner });
  if (owners === "invalid") return { ok: false, status: 503 };
  const openRegistration = config.CLINIC_OPEN_REGISTRATION?.trim().toLowerCase() === "true";
  if (!owners && !(legacyEmail && legacyOwner) && !openRegistration) return { ok: false, status: 503 };
  if (!email) return { ok: false, status: 401 };
  const mapped = owners?.get(email);
  if (mapped) return { ok: true, owner: mapped };
  if (legacyEmail && legacyOwner && email === legacyEmail) return { ok: true, owner: { ownerId: legacyOwner, name: nameFromEmail(email) } };
  return { ok: false, status: 401 };
}

/**
 * Permite crear un espacio aislado para cualquier correo que haya sido autenticado
 * por Cloudflare Access, solo cuando el administrador activa CLINIC_OPEN_REGISTRATION.
 * El ID determinista mantiene el mismo espacio en cada inicio de sesión sin guardar
 * el correo como clave de partición.
 */
export async function resolveOwnerWithRegistration(emailInput: string, config: OwnerConfig): Promise<OwnerResolution> {
  const resolved = resolveOwner(emailInput, config);
  if (resolved.ok || resolved.status === 503 || config.CLINIC_OPEN_REGISTRATION?.trim().toLowerCase() !== "true") return resolved;

  const email = emailInput.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, status: 401 };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gestion-dental-owner-v1:" + email));
  const ownerId = "email:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { ok: true, owner: { ownerId, name: nameFromEmail(email) } };
}

/** Iniciales del botón de inicio: «Dr. Luis Rodríguez» → «LR». Sin nombre, «GD» (Gestión Dental). */
export function viewerInitials(name: string): string {
  const words = name.replace(/^\s*dr(?:a|\(a\))?\.?\s+/i, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
  return letters || "GD";
}
