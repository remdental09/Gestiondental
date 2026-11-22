CREATE INDEX IF NOT EXISTS `budgets_owner_id_idx` ON `budgets` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `appointments_owner_day_idx` ON `appointments` (`owner_id`,`day`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `periodontal_owner_id_idx` ON `periodontal_exams` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tooth_statuses_owner_patient_idx` ON `tooth_statuses` (`owner_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `images_owner_id_idx` ON `clinical_images` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `evolution_diagnoses_owner_id_idx` ON `evolution_diagnoses` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `evolutions_owner_date_idx` ON `evolutions` (`owner_id`,`clinical_date`,`recorded_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payments_owner_paid_idx` ON `payments` (`owner_id`,`paid_on`,`id`);
