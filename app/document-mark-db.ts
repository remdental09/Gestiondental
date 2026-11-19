import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { professionalDocumentSettings } from "@/db/schema";

export async function loadDocumentMark(professionalId: string): Promise<string> {
  const [row] = await getDb().select({ mark: professionalDocumentSettings.documentMark })
    .from(professionalDocumentSettings).where(eq(professionalDocumentSettings.professionalId, professionalId)).limit(1);
  return row?.mark ?? "";
}

export async function saveDocumentMark(professionalId: string, documentMark: string): Promise<void> {
  await getDb().insert(professionalDocumentSettings).values({ professionalId, documentMark, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: professionalDocumentSettings.professionalId, set: { documentMark, updatedAt: new Date().toISOString() } });
}
