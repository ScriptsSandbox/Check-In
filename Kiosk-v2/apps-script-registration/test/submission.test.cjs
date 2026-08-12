const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "RegistrationCore.gs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

const headers = [
  "Name", "Timestamp", "Card UUID", "Student ID", "Type", "Email Address",
  "Secondary Email", "Waiver Signed?", "Planer", "Review Status",
  "Registration Source", "Registration Submitted At", "Reviewed By", "Reviewed At",
  "Program / Department", "Role", "Identifier Type", "DocuSign Status", "Consent Version",
];

function makeHarness(existingRows = []) {
  const appended = [];
  const sheet = {
    getLastColumn: () => headers.length,
    getLastRow: () => existingRows.length + 1,
    getName: () => "Form Responses 1",
    getParent: () => ({ getId: () => "test-sheet-id", getName: () => "Testing User Database SIO" }),
    getRange(row, column, rowCount) {
      if (row === 1) return { getDisplayValues: () => [headers] };
      if (row === 2 && column === 4 && rowCount === existingRows.length) {
        return { getDisplayValues: () => existingRows };
      }
      throw new Error(`Unexpected range ${row},${column},${rowCount}`);
    },
    appendRow: (row) => appended.push(row),
  };
  let released = false;
  const context = vm.createContext({
    HtmlService: {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => name === "WAIVER_POWERFORM_URL" ? "https://example.test/waiver" : "test-sheet-id",
      }),
    },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }),
    },
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(appSource, context);
  return { context, appended, wasReleased: () => released };
}

function validPayload(overrides = {}) {
  return {
    firstName: "Test",
    lastName: "Member",
    preferredName: "",
    role: "Graduate student",
    affiliation: "Scripps – Biological Oceanography",
    identifierType: "Student PID",
    identifier: "A12345678",
    primaryEmail: "test.member@example.edu",
    secondaryEmail: "",
    website: "",
    consent: true,
    formStartedAt: Date.now() - 3000,
    ...overrides,
  };
}

test("appends an immediately active row with after-the-fact review metadata", () => {
  const harness = makeHarness();
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, true);
  assert.equal(harness.appended.length, 1);
  const row = harness.appended[0];
  assert.equal(row[headers.indexOf("Student ID")], "A12345678");
  assert.equal(row[headers.indexOf("Review Status")], "Unreviewed");
  assert.equal(row[headers.indexOf("DocuSign Status")], "Awaiting verification");
  assert.equal(row[headers.indexOf("Card UUID")], "");
  assert.equal(harness.wasReleased(), true);
});

test("does not overwrite or append when an ID already exists", () => {
  const harness = makeHarness([["A12345678", "Graduate student", "someone@example.edu"]]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appended.length, 0);
});

test("does not append when the primary email already exists", () => {
  const harness = makeHarness([["A87654321", "Staff", "TEST.MEMBER@example.edu"]]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appended.length, 0);
});
