-- Cuotas de almacenamiento R2 por espacio (owner_id).
-- Plan «gratis»: 500 MB (524 288 000 bytes). La columna plan_name permite ampliar a plan pagado sin desplegar.
CREATE TABLE IF NOT EXISTS `space_quotas` (
	`owner_id` text NOT NULL,
	`plan_name` text NOT NULL DEFAULT 'gratis',
	`quota_bytes` integer NOT NULL DEFAULT 524288000,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`)
);
