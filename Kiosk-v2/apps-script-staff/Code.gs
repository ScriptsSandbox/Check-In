const STAFF_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  sheets: {
    people: { name: "People", headers: ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"] },
    identifiers: { name: "Identifiers", headers: ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"] },
    certifications: { name: "Tool Certifications", headers: ["Certification ID", "Person ID", "Tool Key", "Status", "Granted At", "Removed At", "Source System", "Source Rows", "Notes"] },
    registrations: { name: "Registrations", headers: ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Source"], allowAdditionalHeaders: true },
    visits: { name: "Visits", headers: ["Visit ID", "Person ID", "Check In At", "Event Type", "Authorizing Entity", "Flags", "Notes", "Source System", "Source Row"] },
    staffAccess: { name: "Staff Access", headers: ["Staff ID", "Name", "Email", "Role", "Active", "Card Linking Allowed", "Notes"] },
    training: { name: "Tool Training", headers: ["Training ID", "Person ID", "Tool", "Status", "Approved By", "Approved At", "FabMan Status", "Notes"] },
    fabmanLinks: { name: "FabMan Links", headers: ["Link ID", "Person ID", "FabMan Member ID", "Status", "Match Method", "Confirmed By", "Confirmed At", "Notes"] },
    notes: { name: "Staff Notes", headers: ["Note ID", "Note", "Created By", "Created At", "Status", "Resolved By", "Resolved At"] },
    tools: { name: "Tools", headers: ["Tool Key", "Display Name", "Active", "Staff Can Approve", "Sort Order", "Category", "Legacy Header"], allowAdditionalHeaders: true },
    cards: { name: "Cards", headers: ["Card ID", "Person ID", "Card Digest", "Last Four", "Status", "Linked At", "Retired At", "Source System", "Source Row"] },
    cardUpdates: { name: "Card Update Sessions", headers: ["Session ID", "Code Digest", "Person ID", "Status", "New Identifier Type", "New Identifier Value", "New Identifier Normalized", "Disable Old Card", "Old Card Disabled At", "Requested By", "Requested At", "Expires At", "Completed At", "FabMan Status", "Notes", "FabMan Key Type"], createIfMissing: true, allowAdditionalHeaders: true },
  },
};

var STAFF_SPREADSHEET_MEMO_ = null;
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
  ["training", "notes", "fabmanLinks", "cardUpdates"].forEach(function (key) {
    const definition = STAFF_CONFIG_.sheets[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) sheet = spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) sheet.appendRow(definition.headers);
    staffAssertHeaders_(sheet, definition.headers, definition.allowAdditionalHeaders);
    sheet.setFrozenRows(1);
  });
  staffEnsureToolColumns_(spreadsheet.getSheetByName("Tools"));
  return { ok: true, actor: actorEmail };
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
  const toolCatalog = staffToolCatalog_(db.tools);
  const toolByKey = {}; toolCatalog.forEach(function (tool) { toolByKey[tool.key] = tool; });
  const people = staffRecords_(db.people).filter(function (person) { return String(person.Status).toLowerCase() === "active"; });
  const establishedTraining = staffRecords_(db.certifications).filter(function (record) {
    return String(record.Status).toLowerCase() === "active";
  }).map(function (record) {
    const key = staffClean_(record["Tool Key"], 80).toLowerCase();
    return { "Person ID": record["Person ID"], ToolKey: key, Tool: toolByKey[key] ? toolByKey[key].name : staffToolLabel_(key), Status: "Approved" };
  });
  const presence = staffDerivePresence_(people, staffRecords_(db.visits), staffRecords_(db.training).concat(establishedTraining), Session.getScriptTimeZone());
  const registrationByPerson = {};
  staffRecords_(db.registrations).forEach(function (record) { registrationByPerson[record["Person ID"]] = record; });
  const identifierByPerson = {};
  staffRecords_(db.identifiers).forEach(function (record) {
    if (!identifierByPerson[record["Person ID"]] && staffTrue_(record.Active) && String(record.Type).toLowerCase() !== "email") identifierByPerson[record["Person ID"]] = record;
  });
  const toolsByPerson = {};
  const toolApprovalsByPerson = {};
  establishedTraining.forEach(function (record) {
    if (!toolsByPerson[record["Person ID"]]) toolsByPerson[record["Person ID"]] = [];
    if (toolsByPerson[record["Person ID"]].indexOf(record.Tool) === -1) toolsByPerson[record["Person ID"]].push(record.Tool);
    if (!toolApprovalsByPerson[record["Person ID"]]) toolApprovalsByPerson[record["Person ID"]] = [];
    if (!toolApprovalsByPerson[record["Person ID"]].some(function (tool) { return tool.key === record.ToolKey; })) toolApprovalsByPerson[record["Person ID"]].push({ key: record.ToolKey, label: record.Tool });
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
      affiliation: registration ? staffClean_(registration["Program / Department"], 80) : "",
      identifierHint: identifier ? staffIdentifierHint_(identifier.Value) : "",
      attention: staffAttentionFlags_(registration),
      toolLabels: toolsByPerson[personId] || [],
      toolApprovals: toolApprovalsByPerson[personId] || [],
      fabmanMemberId: linkedPeople[personId] || 0,
      searchText: [person["Display Name"], person.Role, registration && registration["Program / Department"]].join(" ").toLowerCase(),
    };
  });
  const result = { ok: true, actor: access, present: presence.present, left: presence.left, notes: notes, peopleIndex: peopleIndex, tools: toolCatalog, refreshedAt: new Date().toISOString() };
  staffCachePutJson_("dashboard", result, STAFF_CACHE_SECONDS_.dashboard);
  result.performance = { totalMs: Date.now() - started, cache: "miss" };
  return result;
}

