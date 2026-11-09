CREATE TABLE `bot_logins` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`telegram_id` text,
	`name` text,
	`username` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bot_logins_expires_idx` ON `bot_logins` (`expires_at`);