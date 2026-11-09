ALTER TABLE `bot_logins` ADD `claim` text;--> statement-breakpoint
ALTER TABLE `members` ADD `student_id` text;--> statement-breakpoint
ALTER TABLE `members` ADD `graduation_month` integer DEFAULT 9 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `members_student_id_unique` ON `members` (`student_id`);