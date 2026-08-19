const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "RegistrationCore.gs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

const peopleHeaders = ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"];
const identifierHeaders = ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"];
const registrationHeaders = ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"];
const fabmanProvisioningHeaders = ["Provisioning ID", "Person ID", "First Name", "Last Name", "Status", "Attempt Count", "Last Attempt At", "Next Attempt At", "FabMan Member ID", "Last Error", "Created At", "Updated At"];

function makeSheet(name, headers, existingRows = []) {
  const appended = [];
  return {
    appended,
    getName: () => name,
    getLastColumn: () => headers.length,
    getLastRow: () => 1 + existingRows.length + appended.length,
    getRange(row, column, rowCount, columnCount) {
      if (row === 1) return { getDisplayValues: () => [headers] };
      if (row === 2 && column === 1 && rowCount === existingRows.length) {
        return { getDisplayValues: () => existingRows };
      }
      return {
        setNumberFormat() { return this; },
        setValues(values) { appended.push(values[0]); return this; },
      };
    },
  };
}

function makeHarness(existingIdentifiers = []) {
  const people = makeSheet("People", peopleHeaders);
  const identifiers = makeSheet("Identifiers", identifierHeaders, existingIdentifiers);
  const registrations = makeSheet("Registrations", registrationHeaders);
  const fabmanProvisioning = makeSheet("FabMan Provisioning", fabmanProvisioningHeaders);
  let released = false;
  let uuid = 0;
  const spreadsheet = {
    getId: () => "production-sheet-id",
    getName: () => "Scripps Sandbox Database v2 — Production",
    getSheetByName: (name) => ({ People: people, Identifiers: identifiers, Registrations: registrations, "FabMan Provisioning": fabmanProvisioning }[name]),
  };
  const context = vm.createContext({
    Date,
    HtmlService: {},
    Utilities: { getUuid: () => `uuid-${++uuid}` },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name) => name === "WAIVER_POWERFORM_URL" ? "https://example.test/waiver" : "production-sheet-id",
      }),
    },
    SpreadsheetApp: { openById: () => spreadsheet, flush: () => {} },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => { released = true; } }),
    },
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(appSource, context);
  context.registrationProvisionFabman_ = () => ({ ok: true, status: "Complete", memberId: 123 });
  return { context, people, identifiers, registrations, fabmanProvisioning, wasReleased: () => released };
}

function validPayload(overrides = {}) {
  return {
    firstName: "Test",
    lastName: "Member",
    preferredName: "",
    role: "Graduate Student (PhD)",
    affiliation: "CASPO-O&A",
    anticipatedGraduation: "2028-06",
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

test("creates normalized person, identifier, email, and registration rows", () => {
  const harness = makeHarness();
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, true);
  assert.equal(harness.people.appended.length, 1);
  assert.equal(harness.identifiers.appended.length, 2);
  assert.equal(harness.registrations.appended.length, 1);
  assert.equal(harness.fabmanProvisioning.appended.length, 1);
  assert.equal(harness.people.appended[0][peopleHeaders.indexOf("Role")], "Graduate Student (PhD)");
  assert.equal(harness.identifiers.appended[0][identifierHeaders.indexOf("Type")], "PID");
  assert.equal(harness.registrations.appended[0][registrationHeaders.indexOf("Program / Department")], "CASPO-O&A");
  assert.equal(harness.registrations.appended[0][registrationHeaders.indexOf("Status")], "Submitted");
  assert.equal(harness.registrations.appended[0][registrationHeaders.indexOf("Anticipated Graduation")], "2028-06");
  assert.equal(harness.fabmanProvisioning.appended[0][fabmanProvisioningHeaders.indexOf("Status")], "Pending");
  assert.equal(harness.wasReleased(), true);
});

test("stores a TSN with its own identifier type", () => {
  const harness = makeHarness();
  harness.context.payload = validPayload({ identifierType: "Triton Student Number (TSN)", identifier: "200010746" });
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, true);
  assert.equal(harness.identifiers.appended[0][identifierHeaders.indexOf("Type")], "TSN");
  assert.equal(harness.identifiers.appended[0][identifierHeaders.indexOf("Normalized Value")], "200010746");
});

test("does not append when an active identifier already exists", () => {
  const existing = identifierHeaders.map(() => "");
  existing[identifierHeaders.indexOf("Type")] = "PID";
  existing[identifierHeaders.indexOf("Normalized Value")] = "A12345678";
  existing[identifierHeaders.indexOf("Active")] = "TRUE";
  const harness = makeHarness([existing]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(harness.people.appended.length, 0);
  assert.equal(harness.identifiers.appended.length, 0);
  assert.equal(harness.registrations.appended.length, 0);
});

test("does not append when an active email already exists", () => {
  const existing = identifierHeaders.map(() => "");
  existing[identifierHeaders.indexOf("Type")] = "Email";
  existing[identifierHeaders.indexOf("Normalized Value")] = "test.member@example.edu";
  existing[identifierHeaders.indexOf("Active")] = "TRUE";
  const harness = makeHarness([existing]);
  harness.context.payload = validPayload();
  const result = vm.runInContext("submitRegistration(payload)", harness.context);
  assert.equal(result.ok, false);
  assert.equal(harness.people.appended.length, 0);
});

test("extracts a completed DocuSign waiver and normalizes the UCSD ID", () => {
  const harness = makeHarness();
  harness.context.webhookPayload = {
    event: "envelope-completed",
    data: {
      envelopeId: "envelope-123",
      templateId: "template-456",
      envelopeSummary: {
        status: "completed",
        recipients: {
          signers: [{
            tabs: {
              textTabs: [
                { tabLabel: "participant_name", value: "Ada Lovelace" },
                { tabLabel: "participant_email", value: "ADA@UCSD.EDU" },
                { tabLabel: "ucsd_id", value: "A12345678" },
              ],
            },
          }],
        },
      },
    },
  };
  const result = vm.runInContext("extractCompletedDocuSignWaiver_(webhookPayload)", harness.context);
  assert.equal(result.envelopeId, "envelope-123");
  assert.equal(result.templateId, "template-456");
  assert.equal(result.participantName, "Ada Lovelace");
  assert.equal(result.participantEmail, "ada@ucsd.edu");
  assert.equal(result.normalizedIdentifier, "12345678");
});

test("ignores DocuSign events that are not completed", () => {
  const harness = makeHarness();
  harness.context.webhookPayload = { event: "envelope-sent", data: { envelopeId: "envelope-123", status: "sent" } };
  const result = vm.runInContext("extractCompletedDocuSignWaiver_(webhookPayload)", harness.context);
  assert.equal(result, null);
});
