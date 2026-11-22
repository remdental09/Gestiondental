-- GES-10: auditoría de quién hizo cada cambio relevante dentro de una cuenta (citas, pagos, presupuestos, pacientes). Solo agrega una tabla.
CREATE TABLE IF NOT EXISTS `account_events` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `owner_id` text NOT NULL, `actor_id` text NOT NULL, `actor_email` text NOT NULL, `actor_role` text NOT NULL, `kind` text NOT NULL, `ref` text DEFAULT '' NOT NULL, `detail` text DEFAULT '' NOT NULL, `at` text NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_events_owner_at_idx` ON `account_events` (`owner_id`, `at`);
