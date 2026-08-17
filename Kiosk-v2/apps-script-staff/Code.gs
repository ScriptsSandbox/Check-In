const STAFF_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  legacyWaiverSpreadsheetId: "1KtaxQ13qnXknGVgUpQIKOnPhdSOulPYboHy0GwTtHfY",
  sheets: {
    people: { name: "People", headers: ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"] },
    identifiers: { name: "Identifiers", headers: ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"] },
    certifications: { name: "Tool Certifications", headers: ["Certification ID", "Person ID", "Tool Key", "Status", "Granted At", "Removed At", "Source System", "Source Rows", "Notes"] },
    registrations: { name: "Registrations", headers: ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"], allowAdditionalHeaders: true },
    cards: { name: "Cards", headers: ["Person ID", "Status"], allowAdditionalHeaders: true },
    visits: { name: "Visits", headers: ["Visit ID", "Person ID", "Check In At", "Event Type", "Authorizing Entity", "Flags", "Notes", "Source System", "Source Row"] },
    staffAccess: { name: "Staff Access", headers: ["Staff ID", "Name", "Email", "Role", "Active", "Card Linking Allowed", "Notes"] },
    training: { name: "Tool Training", headers: ["Training ID", "Person ID", "Tool", "Status", "Approved By", "Approved At", "FabMan Status", "Notes"] },
    fabmanLinks: { name: "FabMan Links", headers: ["Link ID", "Person ID", "FabMan Member ID", "Status", "Match Method", "Confirmed By", "Confirmed At", "Notes"] },
    notes: { name: "Staff Notes", headers: ["Note ID", "Note", "Created By", "Created At", "Status", "Resolved By", "Resolved At"] },
    kioskLinks: { name: "Kiosk Link Requests", headers: ["Request ID", "Person ID", "Display Name", "Requested By", "Requested At", "Expires At", "Status", "Completed At", "Message"], createIfMissing: true },
    scrippsWaivers: { name: "Scripps Waivers", headers: ["Received At", "Envelope ID", "Status", "Completed At", "Participant Name", "Participant Email", "Participant ID", "Normalized Identifier", "Template ID", "Source"], createIfMissing: true },
  },
};

var STAFF_SPREADSHEET_MEMO_ = null;
var STAFF_LEGACY_WAIVER_SHEET_MEMO_ = null;
var STAFF_RECORDS_MEMO_ = {};
const STAFF_CACHE_SECONDS_ = { dashboard: 8, person: 30, search: 30, fabman: 45 };

function doGet() {
  let access;
  try {
    access = staffRequireAccess_();
  } catch (error) {
    const denied = HtmlService.createTemplateFromFile("AccessDenied");
    denied.email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
    denied.accountChooserUrl = "https://accounts.google.com/AccountChooser?service=wise&continue=" + encodeURIComponent("https://script.google.com/macros/s/AKfycbyMvxpK2lX-Q7OjI4_qiCS6ljBplqlEl4HGcDmPgR13IwNjFLDyjK7izeXFEAynhfic/exec");
    return denied.evaluate().setTitle("Staff access required").addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  const template = HtmlService.createTemplateFromFile("Index");
  template.bootstrap = JSON.stringify({ email: access.email, name: access.name, role: access.role });
  return template.evaluate().setTitle("Scripps Sandbox staff desk").addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function setupStaffApp() {
  const actorEmail = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!actorEmail) throw new Error("Sign in before initializing the staff app.");
  const spreadsheet = staffSpreadsheet_();
  ["training", "notes", "fabmanLinks", "kioskLinks"].forEach(function (key) {
    const definition = STAFF_CONFIG_.sheets[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) sheet = spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) sheet.appendRow(definition.headers);
    staffAssertHeaders_(sheet, definition.headers, definition.allowAdditionalHeaders);
    sheet.setFrozenRows(1);
  });
  return { ok: true, actor: actorEmail };
}

function staffGroupOnboarding() {
  const access = staffRequireAccess_();
  if (!access.cardLinkingAllowed && access.role !== "administrator") throw new Error("Card Linking permission is required for group onboarding.");
  const db = staffDatabase_();
  const now = new Date();
  const registrationByPerson = {};
  staffRecords_(db.registrations).forEach(function (record) {
    const personId = String(record["Person ID"] || "").trim();
    if (!personId) return;
    const existing = registrationByPerson[personId];
    const candidateTime = new Date(record["Submitted At"] || 0).getTime() || 0;
    const existingTime = existing ? (new Date(existing["Submitted At"] || 0).getTime() || 0) : -1;
    if (!existing || candidateTime >= existingTime) registrationByPerson[personId] = record;
  });
  const activeCards = {};
  staffRecords_(db.cards).forEach(function (record) {
    if (String(record.Status || "").trim().toLowerCase() === "active") activeCards[String(record["Person ID"] || "").trim()] = true;
  });
  const identifierByPerson = {};
  const identifiersByPerson = {};
  staffRecords_(db.identifiers).forEach(function (record) {
    const personId = String(record["Person ID"] || "").trim();
    if (!staffTrue_(record.Active) || String(record.Type || "").toLowerCase() === "email") return;
    if (!identifierByPerson[personId]) identifierByPerson[personId] = record;
    if (!identifiersByPerson[personId]) identifiersByPerson[personId] = [];
    const normalized = staffClean_(record["Normalized Value"] || record.Value, 80);
    if (normalized && identifiersByPerson[personId].indexOf(normalized) === -1) identifiersByPerson[personId].push(normalized);
  });
  const people = staffRecords_(db.people);
  const waiverByPerson = staffWaiverMatches_(people.filter(function (person) {
    const personId = String(person["Person ID"] || "").trim();
    return String(person.Status || "").trim().toLowerCase() === "active" && !activeCards[personId];
  }).map(function (person) {
    const personId = String(person["Person ID"] || "").trim();
    return {
      requestId: personId,
      identifiers: identifiersByPerson[personId] || [],
      email: staffClean_(person["Primary Email"], 254).toLowerCase(),
      name: staffClean_(person["Display Name"], 160),
    };
  }));
  const candidates = [];
  const blocked = [];
  people.forEach(function (person) {
    const personId = String(person["Person ID"] || "").trim();
    if (String(person.Status || "").trim().toLowerCase() !== "active" || activeCards[personId]) return;
    const registration = registrationByPerson[personId];
    const identifier = identifierByPerson[personId] || {};
    const waiverStatusDisplay = registration ? staffClean_(registration["DocuSign Status"], 120) : "";
    const waiverStatus = waiverStatusDisplay.toLowerCase();
    const record = {
      personId: personId,
      name: staffPrivateName_(person["Display Name"]),
      role: staffClean_(person.Role, 80),
      affiliation: registration ? staffClean_(registration["Program / Department"], 120) : "",
      identifierHint: staffIdentifierHint_(identifier.Value),
      submittedAt: registration ? staffIsoDate_(registration["Submitted At"]) : "",
      accountCreatedAt: staffIsoDate_(person["Created At"]),
    };
    if (registration && (/(signed|complete|completed|matched|verified|approved)/.test(waiverStatus) || waiverByPerson[personId])) {
      candidates.push(record);
      return;
    }
    record.blockers = !registration
      ? ["Registration not found — ask them to complete the online registration."]
      : !waiverStatusDisplay
        ? ["Signed waiver not found — DocuSign can take up to 15 minutes to sync."]
        : ["Waiver is not verified yet (" + waiverStatusDisplay + ") — allow up to 15 minutes after signing."];
    blocked.push(record);
  });
  const onboardingTime_ = function (record) { return String(record.submittedAt || record.accountCreatedAt || ""); };
  candidates.sort(function (a, b) { return onboardingTime_(b).localeCompare(onboardingTime_(a)); });
  blocked.sort(function (a, b) { return onboardingTime_(b).localeCompare(onboardingTime_(a)); });
  const requests = staffRecords_(db.kioskLinks);
  let pending = null;
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index];
    if (String(request.Status || "").toLowerCase() !== "pending") continue;
    const expiresAt = new Date(request["Expires At"] || 0);
    if (!isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) continue;
    pending = {
      requestId: request["Request ID"], personId: request["Person ID"], name: staffPrivateName_(request["Display Name"]),
      requestedAt: staffIsoDate_(request["Requested At"]), expiresAt: staffIsoDate_(request["Expires At"]), status: "Pending",
    };
    break;
  }
  return { ok: true, actor: access, candidates: candidates, blocked: blocked, pending: pending, refreshedAt: now.toISOString() };
}

