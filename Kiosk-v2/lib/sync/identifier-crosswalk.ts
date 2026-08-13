export type ExistingIdentifier = {
  personId: string;
  type: string;
  normalizedValue: string;
  active: boolean;
};

export type CrosswalkInput = {
  personId: string;
  pid: string;
  tsn: string;
  verifiedBy: string;
  verifiedAt: string;
  source: string;
};

export type PlannedAlias = {
  personId: string;
  type: "PID" | "TSN";
  normalizedValue: string;
  primary: boolean;
  verified: true;
  active: true;
  provenance: string;
};

export type CrosswalkPlan = {
  aliasesToCreate: PlannedAlias[];
  alreadyPresent: PlannedAlias[];
  errors: string[];
};

export function normalizePid(value: string): string {
  const compact = value.normalize("NFKC").toUpperCase().replace(/[\s-]+/g, "");
  if (!/^A?\d{8}$/.test(compact)) return "";
  return compact.startsWith("A") ? compact : `A${compact}`;
}

export function normalizeTsn(value: string): string {
  const compact = value.normalize("NFKC").replace(/[\s-]+/g, "");
  return /^\d{9}$/.test(compact) ? compact : "";
}

/**
 * Produces a no-write plan. A caller may persist aliases only when errors is
 * empty. The same normalized identifier may never belong to two people.
 */
export function planIdentifierCrosswalk(
  rows: CrosswalkInput[],
  existing: ExistingIdentifier[],
): CrosswalkPlan {
  const errors: string[] = [];
  const aliasesToCreate: PlannedAlias[] = [];
  const alreadyPresent: PlannedAlias[] = [];
  const ownerByAlias = new Map<string, string>();
  const plannedKeys = new Set<string>();

  for (const identifier of existing) {
    if (!identifier.active) continue;
    const type = identifier.type.trim().toUpperCase();
    const value = type === "PID" ? normalizePid(identifier.normalizedValue)
      : type === "TSN" ? normalizeTsn(identifier.normalizedValue)
      : "";
    if (!value) continue;
    const key = `${type}:${value}`;
    const priorOwner = ownerByAlias.get(key);
    if (priorOwner && priorOwner !== identifier.personId) {
      errors.push(`Existing ${type} is assigned to more than one person.`);
    } else {
      ownerByAlias.set(key, identifier.personId);
    }
  }

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const personId = row.personId.trim();
    const pid = normalizePid(row.pid);
    const tsn = normalizeTsn(row.tsn);
    if (!personId || !pid || !tsn || !row.verifiedBy.trim() || !row.verifiedAt.trim() || !row.source.trim()) {
      errors.push(`Crosswalk row ${rowNumber} is incomplete or contains an invalid PID/TSN.`);
      continue;
    }

    const provenance = `${row.source.trim()} | verified ${row.verifiedAt.trim()} by ${row.verifiedBy.trim()}`;
    for (const alias of [
      { type: "PID" as const, normalizedValue: pid, primary: true },
      { type: "TSN" as const, normalizedValue: tsn, primary: false },
    ]) {
      const key = `${alias.type}:${alias.normalizedValue}`;
      const owner = ownerByAlias.get(key);
      if (owner && owner !== personId) {
        errors.push(`Crosswalk row ${rowNumber} would assign ${alias.type} to a different person.`);
        continue;
      }
      ownerByAlias.set(key, personId);
      const plannedKey = `${personId}:${key}`;
      if (plannedKeys.has(plannedKey)) continue;
      plannedKeys.add(plannedKey);
      const planned: PlannedAlias = {
        personId,
        ...alias,
        verified: true,
        active: true,
        provenance,
      };
      const exists = existing.some((item) =>
        item.active && item.personId === personId && item.type.trim().toUpperCase() === alias.type &&
        (alias.type === "PID" ? normalizePid(item.normalizedValue) : normalizeTsn(item.normalizedValue)) === alias.normalizedValue
      );
      (exists ? alreadyPresent : aliasesToCreate).push(planned);
    }
  }

  return { aliasesToCreate: errors.length ? [] : aliasesToCreate, alreadyPresent, errors };
}
