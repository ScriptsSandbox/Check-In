const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "RegistrationCore.gs"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const call = (expression) => vm.runInContext(expression, context);

test("normalizes PIDs to the canonical A-number form", () => {
  assert.equal(call('normalizeIdentifier_("1234-5678", "Student PID")'), "A12345678");
  assert.equal(call('normalizeIdentifier_("a12345678", "Student PID")'), "A12345678");
  assert.equal(call('normalizeIdentifier_("A123", "Student PID")'), "");
});

test("accepts employee IDs without pretending they are student PIDs", () => {
  assert.equal(call('normalizeIdentifier_("12345678", "Employee ID")'), "12345678");
  assert.equal(call('normalizeIdentifier_("A12345678", "Employee ID")'), "");
});

test("requires canonical affiliation choices and an explanation for Other", () => {
  assert.equal(call('canonicalAffiliation_("Scripps – Biological Oceanography", "")'), "Scripps – Biological Oceanography");
  assert.equal(call('canonicalAffiliation_("Other", "Coastal nonprofit")'), "Other – Coastal nonprofit");
  assert.equal(call('canonicalAffiliation_("Other", "")'), "");
  assert.equal(call('canonicalAffiliation_("BO", "")'), "");
});

test("rejects bots, rushed submissions, and missing consent", () => {
  const base = {
    firstName: "Test",
    lastName: "Member",
    role: "Graduate student",
    affiliation: "Scripps – Biological Oceanography",
    identifierType: "Student PID",
    identifier: "A12345678",
    primaryEmail: "test@example.edu",
    secondaryEmail: "",
    consent: true,
    website: "",
    formStartedAt: 1000,
  };
  context.payload = base;
  assert.equal(call("validateRegistration_(payload, 4000).ok"), true);
  context.payload = { ...base, website: "spam" };
  assert.equal(call("validateRegistration_(payload, 4000).ok"), false);
  context.payload = { ...base, consent: false };
  assert.equal(call("validateRegistration_(payload, 4000).ok"), false);
  context.payload = { ...base, formStartedAt: 3500 };
  assert.equal(call("validateRegistration_(payload, 4000).ok"), false);
});

test("neutralizes spreadsheet formula prefixes", () => {
  assert.equal(call('sheetSafe_("=IMPORTXML(1)")'), "'=IMPORTXML(1)");
  assert.equal(call('sheetSafe_("Normal Name")'), "Normal Name");
});