function staffStartCardConnection(personId) {
  const access = staffRequireAccess_();
  if (!access.cardLinkingAllowed && access.role !== "administrator") throw new Error("Card Linking permission is required for group onboarding.");
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, staffClean_(personId, 120));
  const hasActiveCard = staffRecords_(db.cards).some(function (record) {
    return record["Person ID"] === personId && String(record.Status || "").trim().toLowerCase() === "active";
  });
  if (hasActiveCard) throw new Error("This account already has an active card. Use the replacement-card workflow instead.");
  const registrations = staffRecords_(db.registrations).filter(function (record) { return record["Person ID"] === personId; });
  const registration = registrations.length ? registrations[registrations.length - 1] : null;
  const waiverStatus = registration ? staffClean_(registration["DocuSign Status"], 120).toLowerCase() : "";
  const identifiers = staffRecords_(db.identifiers).filter(function (record) {
    return record["Person ID"] === personId && staffTrue_(record.Active) && String(record.Type || "").toLowerCase() !== "email";
  }).map(function (record) { return staffClean_(record["Normalized Value"] || record.Value, 80); }).filter(Boolean);
  const waiverMatch = staffWaiverMatches_([{
    requestId: personId,
    identifiers: identifiers,
    email: staffClean_(person["Primary Email"], 254).toLowerCase(),
    name: staffClean_(person["Display Name"], 160),
  }])[personId];
  if (!registration || (!/(signed|complete|completed|matched|verified|approved)/.test(waiverStatus) && !waiverMatch)) throw new Error("This account is not ready: registration and a verified waiver are required.");
  staffCancelPendingKioskLinks_(db.kioskLinks, "Replaced by a newer staff request");
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + 45 * 1000);
  const requestId = staffId_("link");
  db.kioskLinks.appendRow([requestId, personId, staffSheetSafe_(person["Display Name"]), access.email, requestedAt, expiresAt, "Pending", "", "Waiting for member card"]);
  staffAfterWrite_(personId);
  return { ok: true, requestId: requestId, personId: personId, name: staffPrivateName_(person["Display Name"]), expiresAt: expiresAt.toISOString() };
}

function staffScrippsWaiverMatches_(queries) {
  if (!queries || !queries.length) return {};
  return staffScrippsWaiverMatchesFromRecords_(queries, staffRecords_(staffDatabase_().scrippsWaivers));
}

function staffLegacyWaiverMatches_(queries) {
  if (!queries || !queries.length) return {};
  return staffLegacyWaiverMatchesFromRecords_(queries, staffLegacyWaiverRecords_());
}

function staffWaiverMatches_(queries) {
  const matches = staffScrippsWaiverMatches_(queries);
  const legacyMatches = staffLegacyWaiverMatches_(queries);
  Object.keys(legacyMatches).forEach(function (requestId) { matches[requestId] = true; });
  return matches;
}

function staffCancelCardConnection(requestId) {
  staffRequireAccess_();
  const sheet = staffDatabase_().kioskLinks;
  const values = sheet.getDataRange().getDisplayValues();
  const idColumn = values[0].indexOf("Request ID");
  const statusColumn = values[0].indexOf("Status");
  const completedColumn = values[0].indexOf("Completed At");
  const messageColumn = values[0].indexOf("Message");
  const rowIndex = values.findIndex(function (row, index) { return index > 0 && row[idColumn] === requestId; });
  if (rowIndex < 1) throw new Error("That kiosk request could not be found.");
  const row = rowIndex + 1;
  sheet.getRange(row, statusColumn + 1).setValue("Cancelled");
  sheet.getRange(row, completedColumn + 1).setValue(new Date());
  sheet.getRange(row, messageColumn + 1).setValue("Cancelled by staff");
  staffAfterWrite_();
  return { ok: true };
}

function staffCancelPendingKioskLinks_(sheet, reason) {
  if (sheet.getLastRow() < 2) return;
  const values = sheet.getDataRange().getDisplayValues();
  const statusColumn = values[0].indexOf("Status");
  const completedColumn = values[0].indexOf("Completed At");
  const messageColumn = values[0].indexOf("Message");
  values.slice(1).forEach(function (row, index) {
    if (String(row[statusColumn] || "").toLowerCase() !== "pending") return;
    sheet.getRange(index + 2, statusColumn + 1).setValue("Cancelled");
    sheet.getRange(index + 2, completedColumn + 1).setValue(new Date());
    sheet.getRange(index + 2, messageColumn + 1).setValue(reason);
  });
}

