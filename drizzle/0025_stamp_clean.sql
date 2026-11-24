-- Timbre sin fondo (PNG con transparencia generado a partir del timbre guardado); vacío = no hay. Solo agrega una columna.
ALTER TABLE `professional_document_settings` ADD `stamp_clean` text DEFAULT '' NOT NULL;
