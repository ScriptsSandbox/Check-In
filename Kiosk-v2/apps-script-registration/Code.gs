const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  waiverSpreadsheetProperty: "WAIVER_DATABASE_SPREADSHEET_ID",
  kioskApiKeyProperty: "KIOSK_API_KEY",
  fabmanApiKeyProperty: "FABMAN_API_KEY",
  consentVersion: "2026-08-11",
  sheets: {
    people: {
      name: "People",
      headers: ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"],
    },
    identifiers: {
      name: "Identifiers",
      headers: ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"],
    },
    registrations: {
      name: "Registrations",
      headers: ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"],
    },
    cards: {
      name: "Cards",
      headers: ["Card ID", "Person ID", "Card Digest", "Last Four", "Status", "Linked At", "Retired At", "Source System", "Source Row"],
    },
    visits: {
      name: "Visits",
      headers: ["Visit ID", "Person ID", "Check In At", "Event Type", "Authorizing Entity", "Flags", "Notes", "Source System", "Source Row"],
    },
    staffAccess: {
      name: "Staff Access",
      headers: ["Staff ID", "Name", "Email", "Role", "Active", "Card Linking Allowed", "Notes"],
    },
    fabmanLinks: {
      name: "FabMan Links",
      headers: ["Link ID", "Person ID", "FabMan Member ID", "Status", "Match Method", "Confirmed By", "Confirmed At", "Notes"],
    },
    cardUpdates: {
      name: "Card Update Sessions",
      headers: ["Session ID", "Code Digest", "Person ID", "Status", "New Identifier Type", "New Identifier Value", "New Identifier Normalized", "Disable Old Card", "Old Card Disabled At", "Requested By", "Requested At", "Expires At", "Completed At", "FabMan Status", "Notes", "FabMan Key Type"],
      createIfMissing: true,
    },
  },
};

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Create a Scripps Sandbox account");
}

function setupRegistrationSheet() {
  const database = openRegistrationDatabase_();
  return {
    ok: true,
    spreadsheetId: database.spreadsheet.getId(),
    spreadsheetName: database.spreadsheet.getName(),
    sheetNames: [database.people.getName(), database.identifiers.getName(), database.registrations.getName()],
  };
}

function registrationStatus() {
  const database = openRegistrationDatabase_();
  return {
    configured: true,
    spreadsheetId: database.spreadsheet.getId(),
    spreadsheetName: database.spreadsheet.getName(),
    sheetNames: [database.people.getName(), database.identifiers.getName(), database.registrations.getName()],
    waiverConfigured: Boolean(
      PropertiesService.getScriptProperties().getProperty(REGISTRATION_CONFIG_.waiverUrlProperty)
    ),
  };
}

