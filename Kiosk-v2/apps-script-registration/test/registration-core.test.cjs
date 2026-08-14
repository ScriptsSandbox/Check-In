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

test("accepts exactly nine digits for Triton Student Numbers", () => {
  assert.equal(call('normalizeIdentifier_("200-010-746", "Triton Student Number (TSN)")'), "200010746");
  assert.equal(call('normalizeIdentifier_("20001074", "Triton Student Number (TSN)")'), "");
  assert.equal(call('normalizeIdentifier_("A00010746", "Triton Student Number (TSN)")'), "");
});

test("requires canonical affiliation choices and an explanation for Other", () => {
  assert.equal(call('canonicalAffiliation_("CASPO-O&A", "")'), "CASPO-O&A");
  assert.equal(call('canonicalAffiliation_("Community member – no institutional affiliation", "")'), "Community member – no institutional affiliation");
  assert.equal(call('canonicalAffiliation_("Other", "Coastal nonprofit")'), "Other – Coastal nonprofit");
  assert.equal(call('canonicalAffiliation_("External university or institution", "Caltech")'), "External university or institution – Caltech");
  assert.equal(call('canonicalAffiliation_("External university or institution", "")'), "");
  assert.equal(call('canonicalAffiliation_("Other", "")'), "");
  assert.equal(call('canonicalAffiliation_("BO", "")'), "");
});

test("accepts visitor and community roles", () => {
  assert.equal(call('canonicalRole_("Visiting scholar or visitor", "")'), "Visiting scholar or visitor");
  assert.equal(call('canonicalRole_("Community member", "")'), "Community member");
});

test("accepts role-specific majors, graduate programs, and UCSD departments", () => {
  assert.equal(call('canonicalAffiliation_("Marine Biology", "")'), "Marine Biology");
  assert.equal(call('canonicalAffiliation_("Applied Ocean Science", "")'), "Applied Ocean Science");
  assert.equal(call('canonicalAffiliation_("Mechanical & Aerospace Engineering", "")'), "Mechanical & Aerospace Engineering");
  assert.equal(call('canonicalAffiliation_("Electrical & Computer Engineering", "")'), "Electrical & Computer Engineering");
  assert.equal(call('canonicalAffiliation_("San Diego State University", "")'), "San Diego State University");
});

test("requires anticipated graduation for student roles only", () => {
  assert.equal(call('isStudentRole_("MAS Student")'), true);
  assert.equal(call('isStudentRole_("Academic")'), false);
  assert.equal(call('normalizeAnticipatedGraduation_("2028-06")'), "2028-06");
  assert.equal(call('normalizeAnticipatedGraduation_("Spring 2028")'), "");
});

test("rejects bots, rushed submissions, and missing consent", () => {
  const base = {
    firstName: "Test",
    lastName: "Member",
    role: "Graduate Student MS, PhD",
    affiliation: "CASPO-O&A",
    anticipatedGraduation: "2028-06",
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
