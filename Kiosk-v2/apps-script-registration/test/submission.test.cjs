const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "RegistrationCore.gs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

const headers = {
  People: ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"],
  Identifiers: ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"],
  Registrations: ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"],
  Cards: ["Card ID", "Person ID", "Card Digest", "Last Four", "Status", "Linked At", "Retired At", "Source System", "Source Row"],
  Visits: ["Visit ID", "Person ID", "Check In At", "Event Type", "Authorizing Entity", "Flags", "Notes", "Source System", "Source Row"],
  "Staff Access": ["Staff ID", "Name", "Email", "Role", "Active", "Card Linking Allowed", "Notes"],
  "FabMan Links": ["Link ID", "Person ID", "FabMan Member ID", "Status", "Match Method", "Confirmed By", "Confirmed At", "Notes"],
  "Card Update Sessions": ["Session ID", "Code Digest", "Person ID", "Status", "New Identifier Type", "New Identifier Value", "New Identifier Normalized", "Disable Old Card", "Old Card Disabled At", "Requested By", "Requested At", "Expires At", "Completed At", "FabMan Status", "Notes", "FabMan Key Type"],
};

function makeHarness(existingIdentifiers = []) {
  const appended = { People: [], Identifiers: [], Registrations: [], Cards: [], Visits: [], "Staff Access": [] };
  const sheets = {};
  Object.keys(headers).forEach((name) => {
    sheets[name] = {
      getName: () => name,
      getLastRow: () => 1 + (name === "Identifiers" ? existingIdentifiers.length : 0) + appended[name].length,
      getLastColumn: () => headers[name].length,
      getRange(row, column, rowCount) {
        if (row === 1) return { getDisplayValues: () => [headers[name]] };
        if (name === "Identifiers" && row === 2 && column === 5 && rowCount === existingIdentifiers.length) {
          return { getDisplayValues: () => existingIdentifiers.map((value) => [value]) };
        }
        throw new Error(`Unexpected range ${name} ${row},${column},${rowCount}`);
      },
      appendRow: (row) => appended[name].push(row),
      deleteRow: () => appended[name].pop(),
    };
  });
  let released = false;
  let uuid = 0;
  const spreadsheet = {
    getId: () => "test-sheet-id",
    getName: () => "Scripps Sandbox Database v2",
    getSheetByName: (name) => sheets[name],
  };
  const context = vm.createContext({
    HtmlService: {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => name === "WAIVER_POWERFORM_URL" ? "https://example.test/waiver" : "test-sheet-id",
      }),
    },
    SpreadsheetApp: { openById: () => spreadsheet },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }),
    },
    Utilities: { getUuid: () => `00000000-0000-0000-0000-${String(++uuid).padStart(12, "0")}` },
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

test("creates normalized person, identifiers, and registration rows", () => {
  const harness = makeHarness();
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, true);
  assert.equal(harness.appended.People.length, 1);
  assert.equal(harness.appended.Identifiers.length, 2);
  assert.equal(harness.appended.Registrations.length, 1);
  const personId = harness.appended.People[0][headers.People.indexOf("Person ID")];
  assert.equal(harness.appended.People[0][headers.People.indexOf("Status")], "Active");
  assert.equal(harness.appended.Identifiers[0][headers.Identifiers.indexOf("Person ID")], personId);
  assert.equal(harness.appended.Identifiers[0][headers.Identifiers.indexOf("Normalized Value")], "A12345678");
  assert.equal(harness.appended.Registrations[0][headers.Registrations.indexOf("Status")], "Unreviewed");
  assert.equal(harness.appended.Registrations[0][headers.Registrations.indexOf("DocuSign Status")], "Awaiting verification");
  assert.equal(harness.appended.Registrations[0][headers.Registrations.indexOf("Anticipated Graduation")], "");
  assert.equal(harness.appended.Registrations[0][headers.Registrations.indexOf("Source")], "Online registration");
  assert.equal(harness.wasReleased(), true);
});

test("does not append when an ID already exists", () => {
  const harness = makeHarness(["A12345678"]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appended.People.length, 0);
});

test("does not append when the primary email already exists", () => {
  const harness = makeHarness(["TEST.MEMBER@example.edu"]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(result.code, "ALREADY_EXISTS");
  assert.equal(harness.appended.People.length, 0);
});
