export type PendingWaiverUser = {
  userId: string;
  identifier: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type WaiverSheetRow = {
  rowNumber: number;
  name: string;
  email: string;
  dateSigned: string;
  aNumber: string;
};

export type WaiverMatch =
  | {
      status: "matched";
      rowNumber: number;
      method: "identifier" | "identifier_and_email" | "identifier_email_and_name" | "email_and_name";
    }
  | {
      status: "ambiguous";
      candidateRowNumbers: number[];
      reason: "duplicate_identifier" | "duplicate_email_and_name";
    }
  | {
      status: "not_found";
      reason: "no_safe_match";
    };

export function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function signedRows(rows: WaiverSheetRow[]): WaiverSheetRow[] {
  return rows.filter((row) => row.dateSigned.trim().length > 0);
}

/**
 * Matches a pending account to a signed waiver without allowing a name-only or
 * email-only match. The caller should queue ambiguous results for staff review;
 * it must never activate the account automatically.
 */
export function matchWaiver(user: PendingWaiverUser, rows: WaiverSheetRow[]): WaiverMatch {
  const identifier = normalizeIdentifier(user.identifier);
  const email = normalizeEmail(user.email);
  const name = normalizeName(`${user.firstName} ${user.lastName}`);
  const availableRows = signedRows(rows);

  const identifierMatches = identifier
    ? availableRows.filter((row) => normalizeIdentifier(row.aNumber) === identifier)
    : [];

  if (identifierMatches.length === 1) {
    return { status: "matched", rowNumber: identifierMatches[0].rowNumber, method: "identifier" };
  }

  if (identifierMatches.length > 1) {
    const emailMatches = email
      ? identifierMatches.filter((row) => normalizeEmail(row.email) === email)
      : [];

    if (emailMatches.length === 1) {
      return { status: "matched", rowNumber: emailMatches[0].rowNumber, method: "identifier_and_email" };
    }

    if (emailMatches.length > 1 && name) {
      const nameMatches = emailMatches.filter((row) => normalizeName(row.name) === name);
      if (nameMatches.length === 1) {
        return {
          status: "matched",
          rowNumber: nameMatches[0].rowNumber,
          method: "identifier_email_and_name",
        };
      }
    }

    return {
      status: "ambiguous",
      candidateRowNumbers: identifierMatches.map((row) => row.rowNumber),
      reason: "duplicate_identifier",
    };
  }

  if (email && name) {
    const fallbackMatches = availableRows.filter(
      (row) => normalizeEmail(row.email) === email && normalizeName(row.name) === name,
    );

    if (fallbackMatches.length === 1) {
      return { status: "matched", rowNumber: fallbackMatches[0].rowNumber, method: "email_and_name" };
    }

    if (fallbackMatches.length > 1) {
      return {
        status: "ambiguous",
        candidateRowNumbers: fallbackMatches.map((row) => row.rowNumber),
        reason: "duplicate_email_and_name",
      };
    }
  }

  return { status: "not_found", reason: "no_safe_match" };
}
