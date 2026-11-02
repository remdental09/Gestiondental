declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Workers AI. Declarado en wrangler.cloudflare.jsonc; en local puede no existir. */
    AI?: Ai;
    /** Clave opcional de OpenAI, configurada como secreto del Worker. */
    OPENAI_API_KEY?: string;
    /** Modelo de bajo costo para corrección de texto; por defecto gpt-4o-mini. */
    OPENAI_TEXT_MODEL?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_POLICY_AUD?: string;
    ACCESS_ALLOWED_EMAIL?: string;
    CLINIC_OWNER_ID?: string;
    /** JSON correo → { ownerId, name }: una cuenta independiente por correo autorizado. */
    CLINIC_OWNERS?: string;
  }
}
