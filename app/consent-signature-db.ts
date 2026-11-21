import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { consentSignatures } from "@/db/schema";
import { isSignLinkActive, type SignatureView } from "@/lib/consent-signature";

type Db = { prepare(sql: string): { run(): Promise<unknown> } };
let ready: Promise<void> | null = null;

/** Crea la tabla de firmas si aún no existe (mismo patrón que las columnas de emisión): no depende de que el workflow haya corrido la migración. */
export function ensureConsentSignatureTable(): Promise<void> {
  if (ready) return ready;
  const database = (env as unknown as { DB?: Db }).DB;
  if (!database) return Promise.resolve();
  ready = (async () => {
    await database.prepare("CREATE TABLE IF NOT EXISTS consent_signatures (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, document_id integer NOT NULL REFERENCES patient_documents(id), owner_id text NOT NULL, patient_id integer NOT NULL REFERENCES patients(id), status text NOT NULL, token_hash text, token_expires_at text NOT NULL DEFAULT '', signer_name text NOT NULL DEFAULT '', signer_role text NOT NULL DEFAULT '', signer_relation text NOT NULL DEFAULT '', image text NOT NULL DEFAULT '', signed_at text NOT NULL DEFAULT '', method text NOT NULL DEFAULT '', ip text NOT NULL DEFAULT '', user_agent text NOT NULL DEFAULT '', signature_hash text NOT NULL DEFAULT '', created_at text NOT NULL)").run();
    await database.prepare("CREATE INDEX IF NOT EXISTS consent_signatures_document_idx ON consent_signatures (document_id)").run();
    await database.prepare("CREATE INDEX IF NOT EXISTS consent_signatures_owner_patient_idx ON consent_signatures (owner_id, patient_id)").run();
    await database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS consent_signatures_token_idx ON consent_signatures (token_hash)").run();
    await database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS consent_signatures_one_signed_idx ON consent_signatures (document_id) WHERE status = 'firmado'").run();
  })().catch(() => { ready = null; });
  return ready;
}

type Row = typeof consentSignatures.$inferSelect;

export function signatureView(row: Row, now = new Date()): SignatureView {
  return {
    status: row.status === "firmado" ? "firmado" : "pendiente",
    signerName: row.signerName, signerRole: row.signerRole, signerRelation: row.signerRelation,
    image: row.image, signedAt: row.signedAt, method: row.method, signatureHash: row.signatureHash,
    tokenExpiresAt: row.tokenExpiresAt, linkActive: isSignLinkActive(row, now),
  };
}

/** Firma vigente de cada documento del paciente: la firmada si existe; si no, el enlace pendiente más reciente. */
export async function loadSignatureViews(ownerId: string, patientId: number): Promise<Map<number, SignatureView>> {
  const out = new Map<number, SignatureView>();
  await ensureConsentSignatureTable();
  const rows = await getDb().select().from(consentSignatures)
    .where(and(eq(consentSignatures.ownerId, ownerId), eq(consentSignatures.patientId, patientId)));
  for (const row of rows.sort((a, b) => a.id - b.id)) {
    if (row.status !== "firmado" && row.status !== "pendiente") continue;
    const current = out.get(row.documentId);
    if (current?.status === "firmado") continue;
    out.set(row.documentId, signatureView(row));
  }
  return out;
}
