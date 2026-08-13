import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRegistrationIdentifier } from "../lib/registration.ts";

test("normalizes registration identifiers according to their declared type", () => {
  assert.equal(normalizeRegistrationIdentifier("1234-5678", "pid"), "A12345678");
  assert.equal(normalizeRegistrationIdentifier("200-010-746", "tsn"), "200010746");
  assert.equal(normalizeRegistrationIdentifier("000023", "employee_id"), "000023");
});

test("does not accept one identifier format as another type", () => {
  assert.equal(normalizeRegistrationIdentifier("A12345678", "tsn"), "");
  assert.equal(normalizeRegistrationIdentifier("200010746", "pid"), "");
  assert.equal(normalizeRegistrationIdentifier("20001074", "tsn"), "");
  assert.equal(normalizeRegistrationIdentifier("2000107460", "tsn"), "");
});
