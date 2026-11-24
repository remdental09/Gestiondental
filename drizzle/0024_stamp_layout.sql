-- Posición y tamaño del timbre (JSON {dx, dy, scale}); vacío = lugar de siempre. Solo agrega una columna.
ALTER TABLE `professional_document_settings` ADD `stamp_layout` text DEFAULT '' NOT NULL;
