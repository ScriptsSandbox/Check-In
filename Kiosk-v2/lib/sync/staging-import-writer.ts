import { eq, inArray } from "drizzle-orm";

import { getDb } from "../../db/index.ts";
import {
  auditEvents,
  cards,
  migrationRuns,
  migrationSourceRecords,
  quarantinedActivityEvents,
  tools,
  trainingRecords,
  userIdentifiers,
  users,
  visits,
  waiverStatuses,
} from "../../db/schema.ts";
import type { MigrationProvenanceInsert, StagingImportPlan } from "./staging-import-plan.ts";
import { chunkItems, safeImportError } from "./staging-import-utils.ts";

type Database = ReturnType<typeof getDb>;
type BatchQuery = Parameters<Database["batch"]>[0][number];

async function executeBatches(db: Database, queries: BatchQuery[]) {
  for (const chunk of chunkItems(queries)) {
    if (chunk.length === 0) continue;
    await db.batch(chunk as [BatchQuery, ...BatchQuery[]]);
  }
}

function provenanceByEntity(plan: StagingImportPlan) {
  const map = new Map<string, MigrationProvenanceInsert[]>();
  for (const record of plan.provenance) {
    const key = `${record.entityType}\u0000${record.entityId}`;
    const group = map.get(key) ?? [];
    group.push(record);
    map.set(key, group);
  }
  return map;
}

export async function applyStagingImportPlan(
  plan: StagingImportPlan,
  db: Database = getDb(),
): Promise<{ runId: string; status: "completed" | "already_completed" }> {
  if (plan.run.mode !== "staging") throw new Error("Only staging import plans are accepted.");
  const [existing] = await db
    .select({ id: migrationRuns.id, status: migrationRuns.status })
    .from(migrationRuns)
    .where(eq(migrationRuns.id, plan.run.id))
    .limit(1);

  if (existing?.status === "completed") {
    return { runId: plan.run.id, status: "already_completed" };
  }
  if (existing) {
    throw new Error("This migration run already exists and must be rolled back before retrying.");
  }

  const startedAt = new Date().toISOString();
  await db.insert(migrationRuns).values({ ...plan.run, status: "running", startedAt });
  const sourceByEntity = provenanceByEntity(plan);

  function provenanceQueries(entityType: string, entityId: string): BatchQuery[] {
    return (sourceByEntity.get(`${entityType}\u0000${entityId}`) ?? []).map((record) =>
      db.insert(migrationSourceRecords).values(record),
    );
  }

  try {
    await executeBatches(
      db,
      plan.tools.map((record) => db.insert(tools).values(record).onConflictDoNothing()),
    );

    const orderedQueries: BatchQuery[] = [];
    for (const record of plan.users) {
      orderedQueries.push(db.insert(users).values(record), ...provenanceQueries("user", record.id));
    }
    for (const record of plan.identifiers) {
      orderedQueries.push(
        db.insert(userIdentifiers).values(record),
        ...provenanceQueries("user_identifier", record.id),
      );
    }
    for (const record of plan.cards) {
      orderedQueries.push(db.insert(cards).values(record), ...provenanceQueries("card", record.id));
    }
    for (const record of plan.waivers) {
      orderedQueries.push(
        db.insert(waiverStatuses).values(record),
        ...provenanceQueries("waiver_status", record.id),
      );
    }
    for (const record of plan.trainingRecords) {
      orderedQueries.push(
        db.insert(trainingRecords).values(record),
        ...provenanceQueries("training_record", record.id),
      );
    }
    for (const record of plan.visits) {
      orderedQueries.push(db.insert(visits).values(record), ...provenanceQueries("visit", record.id));
    }
    for (const record of plan.auditEvents) {
      orderedQueries.push(
        db.insert(auditEvents).values(record),
        ...provenanceQueries("audit_event", record.id),
      );
    }
    for (const record of plan.quarantinedActivityEvents) {
      orderedQueries.push(
        db.insert(quarantinedActivityEvents).values(record),
        ...provenanceQueries("quarantined_activity_event", record.id),
      );
    }
    await executeBatches(db, orderedQueries);
    await db
      .update(migrationRuns)
      .set({ status: "completed", completedAt: new Date().toISOString() })
      .where(eq(migrationRuns.id, plan.run.id));
    return { runId: plan.run.id, status: "completed" };
  } catch (error) {
    const safe = safeImportError(error);
    await db
      .update(migrationRuns)
      .set({ status: "failed", ...safe })
      .where(eq(migrationRuns.id, plan.run.id));
    throw new Error(`${safe.errorCode}: ${safe.errorDetail}`);
  }
}

export async function rollbackStagingImport(
  runId: string,
  db: Database = getDb(),
): Promise<void> {
  const sources = await db
    .select({ entityType: migrationSourceRecords.entityType, entityId: migrationSourceRecords.entityId })
    .from(migrationSourceRecords)
    .where(eq(migrationSourceRecords.migrationRunId, runId));
  const ids = (entityType: string) => [
    ...new Set(sources.filter((row) => row.entityType === entityType).map((row) => row.entityId)),
  ];

  async function deleteChunked(
    entityIds: string[],
    remove: (chunk: string[]) => BatchQuery,
  ) {
    await executeBatches(db, chunkItems(entityIds, 80).map(remove));
  }

  await deleteChunked(ids("visit"), (chunk) => db.delete(visits).where(inArray(visits.id, chunk)));
  await deleteChunked(ids("training_record"), (chunk) =>
    db.delete(trainingRecords).where(inArray(trainingRecords.id, chunk)));
  await deleteChunked(ids("waiver_status"), (chunk) =>
    db.delete(waiverStatuses).where(inArray(waiverStatuses.id, chunk)));
  await deleteChunked(ids("card"), (chunk) => db.delete(cards).where(inArray(cards.id, chunk)));
  await deleteChunked(ids("user_identifier"), (chunk) =>
    db.delete(userIdentifiers).where(inArray(userIdentifiers.id, chunk)));
  await deleteChunked(ids("audit_event"), (chunk) =>
    db.delete(auditEvents).where(inArray(auditEvents.id, chunk)));
  await deleteChunked(ids("quarantined_activity_event"), (chunk) =>
    db.delete(quarantinedActivityEvents).where(inArray(quarantinedActivityEvents.id, chunk)));
  await deleteChunked(ids("user"), (chunk) => db.delete(users).where(inArray(users.id, chunk)));
  await db.delete(migrationSourceRecords).where(eq(migrationSourceRecords.migrationRunId, runId));
  await db
    .update(migrationRuns)
    .set({ status: "rolled_back", rolledBackAt: new Date().toISOString() })
    .where(eq(migrationRuns.id, runId));
}
