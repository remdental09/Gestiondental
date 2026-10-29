CREATE TABLE `drive_backups` (
	`patient_id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text NOT NULL,
	`snapshot_digest` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `drive_backups_owner_idx` ON `drive_backups` (`owner_id`);