-- Implantología: piezas, materiales y nota dentro de cada fase. Solo agrega columnas.
ALTER TABLE `biomedical_products` ADD COLUMN `implant_id` integer;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `stage` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `kind` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `implants` ADD COLUMN `stage_notes` text DEFAULT '{}' NOT NULL;
