import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => text(name).notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    displayName: text("display_name").notNull(),
    userType: text("user_type").notNull(),
    affiliation: text("affiliation").notNull(),
    primaryEmail: text("primary_email").notNull(),
    secondaryEmail: text("secondary_email"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    notes: text("notes"),
  },
  (table) => [
    index("idx_users_primary_email").on(table.primaryEmail),
    index("idx_users_status_name").on(table.status, table.lastName, table.firstName),
  ],
);

export const userIdentifiers = sqliteTable(
  "user_identifiers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    identifierType: text("identifier_type").notNull(),
    identifierValue: text("identifier_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    validFrom: text("valid_from").notNull().default(sql`CURRENT_TIMESTAMP`),
    validTo: text("valid_to"),
    sourceSystem: text("source_system").notNull().default("Sandbox registration"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_user_identifiers_type_value").on(
      table.identifierType,
      table.normalizedValue,
    ),
    index("idx_user_identifiers_user_active").on(table.userId, table.isActive),
  ],
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    uidDigest: text("uid_digest").notNull(),
    uidLastFour: text("uid_last_four").notNull(),
    cardType: text("card_type").notNull().default("UCSD ID"),
    status: text("status").notNull().default("active"),
    issuedAt: text("issued_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    retiredAt: text("retired_at"),
    replacedByCardId: text("replaced_by_card_id"),
    linkedByUserId: text("linked_by_user_id"),
    sourceSystem: text("source_system").notNull().default("Kiosk"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_cards_uid_digest").on(table.uidDigest),
    index("idx_cards_user_status").on(table.userId, table.status),
  ],
);

export const waiverStatuses = sqliteTable(
  "waiver_statuses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    waiverType: text("waiver_type").notNull().default("General Makerspace Waiver"),
    status: text("status").notNull().default("pending"),
    signedAt: text("signed_at"),
    revokedAt: text("revoked_at"),
    sourceSystem: text("source_system").notNull().default("Waiver Signatures SIO"),
    sourceRecordId: text("source_record_id"),
    lastVerifiedAt: text("last_verified_at"),
    verificationMethod: text("verification_method"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_waiver_user_type").on(table.userId, table.waiverType),
    index("idx_waiver_status_verified").on(table.status, table.lastVerifiedAt),
  ],
);

export const registrationApplications = sqliteTable(
  "registration_applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("awaiting_waiver"),
    submittedAt: timestamp("submitted_at"),
    waiverOpenedAt: text("waiver_opened_at"),
    waiverMatchedAt: text("waiver_matched_at"),
    readyForCardAt: text("ready_for_card_at"),
    completedAt: text("completed_at"),
    source: text("source").notNull().default("website"),
    consentVersion: text("consent_version").notNull(),
    notes: text("notes"),
  },
  (table) => [index("idx_registration_status_submitted").on(table.status, table.submittedAt)],
);

export const cardLinkSessions = sqliteTable(
  "card_link_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicationId: text("application_id").references(() => registrationApplications.id, {
      onDelete: "set null",
    }),
    codeDigest: text("code_digest").notNull(),
    codeLastTwo: text("code_last_two").notNull(),
    purpose: text("purpose").notNull().default("initial_card"),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
    completedCardId: text("completed_card_id"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("idx_card_link_code_digest").on(table.codeDigest),
    index("idx_card_link_user_open").on(table.userId, table.completedAt, table.expiresAt),
  ],
);

export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("active"),
    trainingRequired: integer("training_required", { mode: "boolean" })
      .notNull()
      .default(true),
    fabmanManaged: integer("fabman_managed", { mode: "boolean" }).notNull().default(false),
    fabmanResourceId: text("fabman_resource_id"),
    websiteVisible: integer("website_visible", { mode: "boolean" }).notNull().default(true),
    kioskVisible: integer("kiosk_visible", { mode: "boolean" }).notNull().default(true),
    retiredAt: text("retired_at"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_tools_name").on(table.name),
    index("idx_tools_status_category").on(table.status, table.category),
  ],
);

export const staffRoles = sqliteTable(
  "staff_roles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    grantedByUserId: text("granted_by_user_id"),
    grantedAt: timestamp("granted_at"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    uniqueIndex("idx_staff_roles_user_role").on(table.userId, table.role),
    index("idx_staff_roles_active").on(table.isActive, table.role),
  ],
);