function staffMarkLeft(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabaseKeys_(["people", "visits"]);
  const person = staffFindPerson_(db.people, personId);
  db.visits.appendRow([staffId_("visit"), personId, new Date(), "Staff Checkout", access.email, "", "Marked left from staff app", "Staff app", ""]);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]) };
}

function staffReopen(personId) {
  const access = staffRequireAccess_();
  const db = staffDatabaseKeys_(["people", "visits"]);
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
  const db = staffDatabaseKeys_(["people", "visits"]);
  const person = staffFindPerson_(db.people, personId);
  db.visits.appendRow([staffId_("visit"), personId, new Date(), "User Checkin", access.email, "Manual check-in", "Created by staff", "Staff app", ""]);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]) };
}

function staffApproveLaser(personId) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const db = staffDatabaseKeys_(["people", "certifications", "fabmanLinks"]);
  const person = staffFindPerson_(db.people, personId);
  const existing = staffRecords_(db.certifications).some(function (row) {
    return row["Person ID"] === personId && String(row["Tool Key"]).toLowerCase() === "epilog_laser_cutter" && String(row.Status).toLowerCase() === "active";
  });
  if (!existing) db.certifications.appendRow([
    staffId_("cert"), personId, "epilog_laser_cutter", "Active", new Date(), "", "Staff app", "",
    staffSheetSafe_("Approved by " + access.email + ".")
  ]);
  const link = staffActiveFabmanLink_(db, personId);
  staffAfterWrite_(personId);
  return { ok: true, name: staffPreferredName_(person["Display Name"]), fabmanMemberId: link ? Number(link["FabMan Member ID"]) : 0, fabmanStatus: link ? "Sync queued" : "Member link required" };
}

function staffSyncLaserFabman(personId) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const db = staffDatabaseKeys_(["fabmanLinks"]);
  const link = staffActiveFabmanLink_(db, personId);
  if (!link) return { ok: false, label: "Member link required" };
  const sync = fabmanEnsureLaserTraining_(link["FabMan Member ID"], new Date(), access.email);
  staffClearFabmanCache_(link["FabMan Member ID"]);
  staffAfterWrite_(personId);
  return sync;
}

