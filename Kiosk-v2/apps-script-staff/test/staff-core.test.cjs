const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(require.resolve("../StaffCore.gs"), "utf8");
const indexHtml = fs.readFileSync(require.resolve("../Index.html"), "utf8");
const serverCode = fs.readFileSync(require.resolve("../Code.gs"), "utf8");
const sandbox = {
  module: { exports: {} },
  Utilities: { formatDate: date => new Date(date).toISOString().slice(0, 10) },
};
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
  assert.deepEqual(Array.from(core.staffAttentionFlags_({ Status: "Unreviewed", "DocuSign Status": "Awaiting verification" }, true)), []);
  assert.deepEqual(Array.from(core.staffAttentionFlags_({ Status: "Submitted", "DocuSign Status": "Awaiting verification" }, false)), ["Waiver verification pending"]);
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

test("compact presence records derive today's final state and reopened arrival", () => {
  const today = new Date();
  today.setUTCHours(16, 0, 0, 0);
  const later = new Date(today.getTime() + 10 * 60 * 1000);
  const reopened = new Date(today.getTime() + 12 * 60 * 1000);
  const presence = core.staffPresenceFromSnapshotRecords_([
    { "Person ID": "person-1", Name: "Jordan Lee", Role: "Graduate Student (MS)", "Check In At": today.toISOString(), "Event Type": "User Checkin", Flags: "" },
    { "Person ID": "person-1", Name: "Jordan Lee", Role: "Graduate Student (MS)", "Check In At": later.toISOString(), "Event Type": "Staff Checkout", Flags: "" },
    { "Person ID": "person-1", Name: "Jordan Lee", Role: "Graduate Student (MS)", "Check In At": reopened.toISOString(), "Event Type": "Staff Reopen", Flags: "Manual check-in" },
  ], "UTC");
  assert.equal(presence.present.length, 1);
  assert.equal(presence.left.length, 0);
  assert.equal(presence.present[0].name, "Jordan");
  assert.equal(presence.present[0].checkedInAt, reopened.toISOString());
  assert.equal(presence.present[0].checkInMethod, "Staff check-in");
});

test("people details enrich the compact presence feed without losing visit flags", () => {
  const presence = { present: [{ personId: "person-1", tools: [], flags: ["Closing soon"] }], left: [] };
  core.staffEnrichPresence_(presence, [{ personId: "person-1", attention: ["Waiver verification pending"], toolLabels: ["Laser cutter"] }]);
  assert.deepEqual(Array.from(presence.present[0].tools), ["Laser cutter"]);
  assert.deepEqual(Array.from(presence.present[0].flags), ["Closing soon", "Waiver verification pending"]);
  assert.equal(presence.present[0].detailsPending, false);
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

test("task drafts accept simple optional metadata and reject unsafe values", () => {
  const task = core.staffValidateTask_({ title: "  Refill laser supplies ", estimatedMinutes: "10", suggestedFor: "", priority: "High" });
  assert.equal(task.ok, true);
  assert.deepEqual({ ...task.value }, {
    title: "Refill laser supplies",
    details: "",
    estimatedMinutes: 10,
    suggestedFor: "Anyone",
    priority: "High",
  });
  assert.equal(core.staffValidateTask_({ title: "", priority: "Normal" }).ok, false);
  assert.equal(core.staffValidateTask_({ title: "Test", estimatedMinutes: "2" }).ok, false);
  assert.equal(core.staffValidateTask_({ title: "Test", priority: "Urgent" }).ok, false);
});

test("task workflow uses only the four board columns", () => {
  assert.equal(core.staffValidateTaskStatus_("To do").ok, true);
  assert.equal(core.staffValidateTaskStatus_("Review / test").ok, true);
  assert.equal(core.staffValidateTaskStatus_("Blocked").ok, false);
});

test("staff desk includes a task board and manager-only bulk paste entry point", () => {
  assert.match(indexHtml, /data-view="tasks"/);
  assert.match(indexHtml, /id="bulkTaskDialog"/);
  assert.match(indexHtml, /canBulkImport/);
  assert.match(indexHtml, /staffBulkCreateTasks/);
});

test("staff desk loads compact presence separately from the background people index", () => {
  assert.match(indexHtml, /call\("staffPresence"\)/);
  assert.match(indexHtml, /call\("staffPeopleIndex"\)/);
  assert.match(indexHtml, /setInterval\(\(\)=>refresh\(true\),6000\)/);
  assert.match(indexHtml, /setInterval\(\(\)=>refreshPeopleIndex\(true\),600000\)/);
  assert.match(indexHtml, /presenceOverrides/);
  assert.match(indexHtml, /async function startStaffDesk\(\)\{await refresh\(false\);diagnostics\.presenceReadyMs=Date\.now\(\)-diagnosticsStartedAt;refreshPeopleIndex\(true\);\}/);
  assert.match(indexHtml, /window\.STAFF_DESK_PERFORMANCE/);
  assert.doesNotMatch(indexHtml, /call\("staffDashboard"\)/);
});

test("Mark left confirmation offers an immediate Undo action", () => {
  assert.match(indexHtml, /toast\(`\$\{r\.name\} marked as left`,\{label:"Undo",run:\(\)=>reopenPresence\(personId\)\}\)/);
  assert.match(indexHtml, /function reopenPresence\(personId\)/);
  assert.match(indexHtml, /className="toast-action"/);
});

test("staff desk browser scripts remain valid JavaScript", () => {
  const scripts = Array.from(indexHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g), match => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach(script => new Function(script.replace(/<\?!=\s*bootstrap\s*\?>/g, "{}")));
});

test("server defines the formula-backed Current Presence feed", () => {
  assert.match(serverCode, /name: "Current Presence"/);
  assert.match(serverCode, /function staffCurrentPresenceFormula_/);
  assert.match(serverCode, /Col4 >= date/);
  assert.match(serverCode, /function staffPresence\(\)/);
});
