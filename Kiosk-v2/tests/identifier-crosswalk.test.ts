import assert from "node:assert/strict";
import test from "node:test";

import { normalizePid, normalizeTsn, planIdentifierCrosswalk } from "../lib/sync/identifier-crosswalk.ts";

test("normalizes PID and TSN without making them interchangeable", () => {
  assert.equal(normalizePid("1234-5678"), "A12345678");
  assert.equal(normalizeTsn("200-010-746"), "200010746");
  assert.equal(normalizePid("200010746"), "");
  assert.equal(normalizeTsn("A12345678"), "");
});

test("plans a TSN alias on the same person as an existing PID", () => {
  const plan = planIdentifierCrosswalk([{
    personId: "person_1", pid: "A12345678", tsn: "200010746",
    verifiedBy: "staff@ucsd.edu", verifiedAt: "2026-08-13", source: "UCSD crosswalk",
  }], [{ personId: "person_1", type: "PID", normalizedValue: "A12345678", active: true }]);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.alreadyPresent.length, 1);
  assert.deepEqual(plan.aliasesToCreate.map((alias) => [alias.type, alias.personId]), [["TSN", "person_1"]]);
});

test("blocks a PID or TSN that is already owned by another person", () => {
  const plan = planIdentifierCrosswalk([{
    personId: "person_2", pid: "A12345678", tsn: "200010746",
    verifiedBy: "staff@ucsd.edu", verifiedAt: "2026-08-13", source: "UCSD crosswalk",
  }], [{ personId: "person_1", type: "PID", normalizedValue: "A12345678", active: true }]);
  assert.ok(plan.errors.some((error) => error.includes("different person")));
  assert.deepEqual(plan.aliasesToCreate, []);
});

test("requires verification provenance before planning writes", () => {
  const plan = planIdentifierCrosswalk([{
    personId: "person_1", pid: "A12345678", tsn: "200010746",
    verifiedBy: "", verifiedAt: "", source: "",
  }], []);
  assert.equal(plan.errors.length, 1);
  assert.deepEqual(plan.aliasesToCreate, []);
});
