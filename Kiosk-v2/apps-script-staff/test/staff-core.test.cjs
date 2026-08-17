const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(require.resolve("../StaffCore.gs"), "utf8");
const indexHtml = fs.readFileSync(require.resolve("../Index.html"), "utf8");
const sandbox = { module: { exports: {} } };
vm.runInNewContext(code, sandbox);
const core = sandbox.module.exports;

test("preferred name is privacy-limited to the first displayed name", () => {
  assert.equal(core.staffPreferredName_("Maya Chen"), "Maya");
  assert.equal(core.staffPreferredName_(""), "Member");
});

test("staff search identity shows only a last initial", () => {
  assert.equal(core.staffPrivateName_("Alexandra Martinez"), "Alexandra M.");
  assert.equal(core.staffPrivateName_("Alex"), "Alex");
});

test("identifier hints reveal only the final four characters", () => {
  assert.equal(core.staffIdentifierHint_("A12345678"), "ID ending 5678");
  assert.equal(core.staffIdentifierHint_("23"), "");
});

test("new Scripps waivers match completed records by normalized ID or email", () => {
  const records = [
    { Status: "completed", "Participant Email": "member@ucsd.edu", "Participant ID": "A12345678", "Normalized Identifier": "12345678" },
    { Status: "voided", "Participant Email": "voided@ucsd.edu", "Participant ID": "A87654321", "Normalized Identifier": "87654321" },
  ];
  const matches = core.staffScrippsWaiverMatchesFromRecords_([
    { requestId: "by-id", identifiers: ["A12345678"], email: "" },
    { requestId: "by-email", identifiers: [], email: "MEMBER@UCSD.EDU" },
    { requestId: "voided", identifiers: ["A87654321"], email: "voided@ucsd.edu" },
  ], records);
  assert.deepEqual({ ...matches }, { "by-id": true, "by-email": true });
});

test("legacy waivers match by exact normalized ID or email", () => {
  const records = [
    { Name: "Raymmah Grandy Garcia", Email: "rag002@ucsd.edu", Date_Signed: "2026-08-17", A_Number: "A53258193" },
    { Name: "Maria G Diaz Gonzalez", Email: "mdiazgonzalez@ucsd.edu", Date_Signed: "2026-03-09", A_Number: "A69044638" },
  ];
  const matches = core.staffLegacyWaiverMatchesFromRecords_([
    { requestId: "raymmah", identifiers: ["53258193"], email: "" },
    { requestId: "maria", identifiers: [], email: "MDIAZGONZALEZ@UCSD.EDU" },
    { requestId: "wrong", identifiers: ["A69044639"], email: "other@ucsd.edu" },
  ], records);
  assert.deepEqual({ ...matches }, { raymmah: true, maria: true });
});

test("Mark left immediately exposes a disabled processing state", () => {
  assert.match(indexHtml, /left\.disabled=true/);
  assert.match(indexHtml, /left\.setAttribute\("aria-busy","true"\)/);
  assert.match(indexHtml, /left\.textContent="Marking left…"/);
});

test("legacy tool keys become readable approval labels", () => {
  assert.equal(core.staffToolLabel_("epilog_laser_cutter"), "Laser cutter");
  assert.equal(core.staffToolLabel_("wood_shop"), "Wood Shop");
});

test("roles collapse to the small staff-facing set", () => {
  assert.equal(core.staffRoleLabel_("Graduate student"), "Student");
  assert.equal(core.staffRoleLabel_("Scripps staff"), "Staff");
  assert.equal(core.staffRoleLabel_("Faculty"), "Faculty");
});

test("boolean and text normalization are conservative", () => {
  assert.equal(core.staffTrue_("YES"), true);
  assert.equal(core.staffTrue_("no"), false);
  assert.equal(core.staffClean_(" a\n b ", 20), "a b");
});

test("read-only sheet validation allows added and reordered columns", () => {
  const required = ["Registration ID", "Person ID", "Status", "Source"];
  const actual = ["Status", "Anticipated Graduation", "Registration ID", "Source", "Person ID"];
  assert.deepEqual(Array.from(core.staffMissingHeaders_(actual, required)), []);
  assert.deepEqual(Array.from(core.staffMissingHeaders_(actual, required.concat("DocuSign Status"))), ["DocuSign Status"]);
});

test("attention flags distinguish account and waiver follow-up", () => {
  assert.deepEqual(Array.from(core.staffAttentionFlags_({ Status: "Incomplete", "DocuSign Status": "Awaiting verification" })), ["Account incomplete", "Waiver verification pending"]);
  assert.deepEqual(Array.from(core.staffAttentionFlags_({ Status: "Active", "DocuSign Status": "Signed" })), []);
  assert.deepEqual(Array.from(core.staffAttentionFlags_(null)), []);
});

test("manual check-in is provenance rather than an attention flag", () => {
  const details = core.staffVisitFlagDetails_("Manual check-in, Unknown card");
  assert.deepEqual(Array.from(details.flags), ["Unknown card"]);
  assert.equal(details.checkInMethod, "Staff check-in");
  const normal = core.staffVisitFlagDetails_("Duplicate tap");
  assert.deepEqual(Array.from(normal.flags), ["Duplicate tap"]);
  assert.equal(normal.checkInMethod, "");
});

test("staff profile edits validate role and student graduation", () => {
  const undergraduate = core.staffValidateProfile_({ role: "Undergraduate Student (UG)", affiliation: "Marine Biology", anticipatedGraduation: "2028-06" });
  assert.equal(undergraduate.ok, true);
  assert.equal(undergraduate.value.anticipatedGraduation, "2028-06");
  assert.equal(core.staffValidateProfile_({ role: "UG Student Employee", affiliation: "Marine Biology", anticipatedGraduation: "2028-06" }).ok, false);
  assert.equal(core.staffValidateProfile_({ role: "Graduate Student (MS)", affiliation: "Marine Biology", anticipatedGraduation: "" }).ok, false);
  assert.equal(core.staffValidateProfile_({ role: "Graduate Student (PhD)", affiliation: "Marine Biology", anticipatedGraduation: "2030-06" }).ok, true);
  assert.equal(core.staffValidateProfile_({ role: "Graduate Student MS, PhD", affiliation: "Marine Biology", anticipatedGraduation: "2030-06" }).ok, false);
  const staff = core.staffValidateProfile_({ role: "Staff", affiliation: "SIO/DO", anticipatedGraduation: "2028-06" });
  assert.equal(staff.ok, true);
  assert.equal(staff.value.anticipatedGraduation, "");
});