function staffApproveTool(personId, toolKey) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const db = staffDatabaseKeys_(["people", "certifications", "tools", "fabmanLinks"]);
  const person = staffFindPerson_(db.people, personId);
  const tool = staffFindTool_(db.tools, toolKey, true);
  if (!tool.staffCanApprove) throw new Error(tool.name + " is not enabled for staff approval.");
  const existing = staffRecords_(db.certifications).some(function (row) {
    return row["Person ID"] === personId && String(row["Tool Key"]).toLowerCase() === tool.key && String(row.Status).toLowerCase() === "active";
  });
  if (!existing) db.certifications.appendRow([staffId_("cert"), personId, tool.key, "Active", new Date(), "", "Staff app", "", staffSheetSafe_("Approved by " + access.email + ".")]);
  const link = staffActiveFabmanLink_(db, personId);
  staffAfterWrite_(personId);
  return { ok: true, personId: personId, name: staffPreferredName_(person["Display Name"]), tool: tool, fabmanMemberId: link ? Number(link["FabMan Member ID"]) : 0 };
}

function staffRevokeTool(personId, toolKey, reason) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const cleanedReason = staffClean_(reason, 240);
  if (!cleanedReason) throw new Error("Choose or enter a reason for removing training.");
  const db = staffDatabaseKeys_(["people", "certifications", "tools", "fabmanLinks"]);
  const person = staffFindPerson_(db.people, personId);
  const tool = staffFindTool_(db.tools, toolKey, false);
  const sheet = db.certifications;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const personCol = headers.indexOf("Person ID"), toolCol = headers.indexOf("Tool Key"), statusCol = headers.indexOf("Status"), removedCol = headers.indexOf("Removed At"), notesCol = headers.indexOf("Notes");
  const index = values.findIndex(function (row, rowIndex) { return rowIndex > 0 && row[personCol] === personId && String(row[toolCol]).toLowerCase() === tool.key && String(row[statusCol]).toLowerCase() === "active"; });
  if (index < 1) throw new Error("No active " + tool.name + " approval was found.");
  const rowNumber = index + 1;
  sheet.getRange(rowNumber, statusCol + 1).setValue("Revoked");
  sheet.getRange(rowNumber, removedCol + 1).setValue(new Date());
  const previousNotes = staffClean_(values[index][notesCol], 500);
  sheet.getRange(rowNumber, notesCol + 1).setValue(staffSheetSafe_([previousNotes, "Revoked by " + access.email + ": " + cleanedReason].filter(Boolean).join(" | ")));
  const link = staffActiveFabmanLink_(db, personId);
  staffAfterWrite_(personId);
  return { ok: true, personId: personId, name: staffPreferredName_(person["Display Name"]), tool: tool, fabmanMemberId: link ? Number(link["FabMan Member ID"]) : 0 };
}

function staffBatchApproveTool(toolKey, personIds) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const ids = Array.from(new Set((personIds || []).map(function (id) { return staffClean_(id, 120); }).filter(Boolean)));
  if (!ids.length || ids.length > 24) throw new Error("Choose between 1 and 24 workshop participants.");
  const db = staffDatabaseKeys_(["people", "certifications", "tools", "fabmanLinks"]);
  const tool = staffFindTool_(db.tools, toolKey, true);
  if (!tool.staffCanApprove) throw new Error(tool.name + " is not enabled for staff approval.");
  const people = {}; staffRecords_(db.people).forEach(function (row) { if (String(row.Status).toLowerCase() === "active") people[row["Person ID"]] = row; });
  const existing = {}; staffRecords_(db.certifications).forEach(function (row) { if (String(row.Status).toLowerCase() === "active" && String(row["Tool Key"]).toLowerCase() === tool.key) existing[row["Person ID"]] = true; });
  const links = {}; staffRecords_(db.fabmanLinks).forEach(function (row) { if (String(row.Status).toLowerCase() === "active") links[row["Person ID"]] = Number(row["FabMan Member ID"]); });
  const rows = [], results = [];
  ids.forEach(function (personId) {
    const person = people[personId];
    if (!person) throw new Error("One selected workshop participant is no longer active.");
    if (!existing[personId]) rows.push([staffId_("cert"), personId, tool.key, "Active", new Date(), "", "Staff workshop", "", staffSheetSafe_("Workshop approval by " + access.email + ".")]);
    results.push({ personId: personId, name: staffPrivateName_(person["Display Name"]), saved: true, alreadyApproved: Boolean(existing[personId]), fabmanMemberId: links[personId] || 0 });
  });
  if (rows.length) db.certifications.getRange(db.certifications.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  staffAfterWrite_();
  const cache = CacheService.getScriptCache();
  ids.forEach(function (personId) { cache.remove("person:" + staffClean_(personId, 120)); });
  return { ok: true, tool: tool, results: results };
}

