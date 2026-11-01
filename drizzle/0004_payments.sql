CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`budget_id` integer,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`concept` text DEFAULT '' NOT NULL,
	`paid_on` text NOT NULL,
	`request_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_patient_idx` ON `payments` (`patient_id`,`paid_on`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_owner_request_unique` ON `payments` (`owner_id`,`request_id`);
