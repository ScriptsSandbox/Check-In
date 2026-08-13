const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const code = fs.readFileSync(require.resolve("../StaffCore.gs"), "utf8");
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