function staffSyncToolFabman(personId, toolKey, remove) {
  const access = staffRequireAccess_(["trainer", "administrator"]);
  const db = staffDatabaseKeys_(["tools", "fabmanLinks"]);
  const tool = staffFindTool_(db.tools, toolKey, false);
  if (!tool.fabmanEnabled) return { ok: true, label: "FabMan not used for this training" };
  const link = staffActiveFabmanLink_(db, personId);
  if (!link) return { ok: false, label: "FabMan member link required" };
  const result = remove ? fabmanRemoveTraining_(link["FabMan Member ID"], tool, access.email) : fabmanEnsureTraining_(link["FabMan Member ID"], tool, new Date(), access.email);
  staffClearFabmanCache_(link["FabMan Member ID"]);
  return result;
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
  const toolCatalog = staffToolCatalog_(db.tools);
  const toolByKey = {}; toolCatalog.forEach(function (tool) { toolByKey[tool.key] = tool; });
  const tools = {};
  staffRecords_(db.certifications).forEach(function (row) {
    if (row["Person ID"] !== personId || String(row.Status).toLowerCase() !== "active") return;
    const key = staffClean_(row["Tool Key"], 80).toLowerCase();
    tools[key] = {
      key: key,
      label: toolByKey[key] ? toolByKey[key].name : staffToolLabel_(key),
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
      label: toolByKey[key] ? toolByKey[key].name : staffToolLabel_(key),
      status: "Training recorded",
      approvedAt: staffIsoDate_(row["Approved At"]),
      source: "Legacy staff approval",
      fabmanStatus: staffClean_(row["FabMan Status"], 80) || "Not connected",
    };
  });
  const fabmanLink = staffActiveFabmanLink_(db, personId);
  const activeCard = staffRecords_(db.cards).filter(function (row) {
    return row["Person ID"] === personId && String(row.Status).toLowerCase() === "active";
  }).pop();
  const fabman = fabmanLink ? { connected: true, checking: true, memberId: Number(fabmanLink["FabMan Member ID"]), label: "Checking live status…", trainingActive: false, packageActive: false, keyConnected: false } : { connected: false, checking: false, label: "No verified member link", trainingActive: false, packageActive: false, keyConnected: false };
  Object.keys(tools).forEach(function (key) {
    const configured = toolByKey[key];
    tools[key].fabmanStatus = configured && configured.fabmanEnabled ? fabman.label : "FabMan not used";
  });
  const result = {
    ok: true,
    personId: personId,
    name: staffPrivateName_(person["Display Name"]),
    role: staffRoleLabel_(person.Role),
    affiliation: registration ? staffClean_(registration["Program / Department"], 80) : "",
    identifierHint: identifier ? staffIdentifierHint_(identifier.Value) : "",
    identifierType: identifier ? staffClean_(identifier.Type, 80) : "",
    hasActiveCard: Boolean(activeCard),
    attention: staffAttentionFlags_(registration),
    tools: Object.keys(tools).map(function (key) { return tools[key]; }),
    canApproveTraining: ["trainer", "administrator"].indexOf(access.role) !== -1,
    canManageIdentity: access.role === "administrator",
    fabmanConnected: fabman.connected,
    fabman: fabman,
  };
  staffCachePutJson_(cacheKey, result, STAFF_CACHE_SECONDS_.person);
  result.performance = { totalMs: Date.now() - started, cache: "miss" };
  return result;
}