function staffDashboard() {
  const started = Date.now();
  const access = staffRequireAccess_();
  const cached = staffCacheGetJson_("dashboard");
  if (cached) {
    cached.actor = access;
    cached.performance = { totalMs: Date.now() - started, cache: "hit" };
    return cached;
  }
  const db = staffDatabase_();
  const people = staffRecords_(db.people).filter(function (person) { return String(person.Status).toLowerCase() === "active"; });
  const establishedTraining = staffRecords_(db.certifications).filter(function (record) {
    return String(record.Status).toLowerCase() === "active";
  }).map(function (record) {
    return { "Person ID": record["Person ID"], Tool: staffToolLabel_(record["Tool Key"]), Status: "Approved" };
  });
  const presence = staffDerivePresence_(people, staffRecords_(db.visits), staffRecords_(db.training).concat(establishedTraining), Session.getScriptTimeZone());
  const registrationByPerson = {};
  staffRecords_(db.registrations).forEach(function (record) { registrationByPerson[record["Person ID"]] = record; });
  const identifierByPerson = {};
  staffRecords_(db.identifiers).forEach(function (record) {
    if (!identifierByPerson[record["Person ID"]] && staffTrue_(record.Active) && String(record.Type).toLowerCase() !== "email") identifierByPerson[record["Person ID"]] = record;
  });
  const toolsByPerson = {};
  establishedTraining.forEach(function (record) {
    if (!toolsByPerson[record["Person ID"]]) toolsByPerson[record["Person ID"]] = [];
    if (toolsByPerson[record["Person ID"]].indexOf(record.Tool) === -1) toolsByPerson[record["Person ID"]].push(record.Tool);
  });
  const linkedPeople = {};
  staffRecords_(db.fabmanLinks).forEach(function (record) {
    if (String(record.Status).toLowerCase() === "active") linkedPeople[record["Person ID"]] = Number(record["FabMan Member ID"]);
  });
  presence.present.forEach(function (person) {
    staffAttentionFlags_(registrationByPerson[person.personId]).forEach(function (flag) {
      if (person.flags.indexOf(flag) === -1) person.flags.push(flag);
    });
  });
  const notes = staffRecords_(db.notes).map(function (note) {
    return { id: note["Note ID"], note: note.Note, createdBy: note["Created By"], createdAt: new Date(note["Created At"]).toISOString(), status: note.Status || "Open" };
  }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  const peopleIndex = people.map(function (person) {
    const personId = person["Person ID"];
    const registration = registrationByPerson[personId] || null;
    const identifier = identifierByPerson[personId] || null;
    return {
      personId: personId,
      name: staffPrivateName_(person["Display Name"]),
      role: staffRoleLabel_(person.Role),
      profileRole: staffClean_(person.Role, 80),
      affiliation: registration ? staffClean_(registration["Program / Department"], 80) : "",
      anticipatedGraduation: registration ? staffClean_(registration["Anticipated Graduation"], 7) : "",
      identifierHint: identifier ? staffIdentifierHint_(identifier.Value) : "",
      attention: staffAttentionFlags_(registration),
      toolLabels: toolsByPerson[personId] || [],
      fabmanMemberId: linkedPeople[personId] || 0,
      searchText: [person["Display Name"], person.Role, registration && registration["Program / Department"]].join(" ").toLowerCase(),
    };
  });
  const result = { ok: true, actor: access, present: presence.present, left: presence.left, notes: notes, peopleIndex: peopleIndex, refreshedAt: new Date().toISOString() };
  staffCachePutJson_("dashboard", result, STAFF_CACHE_SECONDS_.dashboard);
  result.performance = { totalMs: Date.now() - started, cache: "miss" };
  return result;
}

function staffMarkLeft(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  db.visits.appendRow([staffId_("visit"), personId, new Date(), "Staff Checkout", access.email, "", "Marked left from staff app", "Staff app", ""]);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]) };
}

function staffReopen(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  db.visits.appendRow([staffId_("visit"), personId, new Date(), "Staff Reopen", access.email, "", "Reopened mistaken checkout", "Staff app", ""]);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]) };
}

function staffSearchPeople(query) {
  staffRequireAccess_();
  const cleaned = staffClean_(query, 80).toLowerCase();
  if (cleaned.length < 2) return [];
  const cacheKey = "search:" + Utilities.base64EncodeWebSafe(cleaned).slice(0, 80);
  const cached = staffCacheGetJson_(cacheKey);
  if (cached) return cached;
  const db = staffDatabase_();
  const registrationByPerson = {};
  staffRecords_(db.registrations).forEach(function (record) { registrationByPerson[record["Person ID"]] = record; });
  const identifiersByPerson = {};
  staffRecords_(db.identifiers).forEach(function (record) {
    if (!identifiersByPerson[record["Person ID"]] && staffTrue_(record.Active) && String(record.Type).toLowerCase() !== "email") identifiersByPerson[record["Person ID"]] = record;
  });
  const results = staffRecords_(db.people).filter(function (person) {
    const registration = registrationByPerson[person["Person ID"]] || {};
    const haystack = [person["Display Name"], person.Role, registration["Program / Department"]].join(" ").toLowerCase();
    return String(person.Status).toLowerCase() === "active" && haystack.indexOf(cleaned) !== -1;
  }).slice(0, 8).map(function (person) {
    const registration = registrationByPerson[person["Person ID"]] || {};
    const identifier = identifiersByPerson[person["Person ID"]] || {};
    return { personId: person["Person ID"], name: staffPrivateName_(person["Display Name"]), role: staffRoleLabel_(person.Role), affiliation: staffClean_(registration["Program / Department"], 80), identifierHint: staffIdentifierHint_(identifier.Value) };
  });
  staffCachePutJson_(cacheKey, results, STAFF_CACHE_SECONDS_.search);
  return results;
}

function staffManualCheckIn(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  db.visits.appendRow([staffId_("visit"), personId, new Date(), "User Checkin", access.email, "Manual check-in", "Created by staff", "Staff app", ""]);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]) };
}

function staffApproveLaser(personId) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  const existing = staffRecords_(db.certifications).some(function (row) {
    return row["Person ID"] === personId && String(row["Tool Key"]).toLowerCase() === "epilog_laser_cutter" && String(row.Status).toLowerCase() === "active";
  });
  if (!existing) db.certifications.appendRow([
    staffId_("cert"), personId, "epilog_laser_cutter", "Active", new Date(), "", "Staff app", "",
    staffSheetSafe_("Approved by " + access.email + ".")
  ]);
  const link = staffActiveFabmanLink_(db, personId);
  const sync = link ? fabmanEnsureLaserTraining_(link["FabMan Member ID"], new Date(), access.email) : { ok: false, label: "Member link required" };
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]), fabmanStatus: sync.label, fabmanSynced: sync.ok };
}

