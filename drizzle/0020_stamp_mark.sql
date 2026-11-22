-- Timbre del profesional: imagen que se imprime bajo la firma. Solo agrega una columna.
ALTER TABLE `professional_document_settings` ADD `stamp_mark` text DEFAULT '' NOT NULL;
