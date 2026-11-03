ALTER TABLE `briefs` ADD `wake_time` text;--> statement-breakpoint
ALTER TABLE `briefs` ADD `wake_reason` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `phase` text DEFAULT 'morning' NOT NULL;