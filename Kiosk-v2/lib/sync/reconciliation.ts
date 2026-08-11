import {
  matchWaiver,
  normalizeEmail,
  normalizeIdentifier,
  type WaiverMatch,
  type WaiverSheetRow,
} from "./waiver-matcher.ts";

export type LegacyUserRow = {
  rowNumber: number;
  name: string;
  timestamp: string;
  cardUid: string;
  identifier: string;
  userType: string;
  email: string;
  secondaryEmail: string;
  waiverSigned: string;
  training: Record<string, boolean>;
};

export type LegacyActivityRow = {
  rowNumber: number;
  date: string;
  epochTime: string;
  cardUid: string;
  eventType: string;
};

export type InternalTrainingRow = {
  rowNumber: number;
  recordId: string;
  userEmail: string;
  training: string;
  status: string;
  approvedAt: string;
  removedBy: string;
  removedAt: string;
};

export type SourceSnapshot = {
  users: LegacyUserRow[];
  waivers: WaiverSheetRow[];
  activity: LegacyActivityRow[];
  internalTraining: InternalTrainingRow[];
};

export type ReconciliationIssue = {
  type:
    | "missing_user_identifier"
    | "duplicate_user_identifier"
    | "same_account_repeated_card"
    | "card_shared_across_accounts"
    | "duplicate_waiver_identifier"
    | "ambiguous_waiver_match"
    | "no_signed_waiver_match"
    | "activity_card_not_in_user_database"
    | "training_status_conflict"
    | "legacy_training_flag_conflict";
  sourceSheet: string;
  sourceRowNumbers: number[];
  severity: "informational" | "review" | "blocker";
  recommendedHandling: string;
};

export type CanonicalAccount = {
  normalizedIdentifier: string;
  canonicalSourceRowNumber: number;
  sourceRowNumbers: number[];
  canonicalUser: LegacyUserRow;
  /** Raw source values are in-memory only. Hash before any persistence and never log them. */
  sourceCardUids: string[];
  waiverMatch: WaiverMatch;
  positiveTrainingNames: string[];
  conflictingTrainingNames: string[];
};

export type ReconciliationMetrics = {
  sourceRows: { users: number; waivers: number; activity: number; internalTraining: number };
  canonicalAccounts: number;
  missingIdentifierRows: number;
  duplicateUserGroups: number;
  duplicateUserRows: number;
  distinctCards: number;
  safeDistinctCards: number;
  sameAccountRepeatedCardGroups: number;
  sameAccountRepeatedCardRows: number;
  crossAccountCardGroups: number;
  accountsWithoutCard: number;
  blankUserTypeRows: number;
  blankLegacyWaiverFlagRows: number;
  signedWaivers: number;
  unsignedWaiverRows: number;
  duplicateWaiverGroups: number;
  duplicateWaiverRows: number;
  waiverMatches: {
    identifier: number;
    identifierAndEmail: number;
    identifierEmailAndName: number;
    emailAndName: number;
    ambiguousIdentifier: number;
    ambiguousEmailAndName: number;
    notFound: number;
  };
  signedWaiverIdentifiersWithoutAccount: number;
  linkedCheckins: number;
  linkedRegistrationEvents: number;
  orphanCheckins: number;
  orphanRegistrationEvents: number;
  allActivityEvents: number;
  orphanActivityEvents: number;
  positiveLaserCutterAccounts: number;
  conflictingLaserCutterAccounts: number;
  activeInternalTrainingRecords: number;
  revokedInternalTrainingRecords: number;
};

export type ReconciliationResult = {
  accounts: CanonicalAccount[];
  issues: ReconciliationIssue[];
  metrics: ReconciliationMetrics;
};

export type DryRunManifest = {
  mode: "dry_run";
  sourceWritesPerformed: false;
  productionWritesPerformed: false;
  approvalRequired: true;
  proposedCreates: Record<string, number>;
  reviewQueues: Record<string, number>;
  deduplications: Record<string, number>;
  preservation: Record<string, number | boolean>;
};

