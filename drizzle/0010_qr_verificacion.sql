ALTER TABLE `patient_documents` ADD `verify_token` text;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `issued_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `revoked_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `revoked_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `replaces_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `patient_documents_verify_token_idx` ON `patient_documents` (`verify_token`);