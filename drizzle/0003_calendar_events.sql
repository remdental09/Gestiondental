CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`title` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`source_time_zone` text DEFAULT 'America/Santiago' NOT NULL,
	`html_link` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`patient_id` integer,
	`imported_at` text NOT NULL,
	`source_updated_at` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_owner_source_unique` ON `calendar_events` (`owner_id`,`calendar_id`,`google_event_id`);
--> statement-breakpoint
CREATE INDEX `calendar_events_owner_start_idx` ON `calendar_events` (`owner_id`,`start_at`);