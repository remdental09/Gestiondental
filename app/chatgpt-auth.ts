import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** «recepcion» y «asistente»: roles de apoyo (permisos en lib/role-policy.ts). */
export type SpaceRoleName = "titular" | "admin" | "dentista" | "recepcion" | "asistente";

export type ChatGPTUser = {
  /** Espacio de datos en que se trabaja: el personal o el de la clínica a la que pertenece (pacientes, agenda, imágenes). */
  userId: string;
  /** owner_id propio de la persona: su perfil profesional, sus aranceles y la autoría de sus evoluciones. */
  personalId?: string;
  /** Rol en el espacio actual: «titular» en el propio; «admin» o «dentista» en una clínica ajena. */
  spaceRole?: SpaceRoleName;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
// These headers are injected only by worker.ts after validating Cloudflare Access.
const ACCESS_USER_ID_HEADER = "x-clinic-access-owner-id";
const ACCESS_USER_EMAIL_HEADER = "x-clinic-access-email";
const ACCESS_USER_NAME_HEADER = "x-clinic-access-name";
const ACCESS_PERSONAL_ID_HEADER = "x-clinic-personal-id";
const ACCESS_SPACE_ROLE_HEADER = "x-clinic-space-role";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const accessUserId = requestHeaders.get(ACCESS_USER_ID_HEADER);
  const accessEmail = requestHeaders.get(ACCESS_USER_EMAIL_HEADER);
  if (accessUserId && accessEmail) {
    const encodedName = requestHeaders.get(ACCESS_USER_NAME_HEADER);
    const accessName = encodedName ? safeDecodeURIComponent(encodedName) : null;
    const personalId = requestHeaders.get(ACCESS_PERSONAL_ID_HEADER) || accessUserId;
    const rawRole = requestHeaders.get(ACCESS_SPACE_ROLE_HEADER);
    const spaceRole: SpaceRoleName = rawRole === "admin" || rawRole === "dentista" || rawRole === "recepcion" || rawRole === "asistente" ? rawRole : "titular";
    return {
      userId: accessUserId,
      personalId,
      spaceRole,
      displayName: accessName || accessEmail,
      email: accessEmail,
      fullName: accessName,
    };
  }

  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

/** owner_id propio (perfil, aranceles, autoría). Fuera de una clínica coincide con el espacio. */
export function personalIdOf(user: ChatGPTUser): string {
  return user.personalId || user.userId;
}

/** Rol en el espacio actual. Sin cabecera de rol (MCP, sesión ChatGPT) la persona trabaja en su propio espacio. */
export function spaceRoleOf(user: ChatGPTUser): SpaceRoleName {
  return user.spaceRole ?? "titular";
}

/**
 * Puede cambiar las conexiones compartidas del espacio (Drive, Google Calendar, correo de citas, envío de agenda).
 * Dentro de una clínica solo el titular y los administradores; un dentista invitado no reemplaza las de la clínica.
 */
export function managesSpace(user: ChatGPTUser): boolean {
  const role = spaceRoleOf(user);
  return role === "titular" || role === "admin";
}
export const SPACE_ADMIN_ONLY = "Solo un administrador de la clínica puede cambiar esta conexión.";

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
