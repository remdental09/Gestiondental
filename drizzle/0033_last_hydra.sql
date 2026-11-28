CREATE TABLE `patient_intake_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL,
  `used_at` text,
  `patient_id` integer,
  FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_intake_links_token_idx` ON `patient_intake_links` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `patient_intake_links_owner_created_idx` ON `patient_intake_links` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `patient_intake_links_patient_idx` ON `patient_intake_links` (`patient_id`);
