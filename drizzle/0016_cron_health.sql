-- Fase 4: salud de las tareas automáticas (cron). Solo agrega una tabla.
CREATE TABLE IF NOT EXISTS `cron_health` (`job` text PRIMARY KEY NOT NULL, `last_run_at` text NOT NULL, `last_ok_at` text, `last_error_at` text, `last_error` text, `runs` integer DEFAULT 0 NOT NULL, `failures` integer DEFAULT 0 NOT NULL, `partial` integer DEFAULT 0 NOT NULL, `duration_ms` integer DEFAULT 0 NOT NULL);