function submitRegistration(payload) {
  const validated = validateRegistration_(payload, Date.now());
  if (!validated.ok) return validated;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, message: "The registration system is busy. Please try again." };
  }

  const appended = [];
  try {
    const database = openRegistrationDatabase_();
    const submittedIdentifier = validated.value.identifier.replace(/[\s-]+/g, "").toUpperCase();
    const submittedEmail = validated.value.primaryEmail.toLowerCase();
    const lastIdentifierRow = database.identifiers.getLastRow();
    if (lastIdentifierRow > 1) {
      const existing = database.identifiers.getRange(2, 5, lastIdentifierRow - 1, 1).getDisplayValues();
      const duplicate = existing.some(function (row) {
        const value = cleanText_(row[0], 254);
        return value.toUpperCase() === submittedIdentifier || value.toLowerCase() === submittedEmail;
      });
      if (duplicate) {
        return {
          ok: false,
          code: "ALREADY_EXISTS",
          message: "An account already exists for that ID or email. Please use your existing account or ask Sandbox staff for help.",
        };
      }
    }

    const submittedAt = new Date();
    const personId = "person_" + Utilities.getUuid().replace(/-/g, "");
    const source = "Online registration";
    appendTracked_(database.people, [
      personId,
      "Active",
      sheetSafe_(validated.value.name),
      sheetSafe_(validated.value.role),
      sheetSafe_(validated.value.primaryEmail),
      sheetSafe_(validated.value.secondaryEmail),
      submittedAt,
      submittedAt,
      source,
      "",
    ], appended);

    appendTracked_(database.identifiers, [
      "identifier_" + Utilities.getUuid().replace(/-/g, ""),
      personId,
      validated.value.identifierType === "Student PID" ? "UCSD ID" : validated.value.identifierType,
      sheetSafe_(validated.value.identifier),
      sheetSafe_(submittedIdentifier),
      true,
      false,
      true,
      submittedAt,
      source,
      "",
    ], appended);

    appendTracked_(database.identifiers, [
      "identifier_" + Utilities.getUuid().replace(/-/g, ""),
      personId,
      "Email",
      sheetSafe_(validated.value.primaryEmail),
      sheetSafe_(submittedEmail),
      true,
      false,
      true,
      submittedAt,
      source,
      "",
    ], appended);

    appendTracked_(database.registrations, [
      "registration_" + Utilities.getUuid().replace(/-/g, ""),
      personId,
      "Unreviewed",
      submittedAt,
      "",
      "",
      sheetSafe_(validated.value.affiliation),
      sheetSafe_(validated.value.identifierType),
      "Awaiting verification",
      REGISTRATION_CONFIG_.consentVersion,
      "",
      source,
    ], appended);

    return {
      ok: true,
      firstName: validated.value.firstName,
      waiverUrl: getRequiredScriptProperty_(REGISTRATION_CONFIG_.waiverUrlProperty),
    };
  } catch (error) {
    rollbackAppends_(appended);
    return {
      ok: false,
      message: "We could not create the account. No information was intentionally retained by this form. Please try again or ask Sandbox staff for help.",
    };
  } finally {
    lock.releaseLock();
  }
}

function openRegistrationDatabase_() {
  const spreadsheetId = getRequiredScriptProperty_(REGISTRATION_CONFIG_.spreadsheetProperty);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const database = { spreadsheet: spreadsheet };
  Object.keys(REGISTRATION_CONFIG_.sheets).forEach(function (key) {
    const definition = REGISTRATION_CONFIG_.sheets[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet && definition.createIfMissing) {
      sheet = spreadsheet.insertSheet(definition.name);
      sheet.appendRow(definition.headers);
      sheet.setFrozenRows(1);
    }
    if (!sheet) throw new Error("Registration database setup is incomplete.");
    if (definition.createIfMissing) {
      const width = Math.max(sheet.getLastColumn(), 1);
      const present = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
      const missing = definition.headers.filter(function (header) { return present.indexOf(header) === -1; });
      if (missing.length) sheet.getRange(1, present.length + 1, 1, missing.length).setValues([missing]);
    }
    const actual = sheet.getRange(1, 1, 1, definition.headers.length).getDisplayValues()[0];
    definition.headers.forEach(function (header, index) {
      if (actual[index] !== header) throw new Error("Registration database layout does not match the expected schema.");
    });
    database[key] = sheet;
  });
  return database;
}

function appendTracked_(sheet, row, appended) {
  const rowNumber = sheet.getLastRow() + 1;
  sheet.appendRow(row);
  appended.push({ sheet: sheet, rowNumber: rowNumber });
}

function rollbackAppends_(appended) {
  appended.reverse().forEach(function (entry) {
    try {
      if (entry.sheet.getLastRow() === entry.rowNumber) entry.sheet.deleteRow(entry.rowNumber);
    } catch (ignored) {}
  });
}

function getRequiredScriptProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Registration deployment is not configured.");
  return value;
}

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    if (String(request.apiKey || "") !== getRequiredScriptProperty_(REGISTRATION_CONFIG_.kioskApiKeyProperty)) {
      return kioskJson_({ ok: false, outcome: "unauthorized", message: "Kiosk authorization failed." });
    }
    const action = String(request.action || "");
    if (action === "status") {
      const database = openRegistrationDatabase_();
      return kioskJson_({ ok: true, outcome: "ready", database: database.spreadsheet.getName() });
    }
    if (action === "check_in_card") return kioskJson_(kioskCheckIn_(findKioskUserByCard_(request.cardDigest)));
    if (action === "check_in_identifier") {
      const user = findKioskUserByIdentifier_(request.identifier);
      if (!user) return kioskJson_({ ok: false, outcome: "unknown_identifier", message: "We could not find that PID or employee ID." });
      return kioskJson_(kioskCheckIn_(user));
    }
    if (action === "prepare_card_link") return kioskJson_(prepareKioskCardLink_(request.identifier));
    if (action === "link_card") return kioskJson_(linkKioskCard_(request));
    if (action === "prepare_card_update") return kioskJson_(prepareKioskCardUpdate_(request.code));
    if (action === "complete_card_update") return kioskJson_(completeKioskCardUpdate_(request));
    return kioskJson_({ ok: false, outcome: "backend_error", message: "Unknown kiosk operation." });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return kioskJson_({ ok: false, outcome: "backend_error", message: "The kiosk database request failed." });
  }
}

function kioskJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function kioskRecords_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function (row) {
    return row.some(function (cell) { return String(cell).trim(); });
  }).map(function (row) {
    const record = {};
    headers.forEach(function (header, index) { record[header] = row[index]; });
    return record;
  });
}

