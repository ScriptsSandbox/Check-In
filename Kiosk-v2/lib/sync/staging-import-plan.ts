import { hmacHex, stablePrivateId } from "../security/hmac.ts";
import { normalizeEmail, normalizeIdentifier } from "./waiver-matcher.ts";
import type {
  CanonicalAccount,
  DryRunManifest,
  LegacyActivityRow,
  ReconciliationResult,
  SourceSnapshot,
} from "./reconciliation.ts";
import { createDryRunManifest } from "./reconciliation.ts";

type UserInsert = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: null;
  displayName: string;
  userType: string;
  affiliation: string;
  primaryEmail: string;
  secondaryEmail: string | null;
  status: string;
  notes: string;
};

type IdentifierInsert = {
  id: string;
  userId: string;
  identifierType: string;
  identifierValue: string;
  normalizedValue: string;
  isPrimary: true;
  isActive: true;
  sourceSystem: string;
  notes: string;
};

type CardInsert = {
  id: string;
  userId: string;
  uidDigest: string;
  uidLastFour: string;
  cardType: string;
  status: string;
  sourceSystem: string;
  notes: string;
};

type WaiverInsert = {
  id: string;
  userId: string;
  status: string;
  signedAt: string | null;
  sourceSystem: string;
  sourceRecordId: string | null;
  lastVerifiedAt: string;
  verificationMethod: string | null;
  notes: string;
};

type ToolInsert = {
  id: string;
  name: string;
  shortName: string;
  category: string;
  status: string;
  trainingRequired: true;
  fabmanManaged: boolean;
  websiteVisible: boolean;
  kioskVisible: boolean;
  notes: string;
};

type TrainingInsert = {
  id: string;
  userId: string;
  toolId: string;
  status: string;
  approvedAt: string | null;
  revokedAt: string | null;
  sourceSystem: string;
  fabmanSyncRequired: boolean;
  latestSyncStatus: string | null;
  notes: string;
};

type VisitInsert = {
  id: string;
  userId: string;
  cardId: string;
  kioskId: string;
  checkedInAt: string;
  checkedOutAt: null;
  status: string;
  onlineAtCheckin: false;
  syncStatus: string;
  sourceSystem: string;
  notes: string;
};

type AuditInsert = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  detailJson: string;
};

type QuarantineInsert = {
  id: string;
  migrationRunId: string;
  sourceSystem: string;
  sourceRowNumber: number;
  eventAt: string;
  eventType: string;
  cardUidDigest: string;
  cardUidLastFour: string;
  quarantineReason: string;
  detailJson: string;
};

export type MigrationProvenanceInsert = {
  id: string;
  migrationRunId: string;
  sourceSystem: string;
  sourceSheet: string;
  sourceRowNumber: number;
  entityType: string;
  entityId: string;
  action: "created";
};

export type StagingImportPlan = {
  run: {
    id: string;
    mode: "staging";
    status: "planned";
    sourceSnapshotAt: string;
    manifestJson: string;
    approvedAt: string;
  };
  manifest: DryRunManifest;
  users: UserInsert[];
  identifiers: IdentifierInsert[];
  cards: CardInsert[];
  waivers: WaiverInsert[];
  tools: ToolInsert[];
  trainingRecords: TrainingInsert[];
  visits: VisitInsert[];
  auditEvents: AuditInsert[];
  quarantinedActivityEvents: QuarantineInsert[];
  provenance: MigrationProvenanceInsert[];
};

const USER_SHEET = "Form Responses 1";
const WAIVER_SHEET = "Sheet1";
const ACTIVITY_SHEET = "Sheet1";

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "Unknown", lastName: parts.slice(1).join(" ") || "Unknown" };
}

function eventAt(row: LegacyActivityRow): string {
  const epoch = Number(row.epochTime);
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch > 1_000_000_000_000 ? epoch : epoch * 1000).toISOString();
  }
  const parsed = Date.parse(row.date);
  return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString();
}

function canonicalToolName(name: string): string {
  if (name.trim().toLowerCase() === "epilog laser cutter") return "Laser Cutter";
  return name.trim();
}

function toolCategory(name: string): string {
  if (["Laser Cutter", "3D Printing", "Resin Printers", "Fablight"].includes(name)) {
    return "Digital Fabrication";
  }
  if (name.toLowerCase().includes("cnc")) return "CNC";
  return "Legacy Equipment";
}