function staffStartIdentityUpdate(input) {
  const access = staffRequireAccess_(["administrator"]);
  const data = input || {};
  const personId = staffClean_(data.personId, 120);
  const replaceCard = Boolean(data.replaceCard);
  const updateIdentifier = Boolean(data.updateIdentifier);
  const disableOldCard = Boolean(data.disableOldCard);
  if (!replaceCard && !updateIdentifier) throw new Error("Choose an ID update, a replacement card, or both.");

  const db = staffDatabaseKeys_(["people", "identifiers", "cards", "visits", "fabmanLinks", "cardUpdates"]);
  const person = staffFindPerson_(db.people, personId);
  let identifierType = "";
  let identifierValue = "";
  let identifierNormalized = "";
  if (updateIdentifier) {
    identifierType = staffClean_(data.identifierType, 40);
    if (["UCSD ID", "Employee ID"].indexOf(identifierType) === -1) throw new Error("Choose UCSD ID or Employee ID.");
    identifierValue = staffClean_(data.identifierValue, 32).toUpperCase().replace(/[\s-]+/g, "");
    identifierNormalized = staffNormalizeIdentifier_(identifierValue);
    if (!/^[A-Z0-9]{5,20}$/.test(identifierValue) || !identifierNormalized) throw new Error("Enter a valid PID or employee ID.");
    const duplicate = staffRecords_(db.identifiers).some(function (row) {
      return row["Person ID"] !== personId && staffTrue_(row.Active) && String(row.Type).toLowerCase() !== "email" && staffNormalizeIdentifier_(row["Normalized Value"] || row.Value) === identifierNormalized;
    });
    if (duplicate) throw new Error("That PID or employee ID is already active on another account.");
  }

  if (!replaceCard) {
    staffApplyIdentifierUpdate_(db.identifiers, personId, identifierType, identifierValue, identifierNormalized, access.email);
    db.visits.appendRow([staffId_("visit"), personId, new Date(), "Identifier Updated", access.email, "", "Primary identifier changed; previous identifier retained as inactive history.", "Staff app", ""]);
    staffAfterWrite_(personId);
    return { ok: true, completed: true, name: staffPreferredName_(person["Display Name"]), message: "ID updated. The existing card and FabMan link were unchanged." };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const code = staffRandomCode_();
  let oldCardDisabledAt = "";
  let fabmanStatus = "Unchanged until replacement tap";
  let fabmanKeyType = "nfca";
  const activeLink = staffActiveFabmanLink_(db, personId);
  if (activeLink) {
    const existingKey = fabmanFetch_("members/" + encodeURIComponent(Number(activeLink["FabMan Member ID"])) + "/key");
    if (existingKey.ok && existingKey.data && existingKey.data.type) fabmanKeyType = staffClean_(existingKey.data.type, 20);
  }
  if (disableOldCard) {
    const link = activeLink;
    if (link) {
      const deleted = fabmanFetch_("members/" + encodeURIComponent(Number(link["FabMan Member ID"])) + "/key", "delete");
      if (!deleted.ok && deleted.status !== 404) throw new Error("FabMan could not disable the old key. Nothing was changed; try again.");
      staffClearFabmanCache_(link["FabMan Member ID"]);
      fabmanStatus = "Old key disabled; replacement pending";
    } else {
      fabmanStatus = "No verified FabMan member link";
    }
    staffRetireActiveCards_(db.cards, personId, now);
    oldCardDisabledAt = now;
    db.visits.appendRow([staffId_("visit"), personId, now, "Card Disabled", access.email, "", "Old card disabled before replacement tap.", "Staff app", ""]);
  }
  db.cardUpdates.appendRow([
    staffId_("cardupdate"), staffCodeDigest_(code), personId, "Pending", identifierType, staffSheetSafe_(identifierValue), identifierNormalized,
    disableOldCard, oldCardDisabledAt, access.email, now, expiresAt, "", fabmanStatus,
    "Existing FabMan member link, packages, memberships, equipment training, and history must remain unchanged.", fabmanKeyType
  ]);
  staffAfterWrite_(personId);
  return {
    ok: true, completed: false, code: code, expiresAt: expiresAt.toISOString(), name: staffPreferredName_(person["Display Name"]),
    oldCardDisabled: disableOldCard,
    message: disableOldCard ? "Old card disabled. Enter this code at the kiosk and tap the replacement card." : "Enter this code at the kiosk and tap the replacement card. The old card stays active until that succeeds."
  };
}

function staffApplyIdentifierUpdate_(sheet, personId, type, value, normalized, actor) {
  if (!value) return;
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const personCol = headers.indexOf("Person ID"), typeCol = headers.indexOf("Type"), primaryCol = headers.indexOf("Primary"), activeCol = headers.indexOf("Active");
  values.forEach(function (row, index) {
    if (index > 0 && row[personCol] === personId && String(row[typeCol]).toLowerCase() !== "email" && staffTrue_(row[activeCol])) {
      sheet.getRange(index + 1, primaryCol + 1).setValue(false);
      sheet.getRange(index + 1, activeCol + 1).setValue(false);
    }
  });
  sheet.appendRow([staffId_("identifier"), personId, type, staffSheetSafe_(value), normalized, true, true, true, new Date(), "Staff app ID update", staffSheetSafe_("Updated by " + actor)]);
}

function staffRetireActiveCards_(sheet, personId, retiredAt) {
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values[0];
  const personCol = headers.indexOf("Person ID"), statusCol = headers.indexOf("Status"), retiredCol = headers.indexOf("Retired At");
  values.forEach(function (row, index) {
    if (index > 0 && row[personCol] === personId && String(row[statusCol]).toLowerCase() === "active") {
      sheet.getRange(index + 1, statusCol + 1).setValue("Retired");
      sheet.getRange(index + 1, retiredCol + 1).setValue(retiredAt);
    }
  });
}

function staffNormalizeIdentifier_(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  return normalized.charAt(0) === "A" ? normalized.slice(1) : normalized;
}

function staffRandomCode_() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + new Date().getTime());
  return bytes.slice(0, 10).map(function (value) { return alphabet.charAt((value + 256) % alphabet.length); }).join("");
}

