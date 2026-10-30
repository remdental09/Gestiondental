declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_POLICY_AUD?: string;
    ACCESS_ALLOWED_EMAIL?: string;
    CLINIC_OWNER_ID?: string;
  }
}