export const trainerAuthorizations = sqliteTable(
  "trainer_authorizations",
  {
    id: text("id").primaryKey(),
    trainerUserId: text("trainer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    grantedByUserId: text("granted_by_user_id"),
    grantedAt: timestamp("granted_at"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("idx_trainer_tool").on(table.trainerUserId, table.toolId),
    index("idx_trainer_active_tool").on(table.isActive, table.toolId),
  ],
);

export const trainingRecords = sqliteTable(
  "training_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("approved"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    approvedAt: text("approved_at"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id),
    sourceSystem: text("source_system").notNull().default("Staff application"),
    fabmanSyncRequired: integer("fabman_sync_required", { mode: "boolean" })
      .notNull()
      .default(false),
    latestSyncStatus: text("latest_sync_status"),
    notes: text("notes"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_training_user_status").on(table.userId, table.status),
    index("idx_training_tool_status").on(table.toolId, table.status),
  ],
);

export const visits = sqliteTable(
  "visits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    cardId: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    kioskId: text("kiosk_id").notNull(),
    checkedInAt: timestamp("checked_in_at"),
    checkedOutAt: text("checked_out_at"),
    checkedOutByUserId: text("checked_out_by_user_id").references(() => users.id),
    checkoutMethod: text("checkout_method"),
    status: text("status").notNull().default("present"),
    onlineAtCheckin: integer("online_at_checkin", { mode: "boolean" })
      .notNull()
      .default(true),
    syncStatus: text("sync_status").notNull().default("pending"),
    sourceSystem: text("source_system").notNull().default("Kiosk"),
    notes: text("notes"),
  },
  (table) => [
    index("idx_visits_status_checkin").on(table.status, table.checkedInAt),
    index("idx_visits_user_checkin").on(table.userId, table.checkedInAt),
  ],
);

export const visitEvents = sqliteTable(
  "visit_events",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventAt: timestamp("event_at"),
    actorUserId: text("actor_user_id").references(() => users.id),
    kioskId: text("kiosk_id"),
    onlineAtEvent: integer("online_at_event", { mode: "boolean" }).notNull().default(true),
    errorCode: text("error_code"),
    detail: text("detail"),
  },
  (table) => [index("idx_visit_events_visit_at").on(table.visitId, table.eventAt)],
);

export const staffMessages = sqliteTable(
  "staff_messages",
  {
    id: text("id").primaryKey(),
    heading: text("heading").notNull(),
    body: text("body").notNull(),
    severity: text("severity").notNull().default("notice"),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("idx_staff_messages_active_window").on(table.isActive, table.startsAt, table.endsAt)],
);

export const integrationSyncEvents = sqliteTable(
  "integration_sync_events",
  {
    id: text("id").primaryKey(),
    integrationName: text("integration_name").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    requestedAt: timestamp("requested_at"),
    attemptedAt: text("attempted_at"),
    completedAt: text("completed_at"),
    status: text("status").notNull().default("pending"),
    retryCount: integer("retry_count").notNull().default(0),
    externalRecordId: text("external_record_id"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
  },
  (table) => [
    index("idx_sync_status_requested").on(table.status, table.requestedAt),
    index("idx_sync_entity").on(table.entityType, table.entityId),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    occurredAt: timestamp("occurred_at"),
    detailJson: text("detail_json"),
  },
  (table) => [index("idx_audit_entity_at").on(table.entityType, table.entityId, table.occurredAt)],
);

export const migrationRuns = sqliteTable(
  "migration_runs",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull().default("staging"),
    status: text("status").notNull().default("planned"),
    sourceSnapshotAt: text("source_snapshot_at").notNull(),
    manifestJson: text("manifest_json").notNull(),
    approvedByUserId: text("approved_by_user_id").references(() => users.id),
    approvedAt: text("approved_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    rolledBackAt: text("rolled_back_at"),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("idx_migration_runs_status_created").on(table.status, table.createdAt),
  ],
);

export const migrationSourceRecords = sqliteTable(
  "migration_source_records",
  {
    id: text("id").primaryKey(),
    migrationRunId: text("migration_run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull().default("created"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("idx_migration_source_entity_row").on(
      table.migrationRunId,
      table.sourceSystem,
      table.sourceSheet,
      table.sourceRowNumber,
      table.entityType,
      table.entityId,
    ),
    index("idx_migration_source_run_entity").on(
      table.migrationRunId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const quarantinedActivityEvents = sqliteTable(
  "quarantined_activity_events",
  {
    id: text("id").primaryKey(),
    migrationRunId: text("migration_run_id")
      .notNull()
      .references(() => migrationRuns.id, { onDelete: "cascade" }),
    sourceSystem: text("source_system").notNull().default("Activity Log SIO"),
    sourceRowNumber: integer("source_row_number").notNull(),
    eventAt: text("event_at"),
    eventType: text("event_type").notNull(),
    cardUidDigest: text("card_uid_digest").notNull(),
    cardUidLastFour: text("card_uid_last_four").notNull(),
    quarantineReason: text("quarantine_reason").notNull(),
    detailJson: text("detail_json"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("idx_quarantine_source_row").on(
      table.migrationRunId,
      table.sourceSystem,
      table.sourceRowNumber,
    ),
    index("idx_quarantine_reason_event").on(table.quarantineReason, table.eventAt),
  ],
);
