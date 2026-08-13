import assert from "node:assert/strict";
import test from "node:test";

import {
  createDryRunManifest,
  issuesToCsv,
  reconcileSourceSnapshot,
  type LegacyActivityRow,
  type LegacyUserRow,
  type SourceSnapshot,
} from "../lib/sync/reconciliation.ts";

function user(rowNumber: number, overrides: Partial<LegacyUserRow> = {}): LegacyUserRow {
  return {
    rowNumber,
    name: "María Maker",
    timestamp: `2026-08-${String(rowNumber).padStart(2, "0")}`,
    cardUid: `card-${rowNumber}`,
    identifier: `A0000000${rowNumber}`,
    userType: "",
    email: `maker${rowNumber}@ucsd.edu`,
    secondaryEmail: "",
    waiverSigned: "",
    training: { "Epilog Laser Cutter": false },
    ...overrides,
  };
}

function activity(rowNumber: number, overrides: Partial<LegacyActivityRow> = {}): LegacyActivityRow {
  return {
    rowNumber,
    date: "2026-08-11",
    epochTime: String(1_700_000_000 + rowNumber),
    cardUid: `card-${rowNumber}`,
    eventType: "User Checkin",
    ...overrides,
  };
}

function snapshot(overrides: Partial<SourceSnapshot> = {}): SourceSnapshot {
  return {
    users: [user(2)],
    waivers: [{ rowNumber: 2, name: "María Maker", email: "maker2@ucsd.edu", dateSigned: "2026-08-11", aNumber: "A00000002" }],
    activity: [activity(2)],
    internalTraining: [],
    ...overrides,
  };
}

test("builds a safe canonical account and manifest", () => {
  const result = reconcileSourceSnapshot(snapshot());
  const manifest = createDryRunManifest(result, { staffRoles: 6, trainerAuthorizations: 6 });

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].waiverMatch.status, "matched");
  assert.equal(result.metrics.linkedCheckins, 1);
  assert.equal(manifest.proposedCreates.canonicalAccounts, 1);
  assert.equal(manifest.proposedCreates.waiverConfirmedAccounts, 1);
  assert.equal(manifest.proposedCreates.staffRolesPendingEmailConfirmation, 6);
});

test("uses the latest repeated user row and merges cards and positive training", () => {
  const result = reconcileSourceSnapshot(snapshot({
    users: [
      user(2, { cardUid: "old-card", training: { "Epilog Laser Cutter": true } }),
      user(3, { identifier: "A00000002", email: "new@ucsd.edu", cardUid: "new-card" }),
    ],
  }));

  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].canonicalSourceRowNumber, 3);
  assert.deepEqual(result.accounts[0].sourceCardUids, ["old-card", "new-card"]);
  assert.deepEqual(result.accounts[0].positiveTrainingNames, ["Epilog Laser Cutter"]);
  assert.deepEqual(result.accounts[0].conflictingTrainingNames, ["Epilog Laser Cutter"]);
  assert.equal(result.metrics.duplicateUserGroups, 1);
});

test("quarantines a shared identifier when both name and email identify different people", () => {
  const result = reconcileSourceSnapshot(snapshot({
    users: [
      user(84, { name: "Natalie Levy", email: "nrlevy@ucsd.edu", identifier: "260053" }),
      user(243, { name: "Caitlyn Webster", email: "cwebster@ucsd.edu", identifier: "260053" }),
    ],
  }));

  assert.equal(result.accounts.length, 0);
  assert.ok(result.issues.some((issue) =>
    issue.type === "identifier_shared_across_people" && issue.severity === "blocker"
  ));
});

test("deduplicates a repeated card within one account", () => {
  const result = reconcileSourceSnapshot(snapshot({
    users: [user(2, { cardUid: "same-card" }), user(3, { identifier: "A00000002", cardUid: "same-card" })],
  }));

  assert.equal(result.metrics.sameAccountRepeatedCardGroups, 1);
  assert.equal(result.metrics.crossAccountCardGroups, 0);
  assert.equal(result.metrics.safeDistinctCards, 1);
});

test("blocks a card shared by different accounts", () => {
  const result = reconcileSourceSnapshot(snapshot({
    users: [user(2, { cardUid: "shared-card" }), user(3, { cardUid: "shared-card" })],
  }));

  assert.equal(result.metrics.crossAccountCardGroups, 1);
  assert.equal(result.metrics.safeDistinctCards, 0);
  assert.ok(result.issues.some((issue) => issue.type === "card_shared_across_accounts" && issue.severity === "blocker"));
});

test("quarantines activity whose card has no safe user match", () => {
  const result = reconcileSourceSnapshot(snapshot({
    activity: [activity(2, { cardUid: "unknown", eventType: "User Checkin" }), activity(3, { cardUid: "unknown", eventType: "New User" })],
  }));

  assert.equal(result.metrics.orphanCheckins, 1);
  assert.equal(result.metrics.orphanRegistrationEvents, 1);
  assert.equal(result.metrics.orphanActivityEvents, 2);
});

test("holds ambiguous waivers and accounts with no signed match", () => {
  const ambiguous = reconcileSourceSnapshot(snapshot({
    waivers: [
      { rowNumber: 2, name: "María Maker", email: "maker2@ucsd.edu", dateSigned: "2026-08-11", aNumber: "A00000002" },
      { rowNumber: 3, name: "María Maker", email: "maker2@ucsd.edu", dateSigned: "2026-08-11", aNumber: "A00000002" },
    ],
  }));
  const missing = reconcileSourceSnapshot(snapshot({ waivers: [] }));

  assert.equal(ambiguous.metrics.waiverMatches.ambiguousIdentifier, 1);
  assert.equal(missing.metrics.waiverMatches.notFound, 1);
});

test("treats approved training with removal metadata as revoked history", () => {
  const result = reconcileSourceSnapshot(snapshot({
    internalTraining: [{
      rowNumber: 2,
      recordId: "record-1",
      userEmail: "maker2@ucsd.edu",
      training: "3D Printing",
      status: "Approved",
      approvedAt: "2026-08-01",
      removedBy: "admin@ucsd.edu",
      removedAt: "2026-08-02",
    }],
  }));

  assert.equal(result.metrics.activeInternalTrainingRecords, 0);
  assert.equal(result.metrics.revokedInternalTrainingRecords, 1);
  assert.ok(result.issues.some((issue) => issue.type === "training_status_conflict"));
});

test("issue CSV contains row references but not account data", () => {
  const result = reconcileSourceSnapshot(snapshot({ waivers: [] }));
  const csv = issuesToCsv(result.issues);

  assert.match(csv, /source_row_numbers/);
  assert.match(csv, /no_signed_waiver_match/);
  assert.doesNotMatch(csv, /maker2@ucsd\.edu/);
  assert.doesNotMatch(csv, /A00000002/);
});
