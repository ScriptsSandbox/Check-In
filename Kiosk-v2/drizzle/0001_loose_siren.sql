CREATE TABLE `migration_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'staging' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`source_snapshot_at` text NOT NULL,
	`manifest_json` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`started_at` text,
	`completed_at` text,
	`rolled_back_at` text,
	`error_code` text,
	`error_detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_migration_runs_status_created` ON `migration_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `migration_source_records` (
	`id` text PRIMARY KEY NOT NULL,
	`migration_run_id` text NOT NULL,
	`source_system` text NOT NULL,
	`source_sheet` text NOT NULL,
	`source_row_number` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text DEFAULT 'created' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`migration_run_id`) REFERENCES `migration_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_migration_source_entity_row` ON `migration_source_records` (`migration_run_id`,`source_system`,`source_sheet`,`source_row_number`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_migration_source_run_entity` ON `migration_source_records` (`migration_run_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `quarantined_activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`migration_run_id` text NOT NULL,
	`source_system` text DEFAULT 'Activity Log SIO' NOT NULL,
	`source_row_number` integer NOT NULL,
	`event_at` text,
	`event_type` text NOT NULL,
	`card_uid_digest` text NOT NULL,
	`card_uid_last_four` text NOT NULL,
	`quarantine_reason` text NOT NULL,
	`detail_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`migration_run_id`) REFERENCES `migration_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quarantine_source_row` ON `quarantined_activity_events` (`migration_run_id`,`source_system`,`source_row_number`);--> statement-breakpoint
CREATE INDEX `idx_quarantine_reason_event` ON `quarantined_activity_events` (`quarantine_reason`,`event_at`);--> statement-breakpoint
DROP INDEX `idx_users_primary_email`;--> statement-breakpoint
CREATE INDEX `idx_users_primary_email` ON `users` (`primary_email`);
--> statement-breakpoint
PRAGMA optimize;
