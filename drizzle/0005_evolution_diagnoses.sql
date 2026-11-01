CREATE TABLE `evolution_diagnoses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`evolution_id` integer NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`tooth` integer,
	`findings` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT 'manual' NOT NULL,
	`suggested_from` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evolution_id`) REFERENCES `evolutions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evolution_diagnoses_evolution_idx` ON `evolution_diagnoses` (`evolution_id`);
--> statement-breakpoint
CREATE INDEX `evolution_diagnoses_patient_code_idx` ON `evolution_diagnoses` (`patient_id`,`code`);
