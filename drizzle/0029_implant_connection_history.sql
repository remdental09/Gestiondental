-- Implantología: tipo de conexión e historial de etapas. Solo agrega columnas.
ALTER TABLE `implants` ADD COLUMN `connection` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `implants` ADD COLUMN `history` text DEFAULT '[]' NOT NULL;
