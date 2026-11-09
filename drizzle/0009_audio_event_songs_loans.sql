CREATE TABLE `event_songs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`song_id` text NOT NULL,
	`sort` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_songs_unique` ON `event_songs` (`event_id`,`song_id`);--> statement-breakpoint
CREATE INDEX `event_songs_event_idx` ON `event_songs` (`event_id`,`sort`);--> statement-breakpoint
CREATE TABLE `property_loans` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`borrower` text NOT NULL,
	`phone` text,
	`quantity` integer NOT NULL,
	`out_date` text NOT NULL,
	`due_date` text,
	`note` text,
	`returned_at` integer,
	`created_by` text,
	`returned_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `property_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `property_loans_item_idx` ON `property_loans` (`item_id`,`returned_at`);--> statement-breakpoint
ALTER TABLE `songs` ADD `audio_key` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `audio_type` text;--> statement-breakpoint
ALTER TABLE `songs` ADD `audio_size` integer;