function staffPersonCard(personId) {
  const started = Date.now();
  const access = staffRequireAccess_();
  const cacheKey = "person:" + staffClean_(personId, 120);
  const cached = staffCacheGetJson_(cacheKey);
  if (cached) {
    cached.canApproveTraining = ["trainer", "administrator"].indexOf(access.role) !== -1;
    cached.performance = { totalMs: Date.now() - started, cache: "hit" };
    return cached;
  }
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  const registrations = staffRecords_(db.registrations).filter(function (row) { return row["Person ID"] === personId; });
  const registration = registrations.length ? registrations[registrations.length - 1] : null;
  const identifier = staffRecords_(db.identifiers).find(function (row) {
    return row["Person ID"] === personId && staffTrue_(row.Active) && String(row.Type).toLowerCase() !== "email";
  });
  const tools = {};
  staffRecords_(db.certifications).forEach(function (row) {
    if (row["Person ID"] !== personId || String(row.Status).toLowerCase() !== "active") return;
    const key = staffClean_(row["Tool Key"], 80).toLowerCase();
    tools[key] = {
      key: key,
      label: staffToolLabel_(key),
      status: "Training recorded",
      approvedAt: staffIsoDate_(row["Granted At"]),
      source: staffClean_(row["Source System"], 80) || "Sandbox database",
      fabmanStatus: "Not connected",
    };
  });
  staffRecords_(db.training).forEach(function (row) {
    if (row["Person ID"] !== personId || String(row.Status).toLowerCase() !== "approved") return;
    const key = String(row.Tool).toLowerCase() === "laser cutter" ? "epilog_laser_cutter" : staffClean_(row.Tool, 80).toLowerCase().replace(/\s+/g, "_");
    if (tools[key]) return;
    tools[key] = {
      key: key,
      label: staffToolLabel_(key),
      status: "Training recorded",
      approvedAt: staffIsoDate_(row["Approved At"]),
      source: "Legacy staff approval",
      fabmanStatus: staffClean_(row["FabMan Status"], 80) || "Not connected",
    };
  });
  const fabmanLink = staffActiveFabmanLink_(db, personId);
  const fabman = fabmanLink ? { connected: true, checking: true, memberId: Number(fabmanLink["FabMan Member ID"]), label: "Checking live status…", trainingActive: false, packageActive: false, keyConnected: false } : { connected: false, checking: false, label: "No verified member link", trainingActive: false, packageActive: false, keyConnected: false };
  Object.keys(tools).forEach(function (key) {
    tools[key].fabmanStatus = key === "epilog_laser_cutter" ? fabman.label : "Connected; tool mapping pending";
  });
  const result = {
    ok: true,
    personId: personId,
    name: staffPrivateName_(person["Display Name"]),
    role: staffRoleLabel_(person.Role),
    profileRole: staffClean_(person.Role, 80),
    affiliation: registration ? staffClean_(registration["Program / Department"], 80) : "",
    anticipatedGraduation: registration ? staffClean_(registration["Anticipated Graduation"], 7) : "",
    identifierHint: identifier ? staffIdentifierHint_(identifier.Value) : "",
    attention: staffAttentionFlags_(registration),
    tools: Object.keys(tools).map(function (key) { return tools[key]; }),
    canApproveTraining: ["trainer", "administrator"].indexOf(access.role) !== -1,
    fabmanConnected: fabman.connected,
    fabman: fabman,
  };
  staffCachePutJson_(cacheKey, result, STAFF_CACHE_SECONDS_.person);
  result.performance = { totalMs: Date.now() - started, cache: "miss" };
  return result;
}

function staffUpdateProfile(personId, payload) {
  const access = staffRequireAccess_();
  const validated = staffValidateProfile_(payload);
  if (!validated.ok) throw new Error(validated.message);
  const profile = validated.value;
  const cleanPersonId = staffClean_(personId, 120);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const db = staffDatabase_();
    staffFindPerson_(db.people, cleanPersonId);
    const personRow = staffLastPersonRow_(db.people, cleanPersonId);
    staffSetNamedCell_(db.people, personRow, "Role", profile.role);
    staffSetNamedCell_(db.people, personRow, "Updated At", new Date());

    let registrationRow = staffLastPersonRow_(db.registrations, cleanPersonId);
    if (!registrationRow) {
      registrationRow = staffAppendNamedRow_(db.registrations, {
        "Registration ID": staffId_("registration"),
        "Person ID": cleanPersonId,
        "Status": "Profile updated",
        "Submitted At": new Date(),
        "Reviewed By": access.email,
        "Reviewed At": new Date(),
        "Program / Department": profile.affiliation,
        "Anticipated Graduation": profile.anticipatedGraduation,
        "Source": "Staff profile update",
      });
    } else {
      staffSetNamedCell_(db.registrations, registrationRow, "Program / Department", profile.affiliation);
      staffSetNamedCell_(db.registrations, registrationRow, "Anticipated Graduation", profile.anticipatedGraduation);
      staffSetNamedCell_(db.registrations, registrationRow, "Reviewed By", access.email);
      staffSetNamedCell_(db.registrations, registrationRow, "Reviewed At", new Date());
    }
    SpreadsheetApp.flush();
    staffAfterWrite_(cleanPersonId);
  } finally {
    lock.releaseLock();
  }
  return staffPersonCard(cleanPersonId);
}

function staffFabmanStatus(personId) {
  const started = Date.now();
  staffRequireAccess_();
  const db = staffDatabase_();
  staffFindPerson_(db.people, personId);
  const link = staffActiveFabmanLink_(db, personId);
  const status = link ? fabmanMemberStatus_(link["FabMan Member ID"]) : { connected: false, checking: false, label: "No verified member link", trainingActive: false, packageActive: false, keyConnected: false };
  status.performance = { totalMs: Date.now() - started };
  return status;
}

