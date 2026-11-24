-- Imagen firma+timbre unida en una sola pieza (PNG con transparencia, generada en el navegador); vacío = no hay. Solo agrega una columna.
ALTER TABLE `professional_document_settings` ADD `merged_mark` text DEFAULT '' NOT NULL;