function staffCodeDigest_(code) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(code || "").trim().toUpperCase()).map(function (value) { return (value + 256).toString(16).slice(-2); }).join("");
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
  return fabmanEnsureTraining_(memberId, { key: "epilog_laser_cutter", name: "Laser Cutter", fabmanEnabled: true, fabmanTrainingCourseId: 2255 }, approvedAt, approvedBy);
}

function fabmanEnsureTraining_(memberId, tool, approvedAt, approvedBy) {
  const current = fabmanFetch_("members/" + encodeURIComponent(memberId) + "?embed=trainings");
  if (!current.ok) return { ok: false, label: "FabMan connection failed" };
  const trainings = (current.data._embedded && current.data._embedded.trainings) || current.data.trainings || [];
  const existing = trainings.some(function (item) { const id = item.trainingCourse && item.trainingCourse.id ? item.trainingCourse.id : (item.trainingCourse || item.course); return Number(id) === Number(tool.fabmanTrainingCourseId); });
  if (existing) return { ok: true, label: tool.name + " training already active" };
  const date = new Date(approvedAt);
  const trainingDate = Utilities.formatDate(isNaN(date.getTime()) ? new Date() : date, "UTC", "yyyy-MM-dd");
  const response = fabmanFetch_("members/" + encodeURIComponent(memberId) + "/trainings", "post", {
    date: trainingDate,
    trainingCourse: Number(tool.fabmanTrainingCourseId),
    notes: "Approved for " + tool.name + " in the Scripps Sandbox staff app by " + approvedBy + ".",
  });
  if (!response.ok) return { ok: false, label: "FabMan sync failed: " + response.error };
  staffClearFabmanCache_(memberId);
  return { ok: true, label: tool.name + " training added to FabMan" };
}

