CREATE TABLE IF NOT EXISTS `signature_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`professional_id` text NOT NULL,
	`image` text NOT NULL,
	`action` text NOT NULL,
	`replaced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `signature_history_professional_idx` ON `signature_history` (`professional_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `signature_unlock` (
	`professional_id` text PRIMARY KEY NOT NULL,
	`code_hash` text DEFAULT '' NOT NULL,
	`expires_at` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`unlocked_until` text DEFAULT '' NOT NULL,
	`last_sent_at` text DEFAULT '' NOT NULL
);
