import { getChatGPTUser, personalIdOf } from "@/app/chatgpt-auth";
import { hasMergedMark, hasStampClean, invalidateMerged, loadDocumentMark, loadStampLayout, loadStampMark, saveDocumentMark, saveMergedMark, saveStampClean, saveStampLayout, saveStampMark } from "@/app/document-mark-db";
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
    // La imagen unida no viaja al editor (pesa y no la necesita): solo el diseño.
    const printableLayout = await loadStampLayout(professionalId).catch(() => null);
    const stampLayout = printableLayout ? { ...printableLayout, mergedMark: undefined } : null;
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
  const body = await request.json().catch(() => null) as { documentMark?: unknown; stampMark?: unknown; stampLayout?: unknown; stampClean?: unknown; mergedMark?: unknown } | null;
  // Posición y tamaño del timbre: es solo presentación (no cambia la imagen), así que no pide el código al correo. null = volver al lugar de siempre.
  if (body && "stampLayout" in body) {
    try {
      const layout = body.stampLayout === null ? DEFAULT_STAMP_LAYOUT : normalizeStampLayout(body.stampLayout);
      const professionalId = personalIdOf(user);
      // Imágenes derivadas que el navegador genera a partir de la firma y el timbre guardados: el timbre sin fondo («quitar fondo») y la pieza
      // firma+timbre unida. Como cambian lo que se imprime en los documentos, guardarlas exige el mismo código al correo que cambiar el timbre
      // (un solo permiso por guardado). Mover, escalar o cambiar la intensidad no lo pide.
      const [hasClean, hasMerged] = await Promise.all([hasStampClean(professionalId).catch(() => false), hasMergedMark(professionalId).catch(() => false)]);
      const clean = layout.knockout && typeof body.stampClean === "string" ? body.stampClean : "";
      const merged = layout.merged && typeof body.mergedMark === "string" ? body.mergedMark : "";
      for (const [value, label] of [[clean, "El timbre sin fondo"], [merged, "La firma unida con el timbre"]] as const) {
        if (value && (!/^data:image\/png;base64,/.test(value) || !validSignature(value))) return fail(`${label} debe ser un PNG de hasta 400 KB.`);
      }
      if (layout.knockout && !clean && !hasClean) return fail("No se pudo quitar el fondo del timbre. Intenta de nuevo.");
      if (layout.merged && !merged && !hasMerged) return fail("No se pudo unir la firma con el timbre. Intenta de nuevo.");
      if (clean || merged) {
        if (!await loadStampMark(professionalId).catch(() => "")) return fail("Primero guarda tu timbre.", 409);
        if (merged && !await loadDocumentMark(professionalId).catch(() => "")) return fail("Primero guarda tu firma.", 409);
        if (!await consumeUnlock(professionalId, new Date().toISOString())) return Response.json({ error: merged ? "Para unir la firma con el timbre pide el código a tu correo (igual que para cambiarlos)." : "Para quitar el fondo del timbre pide el código a tu correo (igual que para cambiarlo).", locked: true }, { status: 403, headers: { "Cache-Control": "no-store" } });
      }
      if (clean) await saveStampClean(professionalId, clean); else if (!layout.knockout && hasClean) await saveStampClean(professionalId, "");
      if (merged) await saveMergedMark(professionalId, merged); else if (!layout.merged && hasMerged) await saveMergedMark(professionalId, "");
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
    // Si cambia la firma o el timbre, la pieza unida (hecha con las imágenes anteriores) ya no vale.
    if (changes) await invalidateMerged(professionalId).catch(() => undefined);
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