function staffFabmanCandidates(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  const existing = staffActiveFabmanLink_(db, personId);
  if (existing) return { ok: true, linked: true, candidates: [] };
  const email = staffClean_(person["Primary Email"], 180).toLowerCase();
  const fullName = staffClean_(person["Display Name"], 160);
  const queries = [];
  if (email) queries.push({ value: email, method: "Exact email", strong: true });
  if (fullName && fullName.toLowerCase() !== email) queries.push({ value: fullName, method: "Name", strong: false });
  const seen = {};
  const candidates = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const response = fabmanFetch_("members?account=1046&q=" + encodeURIComponent(query.value) + "&limit=20&embed=trainings&embed=activePackages&embed=key");
    if (!response.ok) throw new Error(response.error);
    const records = Array.isArray(response.data) ? response.data : [];
    records.forEach(function (member) {
      const memberEmail = staffClean_(member.emailAddress || member.email, 180).toLowerCase();
      const memberName = staffClean_([member.firstName, member.lastName].filter(Boolean).join(" "), 160);
      const exactEmail = Boolean(email && memberEmail === email);
      const exactName = Boolean(fullName && memberName.toLowerCase() === fullName.toLowerCase());
      if (!exactEmail && !exactName) return;
      const id = Number(member.id);
      if (!id || seen[id]) return;
      seen[id] = true;
      const status = fabmanMemberStatus_(id);
      candidates.push({
        memberId: id,
        name: staffPrivateName_(memberName),
        emailHint: staffMaskedEmail_(memberEmail),
        memberNumberHint: staffIdentifierHint_(member.memberNumber),
        state: staffClean_(member.state || member.status, 50),
        match: exactEmail ? "Exact UCSD email" : "Exact name — review carefully",
        strongMatch: exactEmail,
        trainingActive: status.trainingActive,
        packageActive: status.packageActive,
        keyConnected: status.keyConnected,
        canAddSandboxPackage: !status.packageActive && staffCanManageFabman_(access),
      });
    });
    if (query.strong && candidates.some(function (candidate) { return candidate.strongMatch; })) break;
  }
  candidates.sort(function (a, b) { return Number(b.strongMatch) - Number(a.strongMatch); });
  return { ok: true, linked: false, candidates: candidates.slice(0, 8) };
}

function staffConfirmFabmanLink(personId, fabmanMemberId) {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  if (staffActiveFabmanLink_(db, personId)) throw new Error("This person already has a verified FabMan link.");
  const memberId = Number(fabmanMemberId);
  if (!memberId) throw new Error("Choose a FabMan member first.");
  const duplicate = staffRecords_(db.fabmanLinks).some(function (row) {
    return Number(row["FabMan Member ID"]) === memberId && String(row.Status).toLowerCase() === "active";
  });
  if (duplicate) throw new Error("That FabMan member is already linked to another Sandbox account.");
  const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "?embed=trainings&embed=memberPackages&embed=key");
  if (!response.ok) throw new Error(response.error);
  const member = response.data || {};
  if (Number(member.account && member.account.id ? member.account.id : member.account) !== 1046) throw new Error("That member is outside the UCSD FabMan account.");
  const personEmail = staffClean_(person["Primary Email"], 180).toLowerCase();
  const memberEmail = staffClean_(member.emailAddress || member.email, 180).toLowerCase();
  const personName = staffClean_(person["Display Name"], 160).toLowerCase();
  const memberName = staffClean_([member.firstName, member.lastName].filter(Boolean).join(" "), 160).toLowerCase();
  const exactEmail = Boolean(personEmail && memberEmail === personEmail);
  const exactName = Boolean(personName && memberName === personName);
  if (!exactEmail && !exactName) throw new Error("The selected FabMan member no longer matches this person.");
  const status = fabmanMemberStatus_(memberId);
  if (!status.packageActive) throw new Error("Add this member to Scripps Sandbox before linking.");
  const method = exactEmail ? "Exact email; staff confirmed" : "Exact name; staff reviewed and confirmed";
  db.fabmanLinks.appendRow([staffId_("fmlink"), personId, memberId, "Active", method, access.email, new Date(), "Verified in the staff app."]);
  staffAfterWrite_(personId);
  const certification = staffRecords_(db.certifications).find(function (row) {
    return row["Person ID"] === personId && String(row["Tool Key"]).toLowerCase() === "epilog_laser_cutter" && String(row.Status).toLowerCase() === "active";
  });
  const sync = certification ? fabmanEnsureLaserTraining_(memberId, certification["Granted At"], access.email) : { ok: true, label: "Linked; no Sandbox laser approval to sync" };
  return { ok: true, name: staffPreferredName_(person["Display Name"]), sync: sync, status: fabmanMemberStatus_(memberId) };
}

function staffAddSandboxPackageAndLink(personId, fabmanMemberId) {
  const access = staffRequireFabmanManager_();
  const db = staffDatabase_();
  const person = staffFindPerson_(db.people, personId);
  const memberId = Number(fabmanMemberId);
  if (!memberId) throw new Error("Choose a FabMan member first.");
  if (staffActiveFabmanLink_(db, personId)) throw new Error("This person already has a verified FabMan link.");
  const member = fabmanVerifiedCandidate_(person, memberId);
  const before = fabmanMemberStatus_(memberId);
  if (!before.connected) throw new Error("FabMan could not verify this member.");
  if (!before.packageActive) {
    const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "/packages", "post", [{
      package: 9464,
      fromDate: Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd"),
    }]);
    if (!response.ok) throw new Error("The Scripps Sandbox package was not added: " + response.error);
    staffClearFabmanCache_(memberId);
  }
  const after = fabmanMemberStatus_(memberId);
  if (!after.packageActive) throw new Error("FabMan did not confirm the Scripps Sandbox package. No link was stored.");
  const duplicate = staffRecords_(db.fabmanLinks).some(function (row) {
    return Number(row["FabMan Member ID"]) === memberId && String(row.Status).toLowerCase() === "active";
  });
  if (duplicate) throw new Error("That FabMan member is already linked to another Sandbox account.");
  const method = member.exactEmail ? "Exact email; Sandbox package added and staff confirmed" : "Exact name; Sandbox package added after staff review";
  db.fabmanLinks.appendRow([staffId_("fmlink"), personId, memberId, "Active", method, access.email, new Date(), "Added package 9464 only; no other FabMan record fields or packages changed."]);
  staffAfterWrite_(personId);
  const certification = staffRecords_(db.certifications).find(function (row) {
    return row["Person ID"] === personId && String(row["Tool Key"]).toLowerCase() === "epilog_laser_cutter" && String(row.Status).toLowerCase() === "active";
  });
  const sync = certification ? fabmanEnsureLaserTraining_(memberId, certification["Granted At"], access.email) : { ok: true, label: "Added to Scripps Sandbox and linked" };
  return { ok: true, name: staffPreferredName_(person["Display Name"]), packageAdded: !before.packageActive, sync: sync, status: fabmanMemberStatus_(memberId) };
}

