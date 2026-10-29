CREATE TABLE `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`day` text NOT NULL,
	`time` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_patient_day_idx` ON `appointments` (`patient_id`,`day`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`title` text NOT NULL,
	`items` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `budgets_patient_idx` ON `budgets` (`patient_id`);--> statement-breakpoint
CREATE TABLE `clinical_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `images_patient_idx` ON `clinical_images` (`patient_id`);--> statement-breakpoint
CREATE TABLE `evolutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`clinical_date` text NOT NULL,
	`recorded_at` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_document_id` text,
	`backup_status` text DEFAULT 'not_configured' NOT NULL,
	`request_id` text,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evolutions_patient_date_idx` ON `evolutions` (`patient_id`,`clinical_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `evolutions_owner_request_unique` ON `evolutions` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`birth_date` text DEFAULT '' NOT NULL,
	`rut` text,
	`reason` text DEFAULT 'Evaluación' NOT NULL,
	`status` text DEFAULT 'Evaluación' NOT NULL,
	`allergies` text DEFAULT 'Sin registrar' NOT NULL,
	`history` text DEFAULT 'Sin registrar' NOT NULL,
	`drive_folder_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_owner_rut_unique` ON `patients` (`owner_id`,`rut`);--> statement-breakpoint
CREATE INDEX `patients_owner_name_idx` ON `patients` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `periodontal_exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`patient_id` integer NOT NULL,
	`recorded_at` text NOT NULL,
	`teeth` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `periodontal_patient_idx` ON `periodontal_exams` (`patient_id`);--> statement-breakpoint
CREATE TABLE `tooth_statuses` (
	`patient_id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
