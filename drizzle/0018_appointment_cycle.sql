-- GES-10: ciclo de la cita (horas de llegada / entrada a box / término) y lista de espera. Solo agrega tablas.
CREATE TABLE IF NOT EXISTS `appointment_times` (`owner_id` text NOT NULL, `source` text NOT NULL, `ref_id` integer NOT NULL, `arrived_at` text, `in_box_at` text, `done_at` text, `updated_at` text NOT NULL, PRIMARY KEY (`owner_id`, `source`, `ref_id`));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `waitlist_entries` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `owner_id` text NOT NULL, `patient_id` integer, `name` text DEFAULT '' NOT NULL, `phone` text DEFAULT '' NOT NULL, `preference` text DEFAULT 'cualquiera' NOT NULL, `note` text DEFAULT '' NOT NULL, `created_at` text NOT NULL, `created_by` text, `removed_at` text);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `waitlist_entries_owner_idx` ON `waitlist_entries` (`owner_id`, `removed_at`);
