CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`course` text NOT NULL,
	`department` text NOT NULL,
	`study_year` integer,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`uploaded_by` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `materials_status_idx` ON `materials` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `materials_filter_idx` ON `materials` (`status`,`department`,`study_year`);--> statement-breakpoint
CREATE INDEX `materials_uploader_idx` ON `materials` (`uploaded_by`);