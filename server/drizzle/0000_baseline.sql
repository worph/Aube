CREATE TABLE `brief_blocks` (
	`run_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`open_end` integer DEFAULT false NOT NULL,
	`crosses_midnight` integer DEFAULT false NOT NULL,
	`overlaps_event` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`run_id`, `idx`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brief_events` (
	`run_id` integer NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`start_min` integer,
	`end_min` integer,
	`open_end` integer DEFAULT false NOT NULL,
	`crosses_midnight` integer DEFAULT false NOT NULL,
	`location` text,
	`source` text,
	PRIMARY KEY(`run_id`, `idx`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `briefs` (
	`run_id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`headline` text NOT NULL,
	`markdown` text NOT NULL,
	`shape` text NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`memory_notes` text,
	`items_dropped` integer DEFAULT 0 NOT NULL,
	`as_of` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `briefs_date` ON `briefs` (`date`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tool` text,
	`args` text,
	`result` text,
	`ok` integer,
	`confirm_with` text,
	`confirmed_at` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`action` text NOT NULL,
	`before_blob` text,
	`after_blob` text,
	`encoding` text DEFAULT 'utf8' NOT NULL,
	`by` text NOT NULL,
	`run_id` integer,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_journal_path` ON `memory_journal` (`path`);--> statement-breakpoint
CREATE INDEX `memory_journal_run` ON `memory_journal` (`run_id`);--> statement-breakpoint
CREATE TABLE `notify_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prompt_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`body` text NOT NULL,
	`saved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`saved_by` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `push_subs` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`keys_json` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_ok_at` text
);
--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_artifacts_run` ON `run_artifacts` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`tool_mode` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`ready_at` text,
	`notified_at` text,
	`failure_class` text,
	`failure_text` text,
	`prompt_version_id` integer,
	`system_hash` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`memory_readonly` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_date` ON `runs` (`date`);