function fabmanVerifiedCandidate_(person, memberId) {
  const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "?embed=trainings&embed=memberPackages&embed=key");
  if (!response.ok) throw new Error(response.error);
  const member = response.data || {};
  if (Number(member.account && member.account.id ? member.account.id : member.account) !== 1046) throw new Error("That member is outside the UCSD FabMan account.");
  const personEmail = staffClean_(person["Primary Email"], 180).toLowerCase();
  const memberEmail = staffClean_(member.emailAddress || member.email, 180).toLowerCase();
  const personName = staffClean_(person["Display Name"], 160).toLowerCase();
  const memberName = staffClean_([member.firstName, member.lastName].filter(Boolean).join(" "), 160).toLowerCase();
  const exactEmail = Boolean(personEmail && memberEmail === personEmail);
  const exactName = Boolean(personName && memberName === personName);
  if (!exactEmail && !exactName) throw new Error("The selected FabMan member no longer matches this person.");
  return { member: member, exactEmail: exactEmail, exactName: exactName };
}

function staffActiveFabmanLink_(db, personId) {
  return staffRecords_(db.fabmanLinks).find(function (row) {
    return row["Person ID"] === personId && String(row.Status).toLowerCase() === "active";
  });
}

function fabmanEnsureLaserTraining_(memberId, approvedAt, approvedBy) {
  const before = fabmanMemberStatus_(memberId);
  if (!before.connected) return { ok: false, label: before.label };
  if (before.trainingActive) return { ok: true, label: "Training already active" };
  const date = new Date(approvedAt);
  const trainingDate = Utilities.formatDate(isNaN(date.getTime()) ? new Date() : date, "UTC", "yyyy-MM-dd");
  const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "/trainings", "post", {
    date: trainingDate,
    trainingCourse: 2255,
    notes: "Approved in the Scripps Sandbox staff app by " + approvedBy + ".",
  });
  if (!response.ok) return { ok: false, label: "FabMan sync failed: " + response.error };
  staffClearFabmanCache_(memberId);
  return { ok: true, label: "Training added to FabMan" };
}

function staffLinkRileyFabmanTest() {
  const access = staffRequireAccess_();
  const db = staffDatabase_();
  const identifier = staffRecords_(db.identifiers).find(function (row) {
    return staffTrue_(row.Active) && staffIdentifierHint_(row.Value) === "ID ending 9006";
  });
  if (!identifier) throw new Error("Test person not found.");
  const status = fabmanMemberStatus_(297817);
  if (!status.connected || !status.trainingActive || !status.packageActive || !status.keyConnected) throw new Error("FabMan test member is not fully ready; no link was stored.");
  const existing = staffRecords_(db.fabmanLinks).some(function (row) {
    return row["Person ID"] === identifier["Person ID"] && String(row.Status).toLowerCase() === "active";
  });
  if (!existing) db.fabmanLinks.appendRow([staffId_("fmlink"), identifier["Person ID"], 297817, "Active", "Unique name + UCSD domain; manually reviewed", access.email, new Date(), "Pilot link verified against active package, Epilog training, and connected key."]);
  return { ok: true, status: status };
}

function fabmanMemberStatus_(memberId) {
  const cacheKey = "fabman:" + Number(memberId);
  const cached = staffCacheGetJson_(cacheKey);
  if (cached) return cached;
  const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "?embed=trainings&embed=memberPackages&embed=privileges&embed=key");
  if (!response.ok) return { connected: false, label: "Connection check failed", trainingActive: false, packageActive: false, keyConnected: false };
  const member = response.data || {};
  const embedded = member._embedded || {};
  const trainingIds = (embedded.trainings || []).map(function (item) { return item.trainingCourse && item.trainingCourse.id ? Number(item.trainingCourse.id) : Number(item.trainingCourse || item.course || item.id); });
  let packageIds = fabmanPackageIds_(embedded.memberPackages || member.memberPackages || []);
  if (!packageIds.length) {
    const packagesResponse = fabmanFetch_("members/" + encodeURIComponent(memberId) + "/packages");
    if (packagesResponse.ok) packageIds = fabmanPackageIds_(packagesResponse.data);
  }
  const trainingActive = trainingIds.indexOf(2255) !== -1;
  const packageActive = packageIds.indexOf(9464) !== -1;
  const keyConnected = Boolean(member.key || embedded.key);
  const parts = [trainingActive ? "Training active" : "Training missing", packageActive ? "Package active" : "Package missing", keyConnected ? "Key connected" : "Key missing"];
  const result = { connected: true, checking: false, memberId: Number(member.id), label: parts.join(" · "), trainingActive: trainingActive, packageActive: packageActive, keyConnected: keyConnected };
  staffCachePutJson_(cacheKey, result, STAFF_CACHE_SECONDS_.fabman);
  return result;
}

function fabmanReadOnlyDiscovery() {
  const requests = [
    { key: "accounts", path: "accounts?limit=50" },
    { key: "spaces", path: "spaces?limit=100" },
    { key: "equipment", path: "resources?limit=200" },
    { key: "packages", path: "packages?limit=200" },
    { key: "trainingCourses", path: "training-courses?limit=200" },
  ];
  const output = { ok: true, checkedAt: new Date().toISOString(), resources: {} };
  requests.forEach(function (request) {
    const response = fabmanFetch_(request.path);
    output.resources[request.key] = {
      status: response.status,
      records: response.ok ? fabmanSummaries_(request.key, response.data) : [],
      error: response.ok ? "" : response.error,
    };
  });
  console.log(JSON.stringify(output));
  return output;
}

function fabmanSandboxLaserDetails() {
  const response = fabmanFetch_("resources/5196?embed=trainingCourses");
  const data = response.data || {};
  const safe = {
    ok: response.ok,
    status: response.status,
    resource: response.ok ? {
      id: data.id,
      name: staffClean_(data.name || data.title, 120),
      space: data.space,
      requiresTraining: Boolean(data.requiresTraining),
      trainingCourses: data.trainingCourses || (data._embedded && data._embedded.trainingCourses) || [],
    } : null,
    error: response.error,
  };
  console.log(JSON.stringify(safe));
  return safe;
}

