const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  waiverSpreadsheetProperty: "WAIVER_DATABASE_SPREADSHEET_ID",
  kioskApiKeyProperty: "KIOSK_API_KEY",
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
      headers: ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Source"],
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
    const sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) throw new Error("Registration database setup is incomplete.");
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
