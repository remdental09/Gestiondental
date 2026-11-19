CREATE TABLE IF NOT EXISTS `dictation_health_daily` (
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`stage` text NOT NULL,
	`event` text NOT NULL,
	`platform` text NOT NULL,
	`error_code` text DEFAULT 'none' NOT NULL,
	`duration_bucket` text DEFAULT 'none' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `day`, `stage`, `event`, `platform`, `error_code`, `duration_bucket`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `dictation_health_daily_day_idx` ON `dictation_health_daily` (`day`);
