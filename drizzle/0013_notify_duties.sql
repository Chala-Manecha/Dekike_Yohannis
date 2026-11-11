CREATE TABLE `event_duties` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`duty` text NOT NULL,
	`member_id` text NOT NULL,
	`assigned_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_duties_unique` ON `event_duties` (`event_id`,`duty`,`member_id`);--> statement-breakpoint
CREATE INDEX `event_duties_event_idx` ON `event_duties` (`event_id`);--> statement-breakpoint
ALTER TABLE `user` ADD `bot_notify` integer DEFAULT true NOT NULL;