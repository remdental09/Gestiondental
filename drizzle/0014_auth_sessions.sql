-- Fase 3: sesiones propias (reemplazo de Cloudflare Access) y límite de intentos de inicio de sesión. Solo agrega tablas.
CREATE TABLE IF NOT EXISTS `auth_sessions` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL, `name` text DEFAULT '' NOT NULL, `created_at` integer NOT NULL, `last_seen_at` integer NOT NULL, `expires_at` integer NOT NULL, `revoked_at` integer);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_sessions_email_idx` ON `auth_sessions` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_rate_limits` (`key` text PRIMARY KEY NOT NULL, `window_start` integer NOT NULL, `count` integer NOT NULL);
