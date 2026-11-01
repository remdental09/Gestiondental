-- Anulación de evoluciones (error clínico): la evolución queda tachada con motivo, fecha y autor.
-- Solo agrega columnas: las evoluciones existentes quedan «vigente».
ALTER TABLE `evolutions` ADD `status` text DEFAULT 'vigente' NOT NULL;
--> statement-breakpoint
ALTER TABLE `evolutions` ADD `annulled_at` text;
--> statement-breakpoint
ALTER TABLE `evolutions` ADD `annulled_by` text;
--> statement-breakpoint
ALTER TABLE `evolutions` ADD `annul_reason` text;
--> statement-breakpoint
ALTER TABLE `evolutions` ADD `replaces_id` integer;
