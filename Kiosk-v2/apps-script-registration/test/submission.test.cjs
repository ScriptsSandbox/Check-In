const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "RegistrationCore.gs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

const userHeaders = [
  "Name", "Timestamp", "Card UUID", "Student ID", "Type", "Email Address",
  "Secondary Email", "Waiver Signed?", "Planer",
];
const reviewHeaders = [
  "Student ID", "User Database Row", "Review Status", "Registration Source",
  "Registration Submitted At", "Reviewed By", "Reviewed At",
  "Program / Department", "Role", "Identifier Type", "DocuSign Status", "Consent Version",
];

function makeHarness(existingRows = []) {
  const appendedUsers = [];
  const appendedReviews = [];
  const sheet = {
    getLastColumn: () => userHeaders.length,
    getLastRow: () => existingRows.length + appendedUsers.length + 1,
    getName: () => "Form Responses 1",
    getParent: () => ({ getId: () => "test-sheet-id", getName: () => "Testing User Database SIO" }),
    getRange(row, column, rowCount) {
      if (row === 1) return { getDisplayValues: () => [userHeaders] };
      if (row === 2 && column === 4 && rowCount === existingRows.length) {
        return { getDisplayValues: () => existingRows };
      }
      throw new Error(`Unexpected range ${row},${column},${rowCount}`);
    },
    appendRow: (row) => appendedUsers.push(row),
    deleteRow: () => appendedUsers.pop(),
  };
  const reviewSheet = {
    getLastColumn: () => reviewHeaders.length,
    getName: () => "Registration Review Log",
    getRange: () => ({ getDisplayValues: () => [reviewHeaders] }),
    appendRow: (row) => appendedReviews.push(row),
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
      openById: () => ({
        getSheetByName: (name) => name === "Registration Review Log" ? reviewSheet : sheet,
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }),
    },
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(appSource, context);
  return { context, appendedUsers, appendedReviews, wasReleased: () => released };
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
  assert.equal(harness.appendedUsers.length, 1);
  assert.equal(harness.appendedReviews.length, 1);
  const userRow = harness.appendedUsers[0];
  const reviewRow = harness.appendedReviews[0];
  assert.equal(userRow[userHeaders.indexOf("Student ID")], "A12345678");
  assert.equal(userRow[userHeaders.indexOf("Card UUID")], "");
  assert.equal(reviewRow[reviewHeaders.indexOf("Review Status")], "Unreviewed");
  assert.equal(reviewRow[reviewHeaders.indexOf("DocuSign Status")], "Awaiting verification");
  assert.equal(reviewRow[reviewHeaders.indexOf("User Database Row")], 2);
  assert.equal(harness.wasReleased(), true);
});

test("appends a TSN as the student's primary identifier", () => {
  const harness = makeHarness();
  harness.context.payload = validPayload({
    identifierType: "Triton Student Number (TSN)",
    identifier: "200010746",
  });
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, true);
  assert.equal(harness.appendedUsers[0][userHeaders.indexOf("Student ID")], "200010746");
  assert.equal(harness.appendedReviews[0][reviewHeaders.indexOf("Identifier Type")], "Triton Student Number (TSN)");
});

test("does not overwrite or append when an ID already exists", () => {
  const harness = makeHarness([["A12345678", "Graduate student", "someone@example.edu"]]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appendedUsers.length, 0);
  assert.equal(harness.appendedReviews.length, 0);
});

test("does not append when the primary email already exists", () => {
  const harness = makeHarness([["A87654321", "Staff", "TEST.MEMBER@example.edu"]]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appendedUsers.length, 0);
  assert.equal(harness.appendedReviews.length, 0);
});
