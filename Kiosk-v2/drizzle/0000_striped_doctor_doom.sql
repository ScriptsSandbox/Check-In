CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_email` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`detail_json` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity_at` ON `audit_events` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `card_link_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text,
	`code_digest` text NOT NULL,
	`code_last_two` text NOT NULL,
	`purpose` text DEFAULT 'initial_card' NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text,
	`completed_card_id` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`) REFERENCES `registration_applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_card_link_code_digest` ON `card_link_sessions` (`code_digest`);--> statement-breakpoint
CREATE INDEX `idx_card_link_user_open` ON `card_link_sessions` (`user_id`,`completed_at`,`expires_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`uid_digest` text NOT NULL,
	`uid_last_four` text NOT NULL,
	`card_type` text DEFAULT 'UCSD ID' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`issued_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`retired_at` text,
	`replaced_by_card_id` text,
	`linked_by_user_id` text,
	`source_system` text DEFAULT 'Kiosk' NOT NULL,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cards_uid_digest` ON `cards` (`uid_digest`);--> statement-breakpoint
CREATE INDEX `idx_cards_user_status` ON `cards` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `integration_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_name` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`attempted_at` text,
	`completed_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`external_record_id` text,
	`error_code` text,
	`error_detail` text
);
--> statement-breakpoint
CREATE INDEX `idx_sync_status_requested` ON `integration_sync_events` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_sync_entity` ON `integration_sync_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `registration_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'awaiting_waiver' NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`waiver_opened_at` text,
	`waiver_matched_at` text,
	`ready_for_card_at` text,
	`completed_at` text,
	`source` text DEFAULT 'website' NOT NULL,
	`consent_version` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_registration_status_submitted` ON `registration_applications` (`status`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `staff_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`heading` text NOT NULL,
	`body` text NOT NULL,
	`severity` text DEFAULT 'notice' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_staff_messages_active_window` ON `staff_messages` (`is_active`,`starts_at`,`ends_at`);--> statement-breakpoint
CREATE TABLE `staff_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`granted_by_user_id` text,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_staff_roles_user_role` ON `staff_roles` (`user_id`,`role`);--> statement-breakpoint
CREATE INDEX `idx_staff_roles_active` ON `staff_roles` (`is_active`,`role`);--> statement-breakpoint
CREATE TABLE `tools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`training_required` integer DEFAULT true NOT NULL,
	`fabman_managed` integer DEFAULT false NOT NULL,
	`fabman_resource_id` text,
	`website_visible` integer DEFAULT true NOT NULL,
	`kiosk_visible` integer DEFAULT true NOT NULL,
	`retired_at` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tools_name` ON `tools` (`name`);--> statement-breakpoint
CREATE INDEX `idx_tools_status_category` ON `tools` (`status`,`category`);--> statement-breakpoint
CREATE TABLE `trainer_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`trainer_user_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`granted_by_user_id` text,
	`granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`notes` text,
	FOREIGN KEY (`trainer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trainer_tool` ON `trainer_authorizations` (`trainer_user_id`,`tool_id`);--> statement-breakpoint
CREATE INDEX `idx_trainer_active_tool` ON `trainer_authorizations` (`is_active`,`tool_id`);--> statement-breakpoint
CREATE TABLE `training_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool_id` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`expires_at` text,
	`revoked_at` text,
	`revoked_by_user_id` text,
	`source_system` text DEFAULT 'Staff application' NOT NULL,
	`fabman_sync_required` integer DEFAULT false NOT NULL,
	`latest_sync_status` text,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_training_user_status` ON `training_records` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_training_tool_status` ON `training_records` (`tool_id`,`status`);--> statement-breakpoint
CREATE TABLE `user_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`identifier_type` text NOT NULL,
	`identifier_value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`valid_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`valid_to` text,
	`source_system` text DEFAULT 'Sandbox registration' NOT NULL,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_identifiers_type_value` ON `user_identifiers` (`identifier_type`,`normalized_value`);--> statement-breakpoint
CREATE INDEX `idx_user_identifiers_user_active` ON `user_identifiers` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`preferred_name` text,
	`display_name` text NOT NULL,
	`user_type` text NOT NULL,
	`affiliation` text NOT NULL,
	`primary_email` text NOT NULL,
	`secondary_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_primary_email` ON `users` (`primary_email`);--> statement-breakpoint
CREATE INDEX `idx_users_status_name` ON `users` (`status`,`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `visit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`actor_user_id` text,
	`kiosk_id` text,
	`online_at_event` integer DEFAULT true NOT NULL,
	`error_code` text,
	`detail` text,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visit_events_visit_at` ON `visit_events` (`visit_id`,`event_at`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text,
	`kiosk_id` text NOT NULL,
	`checked_in_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`checked_out_at` text,
	`checked_out_by_user_id` text,
	`checkout_method` text,
	`status` text DEFAULT 'present' NOT NULL,
	`online_at_checkin` integer DEFAULT true NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`source_system` text DEFAULT 'Kiosk' NOT NULL,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`checked_out_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visits_status_checkin` ON `visits` (`status`,`checked_in_at`);--> statement-breakpoint
CREATE INDEX `idx_visits_user_checkin` ON `visits` (`user_id`,`checked_in_at`);--> statement-breakpoint
CREATE TABLE `waiver_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`waiver_type` text DEFAULT 'General Makerspace Waiver' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`signed_at` text,
	`revoked_at` text,
	`source_system` text DEFAULT 'Waiver Signatures SIO' NOT NULL,
	`source_record_id` text,
	`last_verified_at` text,
	`verification_method` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_waiver_user_type` ON `waiver_statuses` (`user_id`,`waiver_type`);--> statement-breakpoint
CREATE INDEX `idx_waiver_status_verified` ON `waiver_statuses` (`status`,`last_verified_at`);
--> statement-breakpoint
PRAGMA optimize;
