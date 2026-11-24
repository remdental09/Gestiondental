import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { hasStampClean, loadDocumentMark, loadStampLayout, loadStampMark, saveDocumentMark, saveStampClean, saveStampLayout, saveStampMark } from "@/app/document-mark-db";
import { archiveMark, consumeUnlock, loadLock } from "@/app/signature-lock-db";
import { ensureMailTables, mailDb } from "@/app/appointment-mail-db";
import { sendSystemMail } from "@/app/login-code-mail";
import { isValidEmail } from "@/lib/appointment-mail";
import { changesSavedMark, isUnlocked, signatureChangedEmail } from "@/lib/signature-lock";
import { validSignature } from "@/lib/signature-image";
import { DEFAULT_STAMP_LAYOUT, normalizeStampLayout } from "@/lib/stamp-layout";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const fail = (message: string, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para ver tu imagen de documentos.", 401);
  try {
    const professionalId = personalIdOf(user), documentMark = await loadDocumentMark(professionalId);
    // El timbre es opcional: si no se pudo leer (p. ej. migración pendiente), la firma sigue funcionando.
    const stampMark = await loadStampMark(professionalId).catch(() => "");
    const stampLayout = await loadStampLayout(professionalId).catch(() => null);
    const stampCleanReady = await hasStampClean(professionalId).catch(() => false);
    const unlocked = documentMark || stampMark ? isUnlocked(await loadLock(professionalId).catch(() => null), Date.now()) : false;
    return Response.json({ documentMark, stampMark, stampLayout, stampCleanReady, locked: !!documentMark && !unlocked, stampLocked: !!stampMark && !unlocked, unlocked }, { headers: { "Cache-Control": "no-store" } });
  }
  catch { return fail("No se pudo leer tu imagen de documentos.", 500); }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user?.userId) return fail("Inicia sesión para guardar tu imagen de documentos.", 401);
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("Origen no permitido.", 403);
  const body = await request.json().catch(() => null) as { documentMark?: unknown; stampMark?: unknown; stampLayout?: unknown; stampClean?: unknown } | null;
  // Posición y tamaño del timbre: es solo presentación (no cambia la imagen), así que no pide el código al correo. null = volver al lugar de siempre.
  if (body && "stampLayout" in body) {
    try {
      const layout = body.stampLayout === null ? DEFAULT_STAMP_LAYOUT : normalizeStampLayout(body.stampLayout);
      const professionalId = personalIdOf(user);
      // «Quitar fondo»: el navegador manda el timbre ya sin fondo (PNG con transparencia). Como eso cambia lo que se imprime en los documentos,
      // guardarlo exige el mismo código al correo que cambiar el timbre (un permiso = un cambio). Mover o cambiar la opacidad no lo pide.
      const hasClean = await hasStampClean(professionalId).catch(() => false);
      if (layout.knockout) {
        const clean = typeof body.stampClean === "string" ? body.stampClean : "";
        if (clean) {
          if (!/^data:image\/png;base64,/.test(clean) || !validSignature(clean)) return fail("El timbre sin fondo debe ser un PNG de hasta 400 KB.");
          if (!await loadStampMark(professionalId).catch(() => "")) return fail("Primero guarda tu timbre.", 409);
          if (!await consumeUnlock(professionalId, new Date().toISOString())) return Response.json({ error: "Para quitar el fondo del timbre pide el código a tu correo (igual que para cambiarlo).", locked: true }, { status: 403, headers: { "Cache-Control": "no-store" } });
          await saveStampClean(professionalId, clean);
        } else if (!hasClean) return fail("No se pudo quitar el fondo del timbre. Intenta de nuevo.");
      } else if (hasClean) await saveStampClean(professionalId, "");
      await saveStampLayout(professionalId, layout);
      return Response.json({ stampLayout: layout }, { headers: { "Cache-Control": "no-store" } });
    } catch { return fail("No se pudo guardar la posición del timbre.", 500); }
  }
  // Un guardado cambia una sola imagen: el timbre (stampMark) o, como siempre, la firma (documentMark).
  const isStamp = typeof body?.stampMark === "string";
  const what = isStamp ? "timbre" : "firma";
  const mark = (isStamp ? body.stampMark as string : typeof body?.documentMark === "string" ? body.documentMark : "").trim();
  if (mark && !validSignature(mark)) return fail(`${isStamp ? "El timbre" : "La firma"} debe ser una imagen PNG, JPG o WebP de hasta 400 KB.`);
  try {
    const professionalId = personalIdOf(user), now = Date.now(), saved = isStamp ? await loadStampMark(professionalId) : await loadDocumentMark(professionalId);
    const changes = changesSavedMark(saved, mark);
    // La firma o el timbre guardados solo se cambian o se quitan con el código enviado al correo: el permiso se gasta aquí, de forma
    // atómica (un permiso = un cambio, aunque lleguen dos guardados a la vez).
    if (changes) {
      if (!await consumeUnlock(professionalId, new Date(now).toISOString())) return Response.json({ error: isStamp ? "Tu timbre está protegido. Pide el código a tu correo para cambiarlo." : "Tu firma está protegida. Pide el código a tu correo para cambiarla.", locked: true }, { status: 403, headers: { "Cache-Control": "no-store" } });
      await archiveMark(professionalId, saved, isStamp ? (mark ? "timbre cambiado" : "timbre quitado") : (mark ? "cambiada" : "quitada"), new Date(now).toISOString());
    }
    if (isStamp) {
      await saveStampMark(professionalId, mark);
      // La versión sin fondo era de la imagen anterior (saveStampMark ya la borró): «quitar fondo» se vuelve a pedir con la imagen nueva.
      if (changes) { const layout = await loadStampLayout(professionalId).catch(() => null); if (layout?.knockout) await saveStampLayout(professionalId, { ...layout, knockout: false }).catch(() => undefined); }
    } else await saveDocumentMark(professionalId, mark);
    if (changes) await notifyChange(user.userId, user.email, mark ? "cambiada" : "quitada", now, what).catch(() => undefined);
    return Response.json(isStamp ? { stampMark: mark, locked: !!mark } : { documentMark: mark, locked: !!mark }, { headers: { "Cache-Control": "no-store" } });
  } catch { return fail(`No se pudo guardar tu ${what}.`, 500); }
}

/** Aviso por correo de que la firma cambió (si falla el envío, el cambio igual queda registrado en el archivo). */
async function notifyChange(ownerId: string, email: string, action: "cambiada" | "quitada", now: number, what: "firma" | "timbre") {
  if (!isValidEmail(email)) return;
  const db = mailDb(); if (db) await ensureMailTables(db);
  const when = new Date(now).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" });
  await sendSystemMail(email.trim(), signatureChangedEmail(action, when, what), [ownerId]);
}