function fabmanRileyReadOnlyMatch() {
  const db = staffDatabase_();
  const identifiers = staffRecords_(db.identifiers);
  const targetIdentifier = identifiers.find(function (row) {
    return staffTrue_(row.Active) && staffIdentifierHint_(row.Value) === "ID ending 9006";
  });
  if (!targetIdentifier) throw new Error("The test person could not be identified safely.");
  const person = staffFindPerson_(db.people, targetIdentifier["Person ID"]);
  const response = fabmanFetch_("members?account=1046&limit=500&embed=trainings&embed=activePackages&embed=key");
  if (!response.ok) throw new Error(response.error);
  const email = staffClean_(person["Primary Email"], 180).toLowerCase();
  const identifier = staffClean_(targetIdentifier.Value, 120).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const records = Array.isArray(response.data) ? response.data : [];
  const matches = records.filter(function (member) {
    const memberEmail = staffClean_(member.emailAddress || member.email, 180).toLowerCase();
    const memberNumber = staffClean_(member.memberNumber, 120).replace(/[^a-z0-9]/gi, "").toLowerCase();
    return (email && memberEmail === email) || (identifier && memberNumber === identifier);
  });
  const safe = {
    ok: true,
    candidateCount: matches.length,
    candidates: matches.map(function (member) {
      const embedded = member._embedded || {};
      return {
        id: member.id,
        name: staffPrivateName_([member.firstName, member.lastName].filter(Boolean).join(" ")),
        memberNumberHint: staffIdentifierHint_(member.memberNumber),
        state: staffClean_(member.state || member.status, 50),
        packageIds: (embedded.activePackages || member.activePackages || []).map(function (item) { return item.package && item.package.id ? item.package.id : (item.package || item.id); }),
        trainingCourseIds: (embedded.trainings || member.trainings || []).map(function (item) { return item.trainingCourse && item.trainingCourse.id ? item.trainingCourse.id : (item.trainingCourse || item.course || item.id); }),
        keyCount: member.key || embedded.key ? 1 : 0,
      };
    }),
  };
  console.log(JSON.stringify(safe));
  return safe;
}

function fabmanRileyNameCandidates() {
  const response = fabmanFetch_("members?account=1046&q=Riley%20Meehan&limit=20&embed=trainings&embed=activePackages&embed=key");
  if (!response.ok) throw new Error(response.error);
  const records = Array.isArray(response.data) ? response.data : [];
  const safe = records.map(function (member) {
    const embedded = member._embedded || {};
    return {
      id: member.id,
      name: staffPrivateName_([member.firstName, member.lastName].filter(Boolean).join(" ")),
      memberNumberHint: staffIdentifierHint_(member.memberNumber),
      emailDomain: staffEmailDomain_(member.emailAddress || member.email),
      state: staffClean_(member.state || member.status, 50),
      packageIds: (embedded.activePackages || []).map(function (item) { return item.package && item.package.id ? item.package.id : (item.package || item.id); }),
      trainingCourseIds: (embedded.trainings || []).map(function (item) { return item.trainingCourse && item.trainingCourse.id ? item.trainingCourse.id : (item.trainingCourse || item.course || item.id); }),
      hasKey: Boolean(member.key || embedded.key),
    };
  });
  console.log(JSON.stringify(safe));
  return safe;
}

function fabmanRileyAccessDetails() {
  const response = fabmanFetch_("members/297817?embed=trainings&embed=memberPackages&embed=privileges&embed=key");
  if (!response.ok) throw new Error(response.error);
  const member = response.data || {};
  const embedded = member._embedded || {};
  const safe = {
    id: member.id,
    state: staffClean_(member.state || member.status, 50),
    privileges: embedded.privileges || member.privileges || [],
    packageIds: (embedded.memberPackages || []).filter(function (item) { return String(item.state || item.status || "active").toLowerCase() !== "expired"; }).map(function (item) { return item.package && item.package.id ? item.package.id : (item.package || item.id); }),
    trainingCourseIds: (embedded.trainings || []).map(function (item) { return item.trainingCourse && item.trainingCourse.id ? item.trainingCourse.id : (item.trainingCourse || item.course || item.id); }),
    hasKey: Boolean(member.key || embedded.key),
  };
  console.log(JSON.stringify(safe));
  return safe;
}

function staffEmailDomain_(value) {
  const email = staffClean_(value, 180).toLowerCase();
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1);
}

function staffMaskedEmail_(value) {
  const email = staffClean_(value, 180).toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  const local = email.slice(0, at);
  return local.charAt(0) + "•••@" + email.slice(at + 1);
}

function fabmanFetch_(path, method, payload) {
  const token = PropertiesService.getScriptProperties().getProperty("FABMAN_API_KEY");
  if (!token) throw new Error("FabMan API key is not configured.");
  const options = {
    method: method || "get",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    muteHttpExceptions: true,
  };
  if (payload !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch("https://fabman.io/api/v1/" + path, options);
  const status = response.getResponseCode();
  const body = response.getContentText();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch (error) {}
  return {
    ok: status >= 200 && status < 300,
    status: status,
    data: data,
    error: status >= 200 && status < 300 ? "" : fabmanSafeError_(data, status),
  };
}

function fabmanSafeError_(data, status) {
  const message = data && (data.message || data.error || data.title);
  return staffClean_(message || ("FabMan returned HTTP " + status), 180);
}

function fabmanSummaries_(key, data) {
  const records = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
  return records.map(function (record) {
    if (key === "accounts") return { id: record.id, name: staffClean_(record.name || record.title, 120) };
    if (key === "spaces") return { id: record.id, name: staffClean_(record.name || record.title, 120), account: record.account };
    if (key === "equipment") return { id: record.id, name: staffClean_(record.name || record.title, 120), space: record.space, requiresTraining: Boolean(record.requiresTraining), trainingCourses: record.trainingCourses || [] };
    if (key === "packages") return { id: record.id, name: staffClean_(record.name || record.title, 120), account: record.account, archived: Boolean(record.archived) };
    if (key === "trainingCourses") return { id: record.id, name: staffClean_(record.name || record.title, 120), account: record.account, archived: Boolean(record.archived) };
    return { id: record.id };
  });
}

function staffAddNote(note) {
  const access = staffRequireAccess_();
  const cleaned = staffClean_(note, 500);
  if (!cleaned) throw new Error("Enter a note first.");
  staffDatabase_().notes.appendRow([staffId_("note"), staffSheetSafe_(cleaned), access.email, new Date(), "Open", "", ""]);
  staffAfterWrite_();
  return { ok: true };
}

function staffResolveNote(noteId, reopen) {
  const access = staffRequireAccess_();
  const sheet = staffDatabase_().notes;
  const values = sheet.getDataRange().getDisplayValues();
  const idColumn = values[0].indexOf("Note ID");
  const statusColumn = values[0].indexOf("Status");
  const resolvedByColumn = values[0].indexOf("Resolved By");
  const resolvedAtColumn = values[0].indexOf("Resolved At");
  const index = values.findIndex(function (row, rowIndex) { return rowIndex > 0 && row[idColumn] === noteId; });
  if (index < 1) throw new Error("Note not found.");
  const row = index + 1;
  sheet.getRange(row, statusColumn + 1).setValue(reopen ? "Open" : "Resolved");
  sheet.getRange(row, resolvedByColumn + 1).setValue(reopen ? "" : access.email);
  sheet.getRange(row, resolvedAtColumn + 1).setValue(reopen ? "" : new Date());
  staffAfterWrite_();
  return { ok: true };
}

function staffRequireAccess_(roles) {
  const email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!email) throw new Error("Sign in with your UC San Diego Google account.");
  const records = staffRecords_(staffDatabase_(true).staffAccess);
  const record = records.find(function (row) { return String(row.Email).trim().toLowerCase() === email && staffTrue_(row.Active); });
  if (!record) throw new Error("This account is not approved for the Sandbox staff app.");
  const role = String(record.Role || "staff").trim().toLowerCase();
  if (roles && roles.indexOf(role) === -1) throw new Error("Your staff role cannot perform this action.");
  return { email: email, name: staffPreferredName_(record.Name || email), role: role, cardLinkingAllowed: staffTrue_(record["Card Linking Allowed"]) };
}

