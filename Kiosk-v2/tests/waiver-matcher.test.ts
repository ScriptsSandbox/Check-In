import assert from "node:assert/strict";
import test from "node:test";

import {
  matchWaiver,
  normalizeEmail,
  normalizeIdentifier,
  normalizeName,
  type PendingWaiverUser,
  type WaiverSheetRow,
} from "../lib/sync/waiver-matcher.ts";

const person: PendingWaiverUser = {
  userId: "user-1",
  identifier: "A12345678",
  email: "maker@ucsd.edu",
  firstName: "María",
  lastName: "Maker-Smith",
};

function waiver(overrides: Partial<WaiverSheetRow> = {}): WaiverSheetRow {
  return {
    rowNumber: 2,
    name: "María Maker-Smith",
    email: "maker@ucsd.edu",
    dateSigned: "2026-08-10",
    aNumber: "A12345678",
    ...overrides,
  };
}

test("normalizes identifiers, emails, and names", () => {
  assert.equal(normalizeIdentifier(" a-123 45678 "), "A12345678");
  assert.equal(normalizeEmail(" Maker@UCSD.EDU "), "maker@ucsd.edu");
  assert.equal(normalizeName("Maker-Smith, María"), normalizeName("María Maker Smith"));
});

test("matches a unique signed waiver by identifier", () => {
  assert.deepEqual(matchWaiver(person, [waiver()]), {
    status: "matched",
    rowNumber: 2,
    method: "identifier",
  });
});

test("ignores a row without a signature date", () => {
  assert.deepEqual(matchWaiver(person, [waiver({ dateSigned: "" })]), {
    status: "not_found",
    reason: "no_safe_match",
  });
});

test("uses email to resolve duplicate identifier rows", () => {
  assert.deepEqual(
    matchWaiver(person, [
      waiver({ rowNumber: 2, email: "someone-else@ucsd.edu" }),
      waiver({ rowNumber: 3 }),
    ]),
    { status: "matched", rowNumber: 3, method: "identifier_and_email" },
  );
});

test("uses normalized name after identifier and email still duplicate", () => {
  assert.deepEqual(
    matchWaiver(person, [
      waiver({ rowNumber: 2, name: "Different Person" }),
      waiver({ rowNumber: 3, name: "Maker Smith, Maria" }),
    ]),
    { status: "matched", rowNumber: 3, method: "identifier_email_and_name" },
  );
});

test("flags unresolved duplicate identifiers for staff review", () => {
  assert.deepEqual(
    matchWaiver(person, [waiver({ rowNumber: 7 }), waiver({ rowNumber: 8 })]),
    {
      status: "ambiguous",
      candidateRowNumbers: [7, 8],
      reason: "duplicate_identifier",
    },
  );
});

test("falls back only when both email and name agree", () => {
  assert.deepEqual(
    matchWaiver(person, [waiver({ rowNumber: 12, aNumber: "A00000000", name: "Maker Smith, Maria" })]),
    { status: "matched", rowNumber: 12, method: "email_and_name" },
  );
});

test("never activates from email alone or name alone", () => {
  assert.deepEqual(
    matchWaiver(person, [waiver({ aNumber: "A00000000", name: "Different Person" })]),
    { status: "not_found", reason: "no_safe_match" },
  );
  assert.deepEqual(
    matchWaiver(person, [waiver({ aNumber: "A00000000", email: "different@ucsd.edu" })]),
    { status: "not_found", reason: "no_safe_match" },
  );
});

test("flags duplicate email-and-name fallback matches", () => {
  assert.deepEqual(
    matchWaiver(person, [
      waiver({ rowNumber: 20, aNumber: "" }),
      waiver({ rowNumber: 21, aNumber: "A99999999" }),
    ]),
    {
      status: "ambiguous",
      candidateRowNumbers: [20, 21],
      reason: "duplicate_email_and_name",
    },
  );
});