function fabmanRemoveTraining_(memberId, tool) {
  const current = fabmanFetch_("members/" + encodeURIComponent(memberId) + "?embed=trainings");
  if (!current.ok) throw new Error("FabMan connection failed; local revocation was saved.");
  const trainings = (current.data._embedded && current.data._embedded.trainings) || current.data.trainings || [];
  const match = trainings.find(function (item) { const id = item.trainingCourse && item.trainingCourse.id ? item.trainingCourse.id : (item.trainingCourse || item.course); return Number(id) === Number(tool.fabmanTrainingCourseId); });
  if (!match) return { ok: true, label: tool.name + " training was already absent in FabMan" };
  if (!match.id) throw new Error("FabMan did not return a removable training record; local revocation was saved.");
  const removed = fabmanFetch_("members/" + encodeURIComponent(memberId) + "/trainings/" + encodeURIComponent(match.id), "delete");
  if (!removed.ok) throw new Error("Local revocation saved, but FabMan removal failed: " + removed.error);
  staffClearFabmanCache_(memberId);
  return { ok: true, label: tool.name + " training removed from FabMan" };
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
  const result = { connected: true, checking: false, memberId: Number(member.id), label: parts.join(" · "), trainingActive: trainingActive, trainingCourseIds: trainingIds, packageActive: packageActive, keyConnected: keyConnected };
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
  const noteId = staffId_("note");
  const createdAt = new Date();
  staffDatabaseKeys_(["notes"]).notes.appendRow([noteId, staffSheetSafe_(cleaned), access.email, createdAt, "Open", "", ""]);
  staffAfterWrite_();
  return { ok: true, note: { id: noteId, note: cleaned, createdBy: access.email, createdAt: createdAt.toISOString(), status: "Open" } };
}

function staffResolveNote(noteId, reopen) {
  const access = staffRequireAccess_();
  const sheet = staffDatabaseKeys_(["notes"]).notes;
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

function staffAdminSaveTool(input) {
  staffRequireAccess_(["administrator"]);
  const data = input || {};
  const key = staffClean_(data.key, 80).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const name = staffClean_(data.name, 120);
  if (!key || !name) throw new Error("Tool key and display name are required.");
  const fabmanEnabled = Boolean(data.fabmanEnabled);
  const resourceId = Number(data.fabmanResourceId || 0), trainingId = Number(data.fabmanTrainingCourseId || 0);
  if (fabmanEnabled && (!resourceId || !trainingId)) throw new Error("Choose both a FabMan resource and training course before enabling the FabMan connection.");
  if (fabmanEnabled) staffValidateFabmanMapping_(resourceId, trainingId);
  const sheet = staffDatabaseKeys_(["tools"]).tools;
  staffEnsureToolColumns_(sheet);
  const values = sheet.getDataRange().getDisplayValues(), headers = values[0];
  const keyCol = headers.indexOf("Tool Key");
  let row = values.findIndex(function (record, index) { return index > 0 && String(record[keyCol]).toLowerCase() === key; });
  const record = {
    "Tool Key": key, "Display Name": name, "Active": data.active ? "TRUE" : "FALSE", "Staff Can Approve": data.staffCanApprove ? "TRUE" : "FALSE",
    "Sort Order": Number(data.sortOrder || 100), "Category": staffClean_(data.category, 80) || "Other", "Legacy Header": staffClean_(data.legacyHeader, 120),
    "FabMan Enabled": fabmanEnabled ? "TRUE" : "FALSE", "FabMan Resource ID": resourceId || "", "FabMan Training Course ID": trainingId || "", "Updated At": new Date(), "Updated By": Session.getActiveUser().getEmail()
  };
  const output = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(record, header) ? record[header] : (row > 0 ? values[row][headers.indexOf(header)] : ""); });
  if (row > 0) sheet.getRange(row + 1, 1, 1, headers.length).setValues([output]); else sheet.appendRow(output);
  staffAfterWrite_();
  return { ok: true, tool: staffToolFromRecord_(record) };
}

