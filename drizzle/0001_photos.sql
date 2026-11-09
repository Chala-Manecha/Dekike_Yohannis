CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`caption` text,
	`featured` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `photos_event_idx` ON `photos` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `photos_featured_idx` ON `photos` (`featured`,`created_at`);