CREATE TABLE IF NOT EXISTS `professional_document_settings` (
	`professional_id` text PRIMARY KEY NOT NULL,
	`document_mark` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