function staffFabmanMappingOptions() {
  staffRequireAccess_(["administrator"]);
  const resources = fabmanFetch_("resources?account=1046&limit=500&embed=trainingCourses&embed=bridge");
  const courses = fabmanFetch_("training-courses?account=1046&limit=500");
  if (!resources.ok || !courses.ok) throw new Error("FabMan mapping options could not be loaded.");
  return {
    resources: staffFabmanList_(resources.data).map(function (item) { return { id: Number(item.id), name: staffClean_(item.name || item.title, 120), space: item.space && (item.space.name || item.space), hasBridge: Boolean(item.bridge || (item._embedded && item._embedded.bridge)) }; }).filter(function (item) { return item.id && item.name; }),
    courses: staffFabmanList_(courses.data).map(function (item) { return { id: Number(item.id), name: staffClean_(item.name || item.title, 120), archived: Boolean(item.archived) }; }).filter(function (item) { return item.id && item.name && !item.archived; })
  };
}

function staffValidateFabmanMapping_(resourceId, trainingId) {
  const resource = fabmanFetch_("resources/" + encodeURIComponent(resourceId) + "?embed=trainingCourses");
  if (!resource.ok) throw new Error("That FabMan resource could not be verified.");
  const embedded = resource.data._embedded || {};
  const ids = (embedded.trainingCourses || resource.data.trainingCourses || []).map(function (course) { return Number(course.id || course); });
  if (ids.length && ids.indexOf(Number(trainingId)) === -1) throw new Error("The selected FabMan training course is not assigned to that resource.");
  return true;
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

function staffDatabase_(accessOnly) {
  const keys = accessOnly ? ["staffAccess"] : Object.keys(STAFF_CONFIG_.sheets);
  return staffDatabaseKeys_(keys);
}

function staffDatabaseKeys_(keys) {
  const spreadsheet = staffSpreadsheet_();
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
    if (definition.createIfMissing) staffEnsureColumns_(sheet, definition.headers);
    staffAssertHeaders_(sheet, definition.headers, definition.allowAdditionalHeaders);
    db[key] = sheet;
  });
  return db;
}

function staffEnsureColumns_(sheet, required) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const missing = required.filter(function (header) { return headers.indexOf(header) === -1; });
  if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
}

function staffEnsureToolColumns_(sheet) {
  if (!sheet) throw new Error("Tools sheet is missing.");
  const required = ["FabMan Enabled", "FabMan Resource ID", "FabMan Training Course ID", "Updated At", "Updated By"];
  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  const missing = required.filter(function (header) { return headers.indexOf(header) === -1; });
  if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
}

function staffToolCatalog_(sheet) {
  return staffRecords_(sheet).map(staffToolFromRecord_).filter(function (tool) { return tool.key; }).sort(function (a, b) { return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name); });
}

function staffToolFromRecord_(row) {
  return {
    key: staffClean_(row["Tool Key"], 80).toLowerCase(), name: staffClean_(row["Display Name"], 120), active: staffTrue_(row.Active), staffCanApprove: staffTrue_(row["Staff Can Approve"]),
    sortOrder: Number(row["Sort Order"] || 100), category: staffClean_(row.Category, 80), legacyHeader: staffClean_(row["Legacy Header"], 120), fabmanEnabled: staffTrue_(row["FabMan Enabled"]),
    fabmanResourceId: Number(row["FabMan Resource ID"] || 0), fabmanTrainingCourseId: Number(row["FabMan Training Course ID"] || 0)
  };
}

function staffFindTool_(sheet, toolKey, requireActive) {
  const key = staffClean_(toolKey, 80).toLowerCase();
  const tool = staffToolCatalog_(sheet).find(function (item) { return item.key === key; });
  if (!tool || (requireActive && !tool.active)) throw new Error("Tool is not active in the catalog.");
  if (tool.fabmanEnabled && (!tool.fabmanResourceId || !tool.fabmanTrainingCourseId)) throw new Error(tool.name + " has an incomplete FabMan mapping.");
  return tool;
}

function staffFabmanList_(data) { return Array.isArray(data) ? data : ((data && data._embedded && Object.keys(data._embedded).map(function (key) { return data._embedded[key]; }).find(Array.isArray)) || (data && data.items) || []); }

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
