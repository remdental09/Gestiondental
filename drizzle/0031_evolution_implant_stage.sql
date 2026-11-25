-- Implantología: la evolución compilada de una etapa queda vinculada al implante y a la fase, para poder
-- mostrarla dentro del propio módulo (no es una nota aparte: es la misma tabla de evolución general).
ALTER TABLE `evolutions` ADD COLUMN `implant_id` integer REFERENCES `implants`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `evolutions` ADD COLUMN `stage_phase` text;
--> statement-breakpoint
CREATE INDEX `evolutions_implant_phase_idx` ON `evolutions` (`implant_id`, `stage_phase`);