function staffCanManageFabman_(access) {
  return access.role === "administrator" || Boolean(access.cardLinkingAllowed) || access.email === "scripps-sandbox@ucsd.edu";
}

function fabmanPackageIds_(data) {
  const records = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
  return records.filter(function (item) {
    return ["expired", "cancelled", "canceled", "ended"].indexOf(String(item.state || item.status || "active").toLowerCase()) === -1;
  }).map(function (item) {
    const value = item.package && item.package.id ? item.package.id : (item.package || (item.memberPackage && item.memberPackage.package) || item.packageId);
    return Number(value && value.id ? value.id : value);
  }).filter(function (value) { return Boolean(value); });
}

function staffRequireFabmanManager_() {
  const access = staffRequireAccess_();
  if (!staffCanManageFabman_(access)) throw new Error("Administrator or Card Linking permission is required to add a FabMan package.");
  return access;
}

function staffSpreadsheet_() {
  if (STAFF_SPREADSHEET_MEMO_) return STAFF_SPREADSHEET_MEMO_;
  const id = PropertiesService.getScriptProperties().getProperty(STAFF_CONFIG_.spreadsheetProperty);
  if (!id) throw new Error("Staff app database is not configured.");
  STAFF_SPREADSHEET_MEMO_ = SpreadsheetApp.openById(id);
  return STAFF_SPREADSHEET_MEMO_;
}

function staffLegacyWaiverSheet_() {
  if (STAFF_LEGACY_WAIVER_SHEET_MEMO_) return STAFF_LEGACY_WAIVER_SHEET_MEMO_;
  STAFF_LEGACY_WAIVER_SHEET_MEMO_ = SpreadsheetApp.openById(STAFF_CONFIG_.legacyWaiverSpreadsheetId).getSheets()[0];
  return STAFF_LEGACY_WAIVER_SHEET_MEMO_;
}

function staffLegacyWaiverRecords_() {
  const cached = staffCacheGetJson_("legacy-waivers");
  if (cached) return cached;
  const records = staffRecords_(staffLegacyWaiverSheet_());
  staffCachePutJson_("legacy-waivers", records, 60);
  return records;
}

function staffDatabase_(accessOnly) {
  const spreadsheet = staffSpreadsheet_();
  const keys = accessOnly ? ["staffAccess"] : Object.keys(STAFF_CONFIG_.sheets);
  const db = { spreadsheet: spreadsheet };
  keys.forEach(function (key) {
    const definition = STAFF_CONFIG_.sheets[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet && definition.createIfMissing) {
      sheet = spreadsheet.insertSheet(definition.name);
      sheet.appendRow(definition.headers);
      sheet.setFrozenRows(1);
    }
    if (!sheet) throw new Error("Run setupStaffApp to finish the staff app database.");
    staffAssertHeaders_(sheet, definition.headers, definition.allowAdditionalHeaders);
    db[key] = sheet;
  });
  return db;
}

function staffAssertHeaders_(sheet, headers, allowAdditionalHeaders) {
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  if (allowAdditionalHeaders) {
    const missing = staffMissingHeaders_(actual, headers);
    if (missing.length) throw new Error(sheet.getName() + " is missing required columns: " + missing.join(", ") + ".");
    return;
  }
  headers.forEach(function (header, index) { if (actual[index] !== header) throw new Error(sheet.getName() + " does not match the expected layout."); });
}

function staffRecords_(sheet) {
  const memoKey = String(sheet.getSheetId());
  if (STAFF_RECORDS_MEMO_[memoKey]) return STAFF_RECORDS_MEMO_[memoKey];
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return STAFF_RECORDS_MEMO_[memoKey] = [];
  const records = values.slice(1).filter(function (row) { return row.some(function (value) { return String(value).trim(); }); }).map(function (row) {
    const record = {};
    values[0].forEach(function (header, index) { record[header] = row[index]; });
    return record;
  });
  STAFF_RECORDS_MEMO_[memoKey] = records;
  return records;
}

function staffColumn_(sheet, header) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(sheet.getName() + " is missing the " + header + " column.");
  return index + 1;
}

function staffLastPersonRow_(sheet, personId) {
  if (sheet.getLastRow() < 2) return 0;
  const column = staffColumn_(sheet, "Person ID");
  const values = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index][0]) === personId) return index + 2;
  }
  return 0;
}

function staffSetNamedCell_(sheet, row, header, value) {
  sheet.getRange(row, staffColumn_(sheet, header)).setValue(typeof value === "string" ? staffSheetSafe_(value) : value);
}

function staffAppendNamedRow_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sheet.appendRow(headers.map(function (header) {
    const value = Object.prototype.hasOwnProperty.call(record, header) ? record[header] : "";
    return typeof value === "string" ? staffSheetSafe_(value) : value;
  }));
  return sheet.getLastRow();
}

function staffCacheGetJson_(key) {
  try {
    const value = CacheService.getScriptCache().get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) { return null; }
}

function staffCachePutJson_(key, value, seconds) {
  try { CacheService.getScriptCache().put(key, JSON.stringify(value), seconds); } catch (error) {}
}

function staffAfterWrite_(personId) {
  STAFF_RECORDS_MEMO_ = {};
  const cache = CacheService.getScriptCache();
  cache.remove("dashboard");
  if (personId) cache.remove("person:" + staffClean_(personId, 120));
}

function staffClearFabmanCache_(memberId) {
  CacheService.getScriptCache().remove("fabman:" + Number(memberId));
}

function staffFindPerson_(sheet, personId) {
  const person = staffRecords_(sheet).find(function (row) { return row["Person ID"] === personId && String(row.Status).toLowerCase() === "active"; });
  if (!person) throw new Error("Person not found.");
  return person;
}

function staffId_(prefix) { return prefix + "_" + Utilities.getUuid().replace(/-/g, ""); }
function staffIsoDate_(value) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? "" : date.toISOString();
}
function staffSheetSafe_(value) { return /^[=+\-@]/.test(value) ? "'" + value : value; }