const USER_SHEET = "User Database SIO / Form Responses 1";
const WAIVER_SHEET = "Waiver Signatures SIO / Sheet1";
const ACTIVITY_SHEET = "Activity Log SIO / Sheet1";
const TRAINING_SHEET = "User Database SIO / Internal Training Records";

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const group = groups.get(value) ?? [];
    group.push(item);
    groups.set(value, group);
  }
  return groups;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

function isCheckin(value: string): boolean {
  return value.trim().toLowerCase() === "user checkin";
}

function isRegistration(value: string): boolean {
  return value.trim().toLowerCase() === "new user";
}

export function reconcileSourceSnapshot(snapshot: SourceSnapshot): ReconciliationResult {
  const issues: ReconciliationIssue[] = [];
  const missingIdentifierRows = snapshot.users.filter(
    (row) => !normalizeIdentifier(row.identifier),
  );

  for (const row of missingIdentifierRows) {
    issues.push({
      type: "missing_user_identifier",
      sourceSheet: USER_SHEET,
      sourceRowNumbers: [row.rowNumber],
      severity: "blocker",
      recommendedHandling: "Keep out of the automatic import until a PID or employee ID is confirmed.",
    });
  }

  const userGroups = groupBy(snapshot.users, (row) => normalizeIdentifier(row.identifier));
  const waiverGroups = groupBy(snapshot.waivers, (row) => normalizeIdentifier(row.aNumber));
  const signedWaivers = snapshot.waivers.filter((row) => row.dateSigned.trim());

  const duplicateUserGroups = [...userGroups.values()].filter((group) => group.length > 1);
  for (const group of duplicateUserGroups) {
    issues.push({
      type: "duplicate_user_identifier",
      sourceSheet: USER_SHEET,
      sourceRowNumbers: group.map((row) => row.rowNumber),
      severity: "review",
      recommendedHandling: "Use the latest row as the profile candidate and merge card and training history.",
    });
  }

  const duplicateWaiverGroups = [...waiverGroups.values()].filter((group) => group.length > 1);
  for (const group of duplicateWaiverGroups) {
    issues.push({
      type: "duplicate_waiver_identifier",
      sourceSheet: WAIVER_SHEET,
      sourceRowNumbers: group.map((row) => row.rowNumber),
      severity: "review",
      recommendedHandling: "Resolve by email and normalized name; retain every signed source row.",
    });
  }

  const accounts: CanonicalAccount[] = [];
  for (const [normalizedIdentifier, group] of userGroups) {
    const ordered = [...group].sort((a, b) => a.rowNumber - b.rowNumber);
    const canonicalUser = ordered.at(-1)!;
    const { firstName, lastName } = splitName(canonicalUser.name);
    const waiverMatch = matchWaiver(
      {
        userId: `legacy-row-${canonicalUser.rowNumber}`,
        identifier: canonicalUser.identifier,
        email: canonicalUser.email,
        firstName,
        lastName,
      },
      snapshot.waivers,
    );

    if (waiverMatch.status === "ambiguous") {
      issues.push({
        type: "ambiguous_waiver_match",
        sourceSheet: `${USER_SHEET} + ${WAIVER_SHEET}`,
        sourceRowNumbers: [
          canonicalUser.rowNumber,
          ...waiverMatch.candidateRowNumbers,
        ],
        severity: "blocker",
        recommendedHandling: "Do not activate automatically; staff review is required.",
      });
    } else if (waiverMatch.status === "not_found") {
      issues.push({
        type: "no_signed_waiver_match",
        sourceSheet: USER_SHEET,
        sourceRowNumbers: [canonicalUser.rowNumber],
        severity: "blocker",
        recommendedHandling: "Keep the account pending until a signed waiver is found or manually confirmed.",
      });
    }

    const trainingNames = new Set(ordered.flatMap((row) => Object.keys(row.training)));
    const positiveTrainingNames: string[] = [];
    const conflictingTrainingNames: string[] = [];
    for (const trainingName of trainingNames) {
      const values = ordered.map((row) => Boolean(row.training[trainingName]));
      if (values.some(Boolean)) positiveTrainingNames.push(trainingName);
      if (values.some(Boolean) && values.some((value) => !value)) {
        conflictingTrainingNames.push(trainingName);
        issues.push({
          type: "legacy_training_flag_conflict",
          sourceSheet: USER_SHEET,
          sourceRowNumbers: ordered.map((row) => row.rowNumber),
          severity: "review",
          recommendedHandling: `Hold ${trainingName} until the historical TRUE/FALSE conflict is reviewed.`,
        });
      }
    }

    accounts.push({
      normalizedIdentifier,
      canonicalSourceRowNumber: canonicalUser.rowNumber,
      sourceRowNumbers: ordered.map((row) => row.rowNumber),
      canonicalUser,
      sourceCardUids: [...new Set(ordered.map((row) => row.cardUid.trim()).filter(Boolean))],
      waiverMatch,
      positiveTrainingNames: positiveTrainingNames.sort(),
      conflictingTrainingNames: conflictingTrainingNames.sort(),
    });
  }

  const cardRows = new Map<string, LegacyUserRow[]>();
  for (const row of snapshot.users) {
    const card = normalizeIdentifier(row.cardUid);
    if (!card) continue;
    const group = cardRows.get(card) ?? [];
    group.push(row);
    cardRows.set(card, group);
  }

  let sameAccountRepeatedCardGroups = 0;
  let sameAccountRepeatedCardRows = 0;
  let crossAccountCardGroups = 0;
  const unsafeCards = new Set<string>();
  for (const [card, rows] of cardRows) {
    if (rows.length < 2) continue;
    const accountIds = new Set(rows.map((row) => normalizeIdentifier(row.identifier)));
    if (accountIds.size === 1) {
      sameAccountRepeatedCardGroups += 1;
      sameAccountRepeatedCardRows += rows.length;
      issues.push({
        type: "same_account_repeated_card",
        sourceSheet: USER_SHEET,
        sourceRowNumbers: rows.map((row) => row.rowNumber),
        severity: "informational",
        recommendedHandling: "Deduplicate the repeated card value within the canonical account.",
      });
    } else {
      crossAccountCardGroups += 1;
      unsafeCards.add(card);
      issues.push({
        type: "card_shared_across_accounts",
        sourceSheet: USER_SHEET,
        sourceRowNumbers: rows.map((row) => row.rowNumber),
        severity: "blocker",
        recommendedHandling: "Do not assign this card until staff confirms the current cardholder.",
      });
    }
  }

  const knownCards = new Set([...cardRows.keys()].filter((card) => !unsafeCards.has(card)));
  const orphanActivityGroups = groupBy(
    snapshot.activity.filter((row) => !knownCards.has(normalizeIdentifier(row.cardUid))),
    (row) => normalizeIdentifier(row.cardUid),
  );
  for (const group of orphanActivityGroups.values()) {
    issues.push({
      type: "activity_card_not_in_user_database",
      sourceSheet: ACTIVITY_SHEET,
      sourceRowNumbers: group.map((row) => row.rowNumber),
      severity: "review",
      recommendedHandling: "Preserve the events in quarantine without guessing a user identity.",
    });
  }

  let activeInternalTrainingRecords = 0;
  let revokedInternalTrainingRecords = 0;
  for (const row of snapshot.internalTraining) {
    const removed = Boolean(row.removedBy.trim() || row.removedAt.trim());
    const approved = row.status.trim().toLowerCase() === "approved";
    if (approved && removed) {
      revokedInternalTrainingRecords += 1;
      issues.push({
        type: "training_status_conflict",
        sourceSheet: TRAINING_SHEET,
        sourceRowNumbers: [row.rowNumber],
        severity: "blocker",
        recommendedHandling: "Treat as removed pending review because removal metadata overrides Approved.",
      });
    } else if (approved) {
      activeInternalTrainingRecords += 1;
    } else if (removed) {
      revokedInternalTrainingRecords += 1;
    }
  }

  const matchCounts: ReconciliationMetrics["waiverMatches"] = {
    identifier: 0,
    identifierAndEmail: 0,
    identifierEmailAndName: 0,
    emailAndName: 0,
    ambiguousIdentifier: 0,
    ambiguousEmailAndName: 0,
    notFound: 0,
  };
  for (const account of accounts) {
    const match = account.waiverMatch;
    if (match.status === "matched") {
      if (match.method === "identifier") matchCounts.identifier += 1;
      if (match.method === "identifier_and_email") matchCounts.identifierAndEmail += 1;
      if (match.method === "identifier_email_and_name") matchCounts.identifierEmailAndName += 1;
      if (match.method === "email_and_name") matchCounts.emailAndName += 1;
    } else if (match.status === "ambiguous") {
      if (match.reason === "duplicate_identifier") matchCounts.ambiguousIdentifier += 1;
      else matchCounts.ambiguousEmailAndName += 1;
    } else matchCounts.notFound += 1;
  }

  const accountIds = new Set(accounts.map((account) => account.normalizedIdentifier));
  const orphanWaiverIds = new Set(
    signedWaivers
      .map((row) => normalizeIdentifier(row.aNumber))
      .filter((identifier) => identifier && !accountIds.has(identifier)),
  );
  const linkedActivity = snapshot.activity.filter((row) => knownCards.has(normalizeIdentifier(row.cardUid)));
  const orphanActivity = snapshot.activity.filter((row) => !knownCards.has(normalizeIdentifier(row.cardUid)));
  const laserName = "Epilog Laser Cutter";

  return {
    accounts,
    issues,
    metrics: {
      sourceRows: {
        users: snapshot.users.length,
        waivers: snapshot.waivers.length,
        activity: snapshot.activity.length,
        internalTraining: snapshot.internalTraining.length,
      },
      canonicalAccounts: accounts.length,
      missingIdentifierRows: missingIdentifierRows.length,
      duplicateUserGroups: duplicateUserGroups.length,
      duplicateUserRows: duplicateUserGroups.reduce((sum, group) => sum + group.length, 0),
      distinctCards: cardRows.size,
      safeDistinctCards: cardRows.size - unsafeCards.size,
      sameAccountRepeatedCardGroups,
      sameAccountRepeatedCardRows,
      crossAccountCardGroups,
      accountsWithoutCard: accounts.filter((account) => account.sourceCardUids.length === 0).length,
      blankUserTypeRows: snapshot.users.filter((row) => !row.userType.trim()).length,
      blankLegacyWaiverFlagRows: snapshot.users.filter((row) => !row.waiverSigned.trim()).length,
      signedWaivers: signedWaivers.length,
      unsignedWaiverRows: snapshot.waivers.length - signedWaivers.length,
      duplicateWaiverGroups: duplicateWaiverGroups.length,
      duplicateWaiverRows: duplicateWaiverGroups.reduce((sum, group) => sum + group.length, 0),
      waiverMatches: matchCounts,
      signedWaiverIdentifiersWithoutAccount: orphanWaiverIds.size,
      linkedCheckins: linkedActivity.filter((row) => isCheckin(row.eventType)).length,
      linkedRegistrationEvents: linkedActivity.filter((row) => isRegistration(row.eventType)).length,
      orphanCheckins: orphanActivity.filter((row) => isCheckin(row.eventType)).length,
      orphanRegistrationEvents: orphanActivity.filter((row) => isRegistration(row.eventType)).length,
      allActivityEvents: snapshot.activity.length,
      orphanActivityEvents: orphanActivity.length,
      positiveLaserCutterAccounts: accounts.filter((account) =>
        account.positiveTrainingNames.includes(laserName),
      ).length,
      conflictingLaserCutterAccounts: accounts.filter((account) =>
        account.conflictingTrainingNames.includes(laserName),
      ).length,
      activeInternalTrainingRecords,
      revokedInternalTrainingRecords,
    },
  };
}

