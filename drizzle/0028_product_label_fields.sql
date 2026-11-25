-- Productos biomédicos: todos los datos de la etiqueta y del código. Solo agrega columnas.
ALTER TABLE `biomedical_products` ADD COLUMN `model` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `diameter` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `length` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `registration` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `manufactured` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `gtin` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `details` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `biomedical_products` ADD COLUMN `code` text DEFAULT '' NOT NULL;
