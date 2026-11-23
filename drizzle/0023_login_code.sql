-- Código de ingreso por correo: cada sesión nueva queda pendiente hasta escribir el código (solo se guarda su hash). Solo agrega columnas; las sesiones existentes quedan confirmadas.
ALTER TABLE `auth_sessions` ADD `verified` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `code_hash` text;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `code_expires_at` integer;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `code_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `code_sent_at` integer;
