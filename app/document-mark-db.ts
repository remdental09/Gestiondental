import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { professionalDocumentSettings } from "@/db/schema";
import { parseStampLayout, serializeStampLayout, type PrintableStampLayout, type StampLayout } from "@/lib/stamp-layout";

export async function loadDocumentMark(professionalId: string): Promise<string> {
  const [row] = await getDb().select({ mark: professionalDocumentSettings.documentMark })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return row?.mark ?? "";
}

export async function saveDocumentMark(professionalId: string, documentMark: string): Promise<void> {
  await getDb().insert(professionalDocumentSettings).values({ professionalId, documentMark, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { documentMark, updatedAt: new Date().toISOString() } });
}

/** Timbre del profesional (se imprime bajo su firma). Quien llama lo trata como opcional: si falla, el documento sale sin timbre. */
export async function loadStampMark(professionalId: string): Promise<string> {
  const [row] = await getDb().select({ mark: professionalDocumentSettings.stampMark })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return row?.mark ?? "";
}

export async function saveStampMark(professionalId: string, stampMark: string): Promise<void> {
  // La versión sin fondo se genera a partir de la imagen guardada: si la imagen cambia, deja de valer.
  await getDb().insert(professionalDocumentSettings).values({ professionalId, stampMark, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { stampMark, stampClean: "", updatedAt: new Date().toISOString() } });
}

/** La imagen que se imprime: el timbre sin fondo si el profesional lo pidió (y existe); si no, el timbre guardado tal cual. */
const printable = (row: { mark: string; clean: string; layout: string }) => parseStampLayout(row.layout)?.knockout && row.clean ? row.clean : row.mark;

/** Timbre listo para imprimir en un documento (respeta «quitar fondo»). Quien llama lo trata como opcional. */
export async function loadPrintableStamp(professionalId: string): Promise<string> {
  const [row] = await getDb().select({ mark: professionalDocumentSettings.stampMark, clean: professionalDocumentSettings.stampClean, layout: professionalDocumentSettings.stampLayout })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return row ? printable(row) : "";
}

/** Timbres de varios autores a la vez (listas de documentos), listos para imprimir. Mapa vacío si no hay ninguno. */
export async function loadStampMarks(professionalIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(professionalIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await getDb().select({ id: professionalDocumentSettings.professionalId, mark: professionalDocumentSettings.stampMark, clean: professionalDocumentSettings.stampClean, layout: professionalDocumentSettings.stampLayout })
    .from(professionalDocumentSettings).where(inArray(professionalDocumentSettings.professionalId, ids));
  return new Map(rows.map(row => [row.id, printable(row)] as const).filter(([, mark]) => mark));
}

/** ¿Hay un timbre sin fondo guardado? (el editor lo regenera solo si falta). */
export async function hasStampClean(professionalId: string): Promise<boolean> {
  const [row] = await getDb().select({ clean: professionalDocumentSettings.stampClean })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return !!row?.clean;
}

export async function saveStampClean(professionalId: string, stampClean: string): Promise<void> {
  await getDb().insert(professionalDocumentSettings).values({ professionalId, stampClean, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { stampClean, updatedAt: new Date().toISOString() } });
}

/** Diseño de firma y timbre (más la imagen unida, si el profesional la pidió). Quien llama lo trata como opcional: si falla, todo queda como siempre. */
export async function loadStampLayout(professionalId: string): Promise<PrintableStampLayout | null> {
  const [row] = await getDb().select({ layout: professionalDocumentSettings.stampLayout, merged: professionalDocumentSettings.mergedMark })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return withMerged(parseStampLayout(row?.layout), row?.merged ?? "");
}

const withMerged = (layout: StampLayout | null, merged: string): PrintableStampLayout | null => layout && layout.merged && merged ? { ...layout, mergedMark: merged } : layout;

export async function saveStampLayout(professionalId: string, layout: StampLayout): Promise<void> {
  const stampLayout = serializeStampLayout(layout);
  await getDb().insert(professionalDocumentSettings).values({ professionalId, stampLayout, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { stampLayout, updatedAt: new Date().toISOString() } });
}

export async function loadStampLayouts(professionalIds: string[]): Promise<Map<string, PrintableStampLayout>> {
  const ids = [...new Set(professionalIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await getDb().select({ id: professionalDocumentSettings.professionalId, layout: professionalDocumentSettings.stampLayout, merged: professionalDocumentSettings.mergedMark })
    .from(professionalDocumentSettings).where(inArray(professionalDocumentSettings.professionalId, ids));
  const map = new Map<string, PrintableStampLayout>();
  for (const row of rows) { const layout = withMerged(parseStampLayout(row.layout), row.merged); if (layout) map.set(row.id, layout); }
  return map;
}

/** ¿Hay una imagen firma+timbre unida guardada? */
export async function hasMergedMark(professionalId: string): Promise<boolean> {
  const [row] = await getDb().select({ merged: professionalDocumentSettings.mergedMark })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return !!row?.merged;
}

export async function saveMergedMark(professionalId: string, mergedMark: string): Promise<void> {
  await getDb().insert(professionalDocumentSettings).values({ professionalId, mergedMark, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { mergedMark, updatedAt: new Date().toISOString() } });
}

/** Si cambia la firma o el timbre, la imagen unida ya no vale: se borra y «unir» se apaga hasta pedirlo de nuevo. */
export async function invalidateMerged(professionalId: string): Promise<void> {
  const layout = await loadStampLayout(professionalId);
  await saveMergedMark(professionalId, "");
  if (layout?.merged) await saveStampLayout(professionalId, { ...layout, merged: false, mergedBox: null });
}
