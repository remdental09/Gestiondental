-- GES-11: «a quién llamar». Marca de contacto por paciente y lista (sin datos clínicos). Solo agrega tablas.
CREATE TABLE IF NOT EXISTS `call_contacts` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `owner_id` text NOT NULL, `patient_id` integer NOT NULL, `list` text NOT NULL, `contacted_at` text NOT NULL, `contacted_by` text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `call_contacts_owner_idx` ON `call_contacts` (`owner_id`, `patient_id`, `list`);
