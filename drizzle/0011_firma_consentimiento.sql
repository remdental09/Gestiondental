CREATE TABLE IF NOT EXISTS `consent_signatures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`status` text NOT NULL,
	`token_hash` text,
	`token_expires_at` text DEFAULT '' NOT NULL,
	`signer_name` text DEFAULT '' NOT NULL,
	`signer_role` text DEFAULT '' NOT NULL,
	`signer_relation` text DEFAULT '' NOT NULL,
	`image` text DEFAULT '' NOT NULL,
	`signed_at` text DEFAULT '' NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`user_agent` text DEFAULT '' NOT NULL,
	`signature_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `patient_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `consent_signatures_document_idx` ON `consent_signatures` (`document_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `consent_signatures_owner_patient_idx` ON `consent_signatures` (`owner_id`,`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `consent_signatures_token_idx` ON `consent_signatures` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `consent_signatures_one_signed_idx` ON `consent_signatures` (`document_id`) WHERE `status` = 'firmado';