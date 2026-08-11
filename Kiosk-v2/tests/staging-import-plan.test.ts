import assert from "node:assert/strict";
import test from "node:test";

import { reconcileSourceSnapshot, type SourceSnapshot } from "../lib/sync/reconciliation.ts";
import { buildStagingImportPlan } from "../lib/sync/staging-import-plan.ts";

const secret = "test-only-secret-value-with-more-than-thirty-two-characters";

function source(): SourceSnapshot {
  return {
    users: [{
      rowNumber: 2,
      name: "Maria Maker",
      timestamp: "2026-01-02",
      cardUid: "04-aa-bb-cc-dd",
      identifier: "A12345678",
      userType: "",
      email: "maker@ucsd.edu",
      secondaryEmail: "",
      waiverSigned: "",
      training: { "Epilog Laser Cutter": true },
    }],
    waivers: [{
      rowNumber: 2,
      name: "Maria Maker",
      email: "maker@ucsd.edu",
      dateSigned: "2026-01-03",
      aNumber: "A12345678",
    }],
    activity: [
      { rowNumber: 2, date: "2026-01-04", epochTime: "1767513600", cardUid: "04-aa-bb-cc-dd", eventType: "User Checkin" },
      { rowNumber: 3, date: "2026-01-04", epochTime: "1767513601", cardUid: "unknown-card", eventType: "User Checkin" },
    ],
    internalTraining: [],
  };
}

test("builds deterministic staging records and never persists a raw card UID", async () => {
  const snapshot = source();
  const reconciliation = reconcileSourceSnapshot(snapshot);
  const args = {
    snapshot,
    reconciliation,
    secret,
    sourceSnapshotAt: "2026-08-11T12:00:00.000Z",
    approvedAt: "2026-08-11T12:05:00.000Z",
    accessRoster: { staffRoles: 6, trainerAuthorizations: 6 },
  };
  const first = await buildStagingImportPlan(args);
  const second = await buildStagingImportPlan(args);

  assert.deepEqual(first, second);
  assert.equal(first.users.length, 1);
  assert.equal(first.cards.length, 1);
  assert.equal(first.visits.length, 1);
  assert.equal(first.quarantinedActivityEvents.length, 1);
  assert.equal(first.waivers[0].status, "signed");
  assert.equal(first.trainingRecords[0].fabmanSyncRequired, true);
  assert.equal(first.users[0].userType, "unknown");
  assert.equal(first.users[0].affiliation, "Needs profile update");
  assert.doesNotMatch(JSON.stringify(first.cards), /04-aa-bb-cc-dd/i);
  assert.doesNotMatch(JSON.stringify(first.quarantinedActivityEvents), /unknown-card/i);
});

test("rejects a weak hashing secret", async () => {
  const snapshot = source();
  const reconciliation = reconcileSourceSnapshot(snapshot);
  await assert.rejects(
    buildStagingImportPlan({
      snapshot,
      reconciliation,
      secret: "too-short",
      sourceSnapshotAt: "2026-08-11T12:00:00.000Z",
      approvedAt: "2026-08-11T12:05:00.000Z",
    }),
    /at least 32 characters/,
  );
});
