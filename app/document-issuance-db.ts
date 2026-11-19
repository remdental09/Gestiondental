import { env } from "cloudflare:workers";

type Db = { prepare(sql: string): { run(): Promise<unknown> } };
let ready: Promise<void> | null = null;

/** Columnas de emisión de documentos (QR). Se agregan una sola vez; si ya existen, el error se ignora (mismo patrón que el perfil clínico). */
export function ensureDocumentIssuanceColumns(): Promise<void> {
  if (ready) return ready;
  const database = (env as unknown as { DB?: Db }).DB;
  if (!database) return Promise.resolve();
  ready = (async () => {
    for (const column of ["verify_token text", "content_hash text NOT NULL DEFAULT ''", "issued_at text NOT NULL DEFAULT ''", "revoked_at text NOT NULL DEFAULT ''", "revoked_reason text NOT NULL DEFAULT ''", "replaces_id integer"]) {
      await database.prepare(`ALTER TABLE patient_documents ADD COLUMN ${column}`).run().catch(() => undefined);
    }
    await database.prepare("CREATE UNIQUE INDEX IF NOT EXISTS patient_documents_verify_token_idx ON patient_documents (verify_token)").run().catch(() => undefined);
  })().catch(() => { ready = null; });
  return ready;
}
