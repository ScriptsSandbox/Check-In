const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const coreSource = fs.readFileSync(path.join(root, "RegistrationCore.gs"), "utf8");
const appSource = fs.readFileSync(path.join(root, "Code.gs"), "utf8");

function harness(responses) {
  const calls = [];
  const context = vm.createContext({
    Date,
    console,
    encodeURIComponent,
    Utilities: { formatDate: () => "2026-08-19" },
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(appSource, context);
  context.registrationFabmanFetch_ = (path, method, payload) => {
    calls.push({ path, method: method || "get", payload });
    const response = responses.shift();
    if (!response) throw new Error(`Unexpected FabMan request: ${path}`);
    return response;
  };
  return { context, calls };
}

const profile = {
  personId: "person_123",
  firstName: "Test",
  lastName: "Member",
  email: "test.member@ucsd.edu",
  identifierType: "TSN",
  identifier: "200010746",
};

test("reuses one exact-email FabMan member", () => {
  const member = { id: 42, firstName: "Test", lastName: "Member", emailAddress: "test.member@ucsd.edu", memberNumber: "different" };
  const h = harness([
    { ok: true, data: [] },
    { ok: true, data: [member] },
    { ok: true, data: [] },
  ]);
  h.context.profile = profile;
  const result = vm.runInContext("registrationFindFabmanMember_(profile)", h.context);
  assert.equal(result.member.id, 42);
  assert.equal(result.method, "Automatic registration: exact email");
});

test("ignores tokenized search results without an exact identity match", () => {
  const unrelated = { id: 99, firstName: "Another", lastName: "Person", emailAddress: "other@ucsd.edu", memberNumber: "999" };
  const h = harness([
    { ok: true, data: [] },
    { ok: true, data: [unrelated] },
    { ok: true, data: [] },
  ]);
  h.context.profile = profile;
  const result = vm.runInContext("registrationFindFabmanMember_(profile)", h.context);
  assert.equal(result, null);
});

test("stops when exact signals point to different FabMan members", () => {
  const byPerson = { id: 41, firstName: "Test", lastName: "Member", metadata: { scrippsSandboxPersonId: "person_123" } };
  const byEmail = { id: 42, firstName: "Test", lastName: "Member", emailAddress: "test.member@ucsd.edu" };
  const h = harness([
    { ok: true, data: [byPerson] },
    { ok: true, data: [byEmail] },
    { ok: true, data: [] },
  ]);
  h.context.profile = profile;
  assert.throws(() => vm.runInContext("registrationFindFabmanMember_(profile)", h.context), /Multiple FabMan members/);
});

test("does not add a duplicate active Sandbox package", () => {
  const h = harness([{ ok: true, data: [{ package: 9464, state: "active" }] }]);
  vm.runInContext("registrationEnsureFabmanPackage_(42)", h.context);
  assert.equal(h.calls.length, 1);
});

test("adds the Sandbox package when it is missing", () => {
  const h = harness([
    { ok: true, data: [] },
    { ok: true, data: { id: 123 } },
  ]);
  vm.runInContext("registrationEnsureFabmanPackage_(42)", h.context);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].method, "post");
  assert.equal(h.calls[1].payload[0].package, 9464);
});
