CREATE TABLE IF NOT EXISTS `patient_intake_public_links` (
  `owner_id` text PRIMARY KEY NOT NULL,
  `public_token` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_intake_public_links_token_idx` ON `patient_intake_public_links` (`public_token`);