function kioskTrue_(value) {
  return ["true", "1", "yes"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

function kioskIdentifier_(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  return normalized.charAt(0) === "A" ? normalized.slice(1) : normalized;
}

function kioskUsers_() {
  const database = openRegistrationDatabase_();
  const people = kioskRecords_(database.people);
  const identifiers = kioskRecords_(database.identifiers);
  const cards = kioskRecords_(database.cards);
  return people.filter(function (person) {
    return String(person.Status).toLowerCase() === "active";
  }).map(function (person) {
    const personId = person["Person ID"];
    const personIdentifiers = identifiers.filter(function (record) {
      return record["Person ID"] === personId && kioskTrue_(record.Active);
    });
    const primaryId = personIdentifiers.find(function (record) {
      return String(record.Type).toLowerCase() !== "email" && kioskTrue_(record.Primary);
    }) || personIdentifiers.find(function (record) { return String(record.Type).toLowerCase() !== "email"; });
    const activeCard = cards.filter(function (record) {
      return record["Person ID"] === personId && String(record.Status).toLowerCase() === "active";
    }).pop();
    return {
      personId: personId,
      name: person["Display Name"] || "Sandbox member",
      email: String(person["Primary Email"] || "").toLowerCase(),
      identifier: primaryId ? primaryId["Normalized Value"] : "",
      cardDigest: activeCard ? String(activeCard["Card Digest"] || "").toLowerCase() : "",
    };
  });
}

function findKioskUserByCard_(digest) {
  const normalized = String(digest || "").toLowerCase();
  return kioskUsers_().find(function (user) { return normalized && user.cardDigest === normalized; }) || null;
}

function findKioskUserByIdentifier_(identifier) {
  const normalized = kioskIdentifier_(identifier);
  const matches = kioskUsers_().filter(function (user) { return normalized && kioskIdentifier_(user.identifier) === normalized; });
  if (matches.length > 1) throw new Error("Identifier is not unique.");
  return matches[0] || null;
}

function kioskWaiverFound_(user) {
  const spreadsheetId = getRequiredScriptProperty_(REGISTRATION_CONFIG_.waiverSpreadsheetProperty);
  const records = kioskRecords_(SpreadsheetApp.openById(spreadsheetId).getSheets()[0]);
  const userId = kioskIdentifier_(user.identifier);
  const email = String(user.email || "").toLowerCase();
  return records.some(function (waiver) {
    return (userId && kioskIdentifier_(waiver.A_Number) === userId) ||
      (email && String(waiver.Email || "").trim().toLowerCase() === email);
  });
}

function kioskCheckIn_(user) {
  if (!user) return { ok: false, outcome: "unknown_card", message: "This card is not connected to a Sandbox account." };
  if (!kioskWaiverFound_(user)) return { ok: false, outcome: "waiver_required", message: "A current waiver is required before check-in." };
  const database = openRegistrationDatabase_();
  const now = new Date();
  const today = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const days = {};
  kioskRecords_(database.visits).forEach(function (visit) {
    if (visit["Person ID"] === user.personId && visit["Event Type"] === "User Checkin") {
      const parsed = new Date(visit["Check In At"]);
      if (!isNaN(parsed.getTime())) days[Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd")] = true;
    }
  });
  days[today] = true;
  database.visits.appendRow(["visit_" + Utilities.getUuid().replace(/-/g, ""), user.personId, now, "User Checkin", "", "", "", "Kiosk v2", ""]);
  return { ok: true, outcome: "success", displayName: user.name, message: "Check-in recorded.", visitCount: Object.keys(days).length };
}

function prepareKioskCardLink_(identifier) {
  const user = findKioskUserByIdentifier_(identifier);
  if (!user) return { ok: false, outcome: "unknown_identifier", message: "We could not find that PID or employee ID." };
  if (user.cardDigest) return { ok: false, outcome: "card_link_error", message: "That account already has a connected card." };
  return { ok: true, outcome: "link_ready", displayName: user.name, message: "Ask designated staff to tap their own card." };
}

function linkKioskCard_(request) {
  const target = findKioskUserByIdentifier_(request.identifier);
  const staff = findKioskUserByCard_(request.staffDigest);
  if (!target) return { ok: false, outcome: "unknown_identifier", message: "We could not find that PID or employee ID." };
  if (target.cardDigest) return { ok: false, outcome: "card_link_error", message: "That account already has a connected card." };
  if (!staff || !request.memberDigest || request.memberDigest === request.staffDigest) {
    return { ok: false, outcome: "staff_unauthorized", message: "That card is not authorized to connect member cards." };
  }
  const database = openRegistrationDatabase_();
  const allowed = kioskRecords_(database.staffAccess).some(function (record) {
    return String(record.Email || "").trim().toLowerCase() === staff.email && kioskTrue_(record.Active) && kioskTrue_(record["Card Linking Allowed"]);
  });
  if (!allowed) return { ok: false, outcome: "staff_unauthorized", message: "That card is not authorized to connect member cards." };
  if (findKioskUserByCard_(request.memberDigest)) return { ok: false, outcome: "card_link_error", message: "That card is already connected to an account." };
  const now = new Date();
  database.cards.appendRow(["card_" + Utilities.getUuid().replace(/-/g, ""), target.personId, request.memberDigest, String(request.memberLastFour || "").slice(-4), "Active", now, "", "Kiosk v2 staff link", ""]);
  database.visits.appendRow(["visit_" + Utilities.getUuid().replace(/-/g, ""), target.personId, now, "Card Linked", staff.name, "", "", "Kiosk v2", ""]);
  return { ok: true, outcome: "card_linked", displayName: target.name, message: "Card connected. The member can now check in." };
}

function prepareKioskCardUpdate_(code) {
  const database = openRegistrationDatabase_();
  const session = findPendingCardUpdate_(database.cardUpdates, code);
  if (!session) return { ok: false, outcome: "card_update_error", message: "That handoff code is invalid, expired, or already used." };
  const person = kioskRecords_(database.people).find(function (row) { return row["Person ID"] === session.record["Person ID"] && String(row.Status).toLowerCase() === "active"; });
  if (!person) return { ok: false, outcome: "card_update_error", message: "The member account is no longer active." };
  return {
    ok: true,
    outcome: "card_update_ready",
    displayName: person["Display Name"] || "Sandbox member",
    message: "Tap the replacement UC San Diego ID on the reader.",
    oldCardDisabled: kioskTrue_(session.record["Disable Old Card"]),
    updatesIdentifier: Boolean(String(session.record["New Identifier Value"] || "").trim()),
  };
}

function completeKioskCardUpdate_(request) {
  const rawToken = String(request.cardToken || "").trim().toUpperCase();
  const digest = String(request.cardDigest || "").trim().toLowerCase();
  if (!/^[0-9A-F]{8,28}$/.test(rawToken) || !/^[0-9a-f]{64}$/.test(digest)) return { ok: false, outcome: "card_update_error", message: "The replacement card could not be read safely." };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, outcome: "card_update_error", message: "The update system is busy. Please try the card again." };
  try {
    const database = openRegistrationDatabase_();
    const session = findPendingCardUpdate_(database.cardUpdates, request.code);
    if (!session) return { ok: false, outcome: "card_update_error", message: "That handoff code is invalid, expired, or already used." };
    const personId = session.record["Person ID"];
    const person = kioskRecords_(database.people).find(function (row) { return row["Person ID"] === personId && String(row.Status).toLowerCase() === "active"; });
    if (!person) return { ok: false, outcome: "card_update_error", message: "The member account is no longer active." };
    const cards = kioskRecords_(database.cards);
    const duplicate = cards.find(function (row) { return String(row["Card Digest"] || "").toLowerCase() === digest && String(row.Status).toLowerCase() === "active"; });
    if (duplicate) return { ok: false, outcome: "card_update_error", message: duplicate["Person ID"] === personId ? "That is still the current card. Tap the replacement card." : "That card is already connected to another account." };

    const newIdentifier = String(session.record["New Identifier Value"] || "").trim();
    const newNormalized = kioskIdentifier_(session.record["New Identifier Normalized"] || newIdentifier);
    if (newIdentifier) {
      const identifierDuplicate = kioskRecords_(database.identifiers).some(function (row) {
        return row["Person ID"] !== personId && kioskTrue_(row.Active) && String(row.Type).toLowerCase() !== "email" && kioskIdentifier_(row["Normalized Value"] || row.Value) === newNormalized;
      });
      if (identifierDuplicate) return { ok: false, outcome: "card_update_error", message: "The new PID or employee ID is now active on another account. Return to the staff app." };
    }

    const link = kioskRecords_(database.fabmanLinks).find(function (row) { return row["Person ID"] === personId && String(row.Status).toLowerCase() === "active"; });
    let fabmanStatus = "No verified FabMan member link";
    if (link) {
      const memberId = Number(link["FabMan Member ID"]);
      if (!memberId) return { ok: false, outcome: "card_update_error", message: "The existing FabMan member link needs administrator review." };
      if (!PropertiesService.getScriptProperties().getProperty(REGISTRATION_CONFIG_.fabmanApiKeyProperty)) return { ok: false, outcome: "card_update_error", message: "FabMan card replacement is not configured on the kiosk service yet." };
      const removed = registrationFabmanFetch_("members/" + encodeURIComponent(memberId) + "/key", "delete");
      if (!removed.ok && removed.status !== 404) return { ok: false, outcome: "card_update_error", message: "FabMan could not retire the old key. No Sandbox card change was saved." };
      const keyType = String(session.record["FabMan Key Type"] || "nfca").trim().toLowerCase();
      const allowedKeyTypes = ["em4102", "nfca", "nfcb", "nfcf", "iso15693", "hid"];
      const added = registrationFabmanFetch_("members/" + encodeURIComponent(memberId) + "/key", "post", { type: allowedKeyTypes.indexOf(keyType) === -1 ? "nfca" : keyType, token: rawToken, state: "active" });
      if (!added.ok) {
        updateCardSessionStatus_(database.cardUpdates, session.rowNumber, "Pending", "FabMan replacement failed; retry required", "The old FabMan key may now be disabled. Retry the replacement tap.");
        return { ok: false, outcome: "card_update_error", message: "FabMan did not accept the replacement card. The old FabMan key is disabled; please retry or see an administrator." };
      }
      fabmanStatus = "Replacement key active on existing member " + memberId;
    }

    retireKioskCards_(database.cards, personId, new Date());
    database.cards.appendRow(["card_" + Utilities.getUuid().replace(/-/g, ""), personId, digest, String(request.cardLastFour || "").slice(-4), "Active", new Date(), "", "Kiosk replacement handoff", session.record["Session ID"]]);
    if (newIdentifier) applyKioskIdentifierUpdate_(database.identifiers, personId, session.record["New Identifier Type"] || "UCSD ID", newIdentifier, newNormalized, session.record["Requested By"]);
    updateCardSessionStatus_(database.cardUpdates, session.rowNumber, "Completed", fabmanStatus, "Replacement completed at kiosk. Existing FabMan member link and all non-key FabMan records were left unchanged.");
    database.visits.appendRow(["visit_" + Utilities.getUuid().replace(/-/g, ""), personId, new Date(), "Card Replaced", session.record["Requested By"], "", newIdentifier ? "Card and primary identifier updated." : "Card updated.", "Kiosk replacement handoff", session.record["Session ID"]]);
    return { ok: true, outcome: "card_updated", displayName: person["Display Name"] || "Sandbox member", message: "Replacement complete. The old card is disabled." };
  } finally {
    lock.releaseLock();
  }
}

function findPendingCardUpdate_(sheet, code) {
  const digest = kioskCodeDigest_(code);
  if (!digest) return null;
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return null;
  const headers = values[0];
  for (let index = 1; index < values.length; index += 1) {
    const record = {}; headers.forEach(function (header, column) { record[header] = values[index][column]; });
    if (record["Code Digest"] !== digest || String(record.Status).toLowerCase() !== "pending") continue;
    const expires = new Date(record["Expires At"]);
    if (isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return null;
    return { record: record, rowNumber: index + 1 };
  }
  return null;
}

function kioskCodeDigest_(code) {
  const cleaned = String(code || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[2-9A-HJ-NP-Z]{10}$/.test(cleaned)) return "";
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cleaned).map(function (value) { return (value + 256).toString(16).slice(-2); }).join("");
}

function retireKioskCards_(sheet, personId, retiredAt) {
  const values = sheet.getDataRange().getDisplayValues(), headers = values[0];
  const personCol = headers.indexOf("Person ID"), statusCol = headers.indexOf("Status"), retiredCol = headers.indexOf("Retired At");
  values.forEach(function (row, index) { if (index > 0 && row[personCol] === personId && String(row[statusCol]).toLowerCase() === "active") { sheet.getRange(index + 1, statusCol + 1).setValue("Retired"); sheet.getRange(index + 1, retiredCol + 1).setValue(retiredAt); } });
}

function applyKioskIdentifierUpdate_(sheet, personId, type, value, normalized, actor) {
  const values = sheet.getDataRange().getDisplayValues(), headers = values[0];
  const personCol = headers.indexOf("Person ID"), typeCol = headers.indexOf("Type"), primaryCol = headers.indexOf("Primary"), activeCol = headers.indexOf("Active");
  values.forEach(function (row, index) { if (index > 0 && row[personCol] === personId && String(row[typeCol]).toLowerCase() !== "email" && kioskTrue_(row[activeCol])) { sheet.getRange(index + 1, primaryCol + 1).setValue(false); sheet.getRange(index + 1, activeCol + 1).setValue(false); } });
  sheet.appendRow(["identifier_" + Utilities.getUuid().replace(/-/g, ""), personId, type, sheetSafe_(value), normalized, true, true, true, new Date(), "Kiosk replacement handoff", sheetSafe_("Requested by " + actor)]);
}

function updateCardSessionStatus_(sheet, rowNumber, status, fabmanStatus, notes) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  sheet.getRange(rowNumber, headers.indexOf("Status") + 1).setValue(status);
  if (String(status).toLowerCase() === "completed") sheet.getRange(rowNumber, headers.indexOf("Completed At") + 1).setValue(new Date());
  sheet.getRange(rowNumber, headers.indexOf("FabMan Status") + 1).setValue(fabmanStatus);
  sheet.getRange(rowNumber, headers.indexOf("Notes") + 1).setValue(notes);
}

function registrationFabmanFetch_(path, method, payload) {
  const token = getRequiredScriptProperty_(REGISTRATION_CONFIG_.fabmanApiKeyProperty);
  const options = { method: method || "get", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, muteHttpExceptions: true };
  if (payload !== undefined) { options.contentType = "application/json"; options.payload = JSON.stringify(payload); }
  const response = UrlFetchApp.fetch("https://fabman.io/api/v1/" + path, options);
  return { ok: response.getResponseCode() >= 200 && response.getResponseCode() < 300, status: response.getResponseCode() };
}