export function createDryRunManifest(
  result: ReconciliationResult,
  accessRoster = { staffRoles: 0, trainerAuthorizations: 0 },
): DryRunManifest {
  const metrics = result.metrics;
  const confirmedWaivers =
    metrics.waiverMatches.identifier +
    metrics.waiverMatches.identifierAndEmail +
    metrics.waiverMatches.identifierEmailAndName +
    metrics.waiverMatches.emailAndName;
  const ambiguousWaivers =
    metrics.waiverMatches.ambiguousIdentifier + metrics.waiverMatches.ambiguousEmailAndName;

  return {
    mode: "dry_run",
    sourceWritesPerformed: false,
    productionWritesPerformed: false,
    approvalRequired: true,
    proposedCreates: {
      canonicalAccounts: metrics.canonicalAccounts,
      externalIdentifiers: metrics.canonicalAccounts,
      distinctCardCredentials: metrics.safeDistinctCards,
      signedWaiverSourceRecords: metrics.signedWaivers,
      waiverConfirmedAccounts: confirmedWaivers,
      linkedHistoricalVisits: metrics.linkedCheckins,
      linkedRegistrationAuditEvents: metrics.linkedRegistrationEvents,
      provisionalLaserCutterCertifications:
        metrics.positiveLaserCutterAccounts - metrics.conflictingLaserCutterAccounts,
      activeInternalTrainingRecords: metrics.activeInternalTrainingRecords,
      revokedInternalTrainingHistoryRecords: metrics.revokedInternalTrainingRecords,
      staffRolesPendingEmailConfirmation: accessRoster.staffRoles,
      trainerAuthorizationsPendingEmailConfirmation: accessRoster.trainerAuthorizations,
    },
    reviewQueues: {
      ambiguousWaiverMatches: ambiguousWaivers,
      accountsWithoutSignedWaiverMatch: metrics.waiverMatches.notFound,
      signedWaiverIdentifiersWithoutUserAccount: metrics.signedWaiverIdentifiersWithoutAccount,
      historicalCheckinsWithUnknownCard: metrics.orphanCheckins,
      historicalRegistrationEventsWithUnknownCard: metrics.orphanRegistrationEvents,
      conflictingLegacyLaserCutterFlags: metrics.conflictingLaserCutterAccounts,
      accountsWithoutCard: metrics.accountsWithoutCard,
      cardsSharedAcrossAccounts: metrics.crossAccountCardGroups,
    },
    deduplications: {
      duplicateUserIdentifierGroups: metrics.duplicateUserGroups,
      duplicateUserRows: metrics.duplicateUserRows,
      sameAccountRepeatedCardGroups: metrics.sameAccountRepeatedCardGroups,
      sameAccountRepeatedCardRows: metrics.sameAccountRepeatedCardRows,
      duplicateWaiverIdentifierGroups: metrics.duplicateWaiverGroups,
      duplicateWaiverRows: metrics.duplicateWaiverRows,
    },
    preservation: {
      allActivityEventsRetained: metrics.allActivityEvents,
      orphanActivityEventsQuarantined: metrics.orphanActivityEvents,
      allSignedWaiverRowsRetained: metrics.signedWaivers,
      sourceSpreadsheetAndRowProvenanceRequired: true,
    },
  };
}

export function issuesToCsv(issues: ReconciliationIssue[]): string {
  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = [
    ["issue_type", "source_sheet", "source_row_numbers", "severity", "recommended_handling"],
    ...issues.map((issue) => [
      issue.type,
      issue.sourceSheet,
      issue.sourceRowNumbers.join(";"),
      issue.severity,
      issue.recommendedHandling,
    ]),
  ];
  return `${rows.map((row) => row.map(escape).join(",")).join("\n")}\n`;
}
