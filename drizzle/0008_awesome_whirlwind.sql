CREATE TABLE IF NOT EXISTS `patient_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'borrador' NOT NULL,
	`created_by` text NOT NULL,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `patient_documents_owner_patient_idx` ON `patient_documents` (`owner_id`,`patient_id`,`id`);
