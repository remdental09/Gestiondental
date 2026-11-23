-- Equipo compartido (cibercafé, aeropuerto): la sesión marca si es de un equipo ajeno para vencer a los 15 min sin uso y a las 2 horas. Solo agrega una columna.
ALTER TABLE `auth_sessions` ADD `shared` integer DEFAULT 0 NOT NULL;
