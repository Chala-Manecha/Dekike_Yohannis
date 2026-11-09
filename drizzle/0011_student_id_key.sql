ALTER TABLE `members` ADD `student_id_key` text;--> statement-breakpoint
-- Fill in the key for existing members: upper-case, letters and digits only (same as studentIdKey())
UPDATE `members` SET `student_id_key` = UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`student_id`, '/', ''), '-', ''), ' ', ''), '.', ''), '_', '')) WHERE `student_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_student_id_key_unique` ON `members` (`student_id_key`);