function provenanceSourceRows(account: CanonicalAccount, trainingName: string): number[] {
  return account.sourceRowNumbers.filter((rowNumber) => {
    const row = rowNumber === account.canonicalUser.rowNumber
      ? account.canonicalUser
      : null;
    return row?.training[trainingName] ?? true;
  });
}

export async function buildStagingImportPlan(args: {
  snapshot: SourceSnapshot;
  reconciliation: ReconciliationResult;
  secret: string;
  sourceSnapshotAt: string;
  approvedAt: string;
  accessRoster?: { staffRoles: number; trainerAuthorizations: number };
}): Promise<StagingImportPlan> {
  const { snapshot, reconciliation, secret, sourceSnapshotAt, approvedAt } = args;
  const manifest = createDryRunManifest(reconciliation, args.accessRoster);
  const runId = await stablePrivateId("mig", secret, "migration-run", sourceSnapshotAt);
  const users: UserInsert[] = [];
  const identifiers: IdentifierInsert[] = [];
  const cards: CardInsert[] = [];
  const waivers: WaiverInsert[] = [];
  const tools: ToolInsert[] = [];
  const trainingRecords: TrainingInsert[] = [];
  const visits: VisitInsert[] = [];
  const auditEvents: AuditInsert[] = [];
  const quarantinedActivityEvents: QuarantineInsert[] = [];
  const provenance: MigrationProvenanceInsert[] = [];

  async function addProvenance(
    sourceSystem: string,
    sourceSheet: string,
    sourceRowNumber: number,
    entityType: string,
    entityId: string,
  ) {
    provenance.push({
      id: await stablePrivateId(
        "src",
        secret,
        "migration-provenance",
        `${runId}|${sourceSystem}|${sourceSheet}|${sourceRowNumber}|${entityType}|${entityId}`,
      ),
      migrationRunId: runId,
      sourceSystem,
      sourceSheet,
      sourceRowNumber,
      entityType,
      entityId,
      action: "created",
    });
  }

  const userIdByIdentifier = new Map<string, string>();
  const cardOwners = new Map<string, Set<string>>();
  for (const account of reconciliation.accounts) {
    for (const rawCard of account.sourceCardUids) {
      const normalizedCard = normalizeIdentifier(rawCard);
      const owners = cardOwners.get(normalizedCard) ?? new Set<string>();
      owners.add(account.normalizedIdentifier);
      cardOwners.set(normalizedCard, owners);
    }
  }

  const cardRecordByNormalizedUid = new Map<string, { id: string; userId: string }>();
  for (const account of reconciliation.accounts) {
    const userId = await stablePrivateId("usr", secret, "legacy-user", account.normalizedIdentifier);
    userIdByIdentifier.set(account.normalizedIdentifier, userId);
    const identifierId = await stablePrivateId("uid", secret, "legacy-identifier", account.normalizedIdentifier);
    const { firstName, lastName } = splitName(account.canonicalUser.name);
    const matched = account.waiverMatch.status === "matched";
    users.push({
      id: userId,
      firstName,
      lastName,
      preferredName: null,
      displayName: account.canonicalUser.name.trim() || `${firstName} ${lastName}`,
      userType: account.canonicalUser.userType.trim() || "unknown",
      affiliation: account.canonicalUser.userType.trim() ? "Legacy import" : "Needs profile update",
      primaryEmail: normalizeEmail(account.canonicalUser.email),
      secondaryEmail: normalizeEmail(account.canonicalUser.secondaryEmail) || null,
      status: matched ? "active" : "pending_waiver_review",
      notes: `Legacy source rows: ${account.sourceRowNumbers.join(", ")}`,
    });
    identifiers.push({
      id: identifierId,
      userId,
      identifierType: "ucsd_id",
      identifierValue: account.canonicalUser.identifier.trim(),
      normalizedValue: account.normalizedIdentifier,
      isPrimary: true,
      isActive: true,
      sourceSystem: "User Database SIO",
      notes: `Canonical source row: ${account.canonicalSourceRowNumber}`,
    });
    for (const rowNumber of account.sourceRowNumbers) {
      await addProvenance("User Database SIO", USER_SHEET, rowNumber, "user", userId);
    }
    await addProvenance(
      "User Database SIO",
      USER_SHEET,
      account.canonicalSourceRowNumber,
      "user_identifier",
      identifierId,
    );

    for (const rawCard of account.sourceCardUids) {
      const normalizedCard = normalizeIdentifier(rawCard);
      if (cardOwners.get(normalizedCard)?.size !== 1 || cardRecordByNormalizedUid.has(normalizedCard)) {
        continue;
      }
      const uidDigest = await hmacHex(secret, "card-uid", normalizedCard);
      const cardId = await stablePrivateId("crd", secret, "legacy-card", normalizedCard);
      cards.push({
        id: cardId,
        userId,
        uidDigest,
        uidLastFour: normalizedCard.slice(-4),
        cardType: "UCSD ID",
        status: "active",
        sourceSystem: "User Database SIO",
        notes: "Migrated from legacy card record; raw UID was not persisted.",
      });
      cardRecordByNormalizedUid.set(normalizedCard, { id: cardId, userId });
      for (const row of snapshot.users.filter(
        (source) => normalizeIdentifier(source.cardUid) === normalizedCard,
      )) {
        await addProvenance("User Database SIO", USER_SHEET, row.rowNumber, "card", cardId);
      }
    }

    const waiverId = await stablePrivateId("wvr", secret, "legacy-waiver", account.normalizedIdentifier);
    const waiverMatch = account.waiverMatch;
    const matchedRow = waiverMatch.status === "matched"
      ? snapshot.waivers.find((row) => row.rowNumber === waiverMatch.rowNumber)
      : undefined;
    waivers.push({
      id: waiverId,
      userId,
      status: matchedRow ? "signed" : "pending_review",
      signedAt: matchedRow?.dateSigned || null,
      sourceSystem: "Waiver Signatures SIO",
      sourceRecordId: matchedRow ? `Sheet1:${matchedRow.rowNumber}` : null,
      lastVerifiedAt: sourceSnapshotAt,
      verificationMethod: waiverMatch.status === "matched" ? waiverMatch.method : null,
      notes: matchedRow ? "Matched by approved migration policy." : "Requires waiver review.",
    });
    if (matchedRow) {
      await addProvenance("Waiver Signatures SIO", WAIVER_SHEET, matchedRow.rowNumber, "waiver_status", waiverId);
    }
  }

  const allTrainingNames = new Set<string>();
  for (const account of reconciliation.accounts) {
    for (const name of account.positiveTrainingNames) allTrainingNames.add(canonicalToolName(name));
  }
  for (const row of snapshot.internalTraining) allTrainingNames.add(canonicalToolName(row.training));
  const toolIdByName = new Map<string, string>();
  for (const name of [...allTrainingNames].filter(Boolean).sort()) {
    const toolId = await stablePrivateId("tol", secret, "tool-name", name.toLowerCase());
    toolIdByName.set(name, toolId);
    tools.push({
      id: toolId,
      name,
      shortName: name,
      category: toolCategory(name),
      status: "active",
      trainingRequired: true,
      fabmanManaged: name === "Laser Cutter",
      websiteVisible: true,
      kioskVisible: true,
      notes: "Seeded by the approved legacy migration plan.",
    });
  }

  for (const account of reconciliation.accounts) {
    const userId = userIdByIdentifier.get(account.normalizedIdentifier)!;
    for (const sourceName of account.positiveTrainingNames) {
      if (account.conflictingTrainingNames.includes(sourceName)) continue;
      const name = canonicalToolName(sourceName);
      const toolId = toolIdByName.get(name)!;
      const trainingId = await stablePrivateId(
        "trn",
        secret,
        "legacy-training",
        `${account.normalizedIdentifier}|${name}`,
      );
      trainingRecords.push({
        id: trainingId,
        userId,
        toolId,
        status: "approved",
        approvedAt: account.canonicalUser.timestamp || null,
        revokedAt: null,
        sourceSystem: "User Database SIO",
        fabmanSyncRequired: name === "Laser Cutter",
        latestSyncStatus: name === "Laser Cutter" ? "pending" : null,
        notes: "Provisional legacy certification; source rows retained in provenance.",
      });
      for (const rowNumber of provenanceSourceRows(account, sourceName)) {
        await addProvenance("User Database SIO", USER_SHEET, rowNumber, "training_record", trainingId);
      }
    }
  }

  const usersByEmail = new Map<string, string[]>();
  for (const account of reconciliation.accounts) {
    const email = normalizeEmail(account.canonicalUser.email);
    const matches = usersByEmail.get(email) ?? [];
    matches.push(userIdByIdentifier.get(account.normalizedIdentifier)!);
    usersByEmail.set(email, matches);
  }
  for (const row of snapshot.internalTraining) {
    const matchingUsers = usersByEmail.get(normalizeEmail(row.userEmail)) ?? [];
    if (matchingUsers.length !== 1) continue;
    const name = canonicalToolName(row.training);
    const toolId = toolIdByName.get(name);
    if (!toolId) continue;
    const removed = Boolean(row.removedBy.trim() || row.removedAt.trim());
    const trainingId = await stablePrivateId("trn", secret, "internal-training", row.recordId);
    trainingRecords.push({
      id: trainingId,
      userId: matchingUsers[0],
      toolId,
      status: removed ? "revoked" : "approved",
      approvedAt: row.approvedAt || null,
      revokedAt: row.removedAt || null,
      sourceSystem: "User Database SIO / Internal Training Records",
      fabmanSyncRequired: name === "Laser Cutter" && !removed,
      latestSyncStatus: name === "Laser Cutter" && !removed ? "pending" : null,
      notes: removed ? "Removal metadata overrides the legacy Approved label." : "Imported event record.",
    });
    await addProvenance(
      "User Database SIO",
      "Internal Training Records",
      row.rowNumber,
      "training_record",
      trainingId,
    );
  }

  for (const row of snapshot.activity) {
    const normalizedCard = normalizeIdentifier(row.cardUid);
    const card = cardRecordByNormalizedUid.get(normalizedCard);
    const occurredAt = eventAt(row);
    if (card && row.eventType.trim().toLowerCase() === "user checkin") {
      const visitId = await stablePrivateId("vst", secret, "legacy-activity", String(row.rowNumber));
      visits.push({
        id: visitId,
        userId: card.userId,
        cardId: card.id,
        kioskId: "legacy-sio-kiosk",
        checkedInAt: occurredAt,
        checkedOutAt: null,
        status: "historical",
        onlineAtCheckin: false,
        syncStatus: "imported",
        sourceSystem: "Activity Log SIO",
        notes: `Legacy source row ${row.rowNumber}; checkout time unavailable.`,
      });
      await addProvenance("Activity Log SIO", ACTIVITY_SHEET, row.rowNumber, "visit", visitId);
    } else if (card && row.eventType.trim().toLowerCase() === "new user") {
      const auditId = await stablePrivateId("aud", secret, "legacy-activity", String(row.rowNumber));
      auditEvents.push({
        id: auditId,
        action: "legacy.user_created",
        entityType: "user",
        entityId: card.userId,
        occurredAt,
        detailJson: JSON.stringify({ sourceSystem: "Activity Log SIO", sourceRowNumber: row.rowNumber }),
      });
      await addProvenance("Activity Log SIO", ACTIVITY_SHEET, row.rowNumber, "audit_event", auditId);
    } else {
      const quarantineId = await stablePrivateId("qua", secret, "legacy-activity", String(row.rowNumber));
      quarantinedActivityEvents.push({
        id: quarantineId,
        migrationRunId: runId,
        sourceSystem: "Activity Log SIO",
        sourceRowNumber: row.rowNumber,
        eventAt: occurredAt,
        eventType: row.eventType,
        cardUidDigest: await hmacHex(secret, "card-uid", normalizedCard),
        cardUidLastFour: normalizedCard.slice(-4),
        quarantineReason: card ? "unsupported_legacy_event" : "card_not_in_user_database",
        detailJson: JSON.stringify({ sourceRowNumber: row.rowNumber }),
      });
      await addProvenance(
        "Activity Log SIO",
        ACTIVITY_SHEET,
        row.rowNumber,
        "quarantined_activity_event",
        quarantineId,
      );
    }
  }

  return {
    run: {
      id: runId,
      mode: "staging",
      status: "planned",
      sourceSnapshotAt,
      manifestJson: JSON.stringify(manifest),
      approvedAt,
    },
    manifest,
    users,
    identifiers,
    cards,
    waivers,
    tools,
    trainingRecords,
    visits,
    auditEvents,
    quarantinedActivityEvents,
    provenance,
  };
}
