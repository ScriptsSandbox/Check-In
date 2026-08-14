import assert from "node:assert/strict";
import test from "node:test";

import {
  affiliationOptions,
  emptyProfile,
  nextProfileQuestion,
  normalizedProfileAnswer,
} from "../lib/profile-enrichment.ts";

test("asks only the next missing profile question", () => {
  const profile = emptyProfile();
  assert.equal(nextProfileQuestion(profile)?.field, "role");
  profile.role = "Undergraduate Student (UG)";
  assert.equal(nextProfileQuestion(profile)?.field, "affiliation");
  profile.affiliation = "Marine Biology";
  assert.equal(nextProfileQuestion(profile)?.field, "anticipatedGraduation");
  profile.anticipatedGraduation = "2028-06";
  assert.equal(nextProfileQuestion(profile), null);
});

test("does not ask non-undergraduates for graduation", () => {
  assert.equal(nextProfileQuestion({ role: "Staff", affiliation: "SIO/DO", anticipatedGraduation: "" }), null);
  assert.equal(nextProfileQuestion({ role: "Graduate Student MS, PhD", affiliation: "Marine Biology", anticipatedGraduation: "" }), null);
});

test("offers role-appropriate choices", () => {
  assert.ok(affiliationOptions("Undergraduate Student (UG)").includes("Marine Biology"));
  assert.ok(affiliationOptions("Graduate Student MS, PhD").includes("Electrical & Computer Engineering"));
  assert.ok(affiliationOptions("Staff").includes("IOD-Biology"));
});

test("normalizes kiosk answers", () => {
  assert.equal(normalizedProfileAnswer("role", "  Staff  "), "Staff");
  assert.equal(normalizedProfileAnswer("anticipatedGraduation", "2028-06"), "2028-06");
  assert.equal(normalizedProfileAnswer("anticipatedGraduation", "spring 2028"), "");
});
