import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { professionalDocumentSettings } from "@/db/schema";
import { parseStampLayout, serializeStampLayout, type StampLayout } from "@/lib/stamp-layout";

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
  await getDb().insert(professionalDocumentSettings).values({ professionalId, stampMark, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { stampMark, updatedAt: new Date().toISOString() } });
}

/** Timbres de varios autores a la vez (listas de documentos). Mapa vacío si no hay ninguno. */
export async function loadStampMarks(professionalIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(professionalIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await getDb().select({ id: professionalDocumentSettings.professionalId, mark: professionalDocumentSettings.stampMark })
    .from(professionalDocumentSettings).where(inArray(professionalDocumentSettings.professionalId, ids));
  return new Map(rows.filter(row => row.mark).map(row => [row.id, row.mark]));
}

/** Posición y tamaño del timbre. Quien llama lo trata como opcional: si falla, el timbre queda en su lugar de siempre. */
export async function loadStampLayout(professionalId: string): Promise<StampLayout | null> {
  const [row] = await getDb().select({ layout: professionalDocumentSettings.stampLayout })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return parseStampLayout(row?.layout);
}

export async function saveStampLayout(professionalId: string, layout: StampLayout): Promise<void> {
  const stampLayout = serializeStampLayout(layout);
  await getDb().insert(professionalDocumentSettings).values({ professionalId, stampLayout, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { stampLayout, updatedAt: new Date().toISOString() } });
}

export async function loadStampLayouts(professionalIds: string[]): Promise<Map<string, StampLayout>> {
  const ids = [...new Set(professionalIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await getDb().select({ id: professionalDocumentSettings.professionalId, layout: professionalDocumentSettings.stampLayout })
    .from(professionalDocumentSettings).where(inArray(professionalDocumentSettings.professionalId, ids));
  const map = new Map<string, StampLayout>();
  for (const row of rows) { const layout = parseStampLayout(row.layout); if (layout) map.set(row.id, layout); }
  return map;
}
