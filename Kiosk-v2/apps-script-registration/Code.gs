const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  docusignConnectTokenProperty: "DOCUSIGN_CONNECT_TOKEN",
  docusignTemplateIdProperty: "DOCUSIGN_WAIVER_TEMPLATE_ID",
  peopleSheet: "People",
  identifiersSheet: "Identifiers",
  registrationsSheet: "Registrations",
  scrippsWaiversSheet: "Scripps Waivers",
  consentVersion: "2026-08-11",
};

function doGet(event) {
  const template = HtmlService.createTemplateFromFile("Index");
  template.isKiosk = Boolean(event && event.parameter && event.parameter.mode === "kiosk");
  return template.evaluate()
    .setTitle("Create a Scripps Sandbox account")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function doPost(event) {
  try {
    const expectedToken = getRequiredScriptProperty_(REGISTRATION_CONFIG_.docusignConnectTokenProperty);
    const suppliedToken = String(event && event.parameter && event.parameter.waiver_key || "");
    if (!constantTimeEqual_(suppliedToken, expectedToken)) throw new Error("Unauthorized webhook request.");
    const payload = JSON.parse(String(event && event.postData && event.postData.contents || "{}"));
    const waiver = extractCompletedDocuSignWaiver_(payload);
    if (!waiver) return jsonOutput_({ ok: true, stored: false, reason: "Event was not a completed waiver." });
    const expectedTemplateId = String(PropertiesService.getScriptProperties().getProperty(REGISTRATION_CONFIG_.docusignTemplateIdProperty) || "").trim();
    if (expectedTemplateId && waiver.templateId && waiver.templateId !== expectedTemplateId) throw new Error("Unexpected DocuSign template.");

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const spreadsheet = openRegistrationSpreadsheet_();
      const sheet = requireOrCreateScrippsWaiversSheet_(spreadsheet);
      const headers = getHeaders_(sheet);
      const envelopeColumn = headers.indexOf("Envelope ID") + 1;
      const existing = sheet.getLastRow() > 1
        ? sheet.getRange(2, envelopeColumn, sheet.getLastRow() - 1, 1).getDisplayValues().some(function (row) { return row[0] === waiver.envelopeId; })
        : false;
      if (!existing) appendNamedRow_(sheet, {
        "Received At": new Date(),
        "Envelope ID": waiver.envelopeId,
        "Status": "completed",
        "Completed At": waiver.completedAt,
        "Participant Name": waiver.participantName,
        "Participant Email": waiver.participantEmail,
        "Participant ID": waiver.participantId,
        "Normalized Identifier": waiver.normalizedIdentifier,
        "Template ID": waiver.templateId,
        "Source": "DocuSign Connect",
      });
      SpreadsheetApp.flush();
      return jsonOutput_({ ok: true, stored: !existing, duplicate: existing });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error("DocuSign webhook rejected: " + String(error && error.message || error));
    return jsonOutput_({ ok: false, error: "Webhook rejected." });
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function constantTimeEqual_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let difference = a.length ^ b.length;
  const width = Math.max(a.length, b.length);
  for (let index = 0; index < width; index += 1) difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return difference === 0;
}

function docuSignFirstScalar_(value, keys) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = docuSignFirstScalar_(value[index], keys);
      if (found) return found;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const names = Object.keys(value);
  for (let index = 0; index < names.length; index += 1) {
    const key = names[index];
    const child = value[key];
    if (keys.indexOf(key.toLowerCase()) !== -1 && (typeof child === "string" || typeof child === "number")) {
      const text = String(child).trim();
      if (text) return text;
    }
  }
  for (let index = 0; index < names.length; index += 1) {
    const found = docuSignFirstScalar_(value[names[index]], keys);
    if (found) return found;
  }
  return "";
}

function docuSignLabel_(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "");
}

function docuSignFieldValues_(value, output) {
  const values = output || {};
  if (Array.isArray(value)) {
    value.forEach(function (item) { docuSignFieldValues_(item, values); });
    return values;
  }
  if (!value || typeof value !== "object") return values;
  const fieldLabel = docuSignLabel_(value.tabLabel || value.fieldName || value.name || value.apiName || value.originalValue);
  const raw = value.value != null ? value.value : (value.text != null ? value.text : (value.selected != null ? value.selected : value.formattedValue));
  if (fieldLabel && (typeof raw === "string" || typeof raw === "number")) {
    const text = String(raw).trim();
    if (text && !values[fieldLabel]) values[fieldLabel] = text;
  }
  Object.keys(value).forEach(function (key) { docuSignFieldValues_(value[key], values); });
  return values;
}

function docuSignValueFor_(values, labels) {
  for (let index = 0; index < labels.length; index += 1) {
    const value = values[docuSignLabel_(labels[index])];
    if (value) return value;
  }
  return "";
}

function normalizeWaiverIdentifier_(value) {
  const normalized = String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^A\d{8}$/.test(normalized)) return normalized.slice(1);
  if (/^0+\d+$/.test(normalized)) return normalized.replace(/^0+(?=\d)/, "");
  return normalized;
}

function extractCompletedDocuSignWaiver_(payload) {
  const eventName = docuSignFirstScalar_(payload, ["event", "eventtype", "event_type"]).toLowerCase();
  const status = docuSignFirstScalar_(payload, ["status", "envelopestatus"]).toLowerCase();
  if (eventName.indexOf("completed") === -1 && status !== "completed") return null;
  const envelopeId = docuSignFirstScalar_(payload, ["envelopeid", "envelope_id"]);
  if (!envelopeId) throw new Error("Completed event is missing an envelope ID.");
  const values = docuSignFieldValues_(payload);
  const participantName = docuSignValueFor_(values, ["participantname", "participant_name", "fullname", "name"])
    || docuSignFirstScalar_(payload, ["recipientname", "fullname"]);
  const participantEmail = docuSignValueFor_(values, ["participantemail", "participant_email", "email"])
    || docuSignFirstScalar_(payload, ["recipientemail", "email"]);
  if (!participantName || !participantEmail) throw new Error("Completed event is missing participant name or email.");
  const participantId = docuSignValueFor_(values, ["ucsdid", "ucsd_id", "ucsandiegoid", "a_number", "anumber"]);
  return {
    envelopeId: envelopeId,
    templateId: docuSignFirstScalar_(payload, ["templateid", "template_id"]),
    completedAt: docuSignValueFor_(values, ["datesigned", "date_signed", "completeddatetime", "completed_at"])
      || docuSignFirstScalar_(payload, ["completeddatetime", "completed_at", "datesigned", "sentdatetime"])
      || new Date().toISOString(),
    participantName: participantName,
    participantEmail: participantEmail.trim().toLowerCase(),
    participantId: participantId,
    normalizedIdentifier: normalizeWaiverIdentifier_(participantId),
  };
}

function requireOrCreateScrippsWaiversSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(REGISTRATION_CONFIG_.scrippsWaiversSheet);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(REGISTRATION_CONFIG_.scrippsWaiversSheet);
    sheet.appendRow(["Received At", "Envelope ID", "Status", "Completed At", "Participant Name", "Participant Email", "Participant ID", "Normalized Identifier", "Template ID", "Source"]);
    sheet.setFrozenRows(1);
  }
  assertHeaders_(sheet, ["Received At", "Envelope ID", "Status", "Completed At", "Participant Name", "Participant Email", "Participant ID", "Normalized Identifier", "Template ID", "Source"]);
  return sheet;
}

function setupRegistrationSheet() {
  const spreadsheet = openRegistrationSpreadsheet_();
  const people = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.peopleSheet);
  const identifiers = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.identifiersSheet);
  const registrations = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.registrationsSheet);
  assertHeaders_(people, ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"]);
  assertHeaders_(identifiers, ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"]);
  assertHeaders_(registrations, ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"]);
  return { ok: true, spreadsheetId: spreadsheet.getId(), spreadsheetName: spreadsheet.getName(), peopleSheet: people.getName(), identifiersSheet: identifiers.getName(), registrationsSheet: registrations.getName() };
}

function registrationStatus() {
  const result = setupRegistrationSheet();
  result.configured = true;
  result.waiverConfigured = Boolean(PropertiesService.getScriptProperties().getProperty(REGISTRATION_CONFIG_.waiverUrlProperty));
  return result;
}

function submitRegistration(payload) {
  const validated = validateRegistration_(payload, Date.now());
  if (!validated.ok) return validated;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const value = validated.value;
    const spreadsheet = openRegistrationSpreadsheet_();
    const people = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.peopleSheet);
    const identifiers = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.identifiersSheet);
    const registrations = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.registrationsSheet);
    const identifierHeaders = getHeaders_(identifiers);
    const identifierRows = identifiers.getLastRow() > 1 ? identifiers.getRange(2, 1, identifiers.getLastRow() - 1, identifierHeaders.length).getDisplayValues() : [];
    const typeLabel = identifierTypeLabel_(value.identifierType);
    const normalizedIdentifier = canonicalIdentifier_(value.identifier, value.identifierType);
    const normalizedEmail = value.primaryEmail.toLowerCase();
    const typeIndex = identifierHeaders.indexOf("Type");
    const normalizedIndex = identifierHeaders.indexOf("Normalized Value");
    const activeIndex = identifierHeaders.indexOf("Active");
    const duplicate = identifierRows.some(function (row) {
      const active = String(row[activeIndex]).toUpperCase();
      if (active === "FALSE" || active === "NO" || active === "0") return false;
      const rowType = String(row[typeIndex]);
      const rowValue = String(row[normalizedIndex]).trim();
      if (rowType === "Email") return rowValue.toLowerCase() === normalizedEmail;
      return rowType === typeLabel && canonicalIdentifier_(rowValue, value.identifierType) === normalizedIdentifier;
    });
    if (duplicate) return { ok: false, message: "An account already exists for that ID or email. Return to the kiosk and choose I already registered." };

    const now = new Date();
    const personId = newId_("person");
    const source = "Online registration";
    appendNamedRow_(people, { "Person ID": personId, "Status": "Active", "Display Name": value.name, "Role": value.role, "Primary Email": value.primaryEmail, "Secondary Emails": value.secondaryEmail || "", "Created At": now, "Updated At": now, "Source System": source, "Source Rows": "" });
    appendIdentifierRow_(identifiers, { "Identifier ID": newId_("identifier"), "Person ID": personId, "Type": typeLabel, "Value": value.identifier, "Normalized Value": normalizedIdentifier, "Primary": true, "Verified": false, "Active": true, "Created At": now, "Source System": source, "Source Rows": "" });
    appendIdentifierRow_(identifiers, { "Identifier ID": newId_("identifier"), "Person ID": personId, "Type": "Email", "Value": value.primaryEmail, "Normalized Value": normalizedEmail, "Primary": true, "Verified": false, "Active": true, "Created At": now, "Source System": source, "Source Rows": "" });
    appendNamedRow_(registrations, { "Registration ID": newId_("registration"), "Person ID": personId, "Status": "Unreviewed", "Submitted At": now, "Reviewed By": "", "Reviewed At": "", "Program / Department": value.affiliation, "Identifier Type": value.identifierType, "DocuSign Status": "Awaiting verification", "Consent Version": REGISTRATION_CONFIG_.consentVersion, "Anticipated Graduation": value.anticipatedGraduation || "", "Source": source });
    SpreadsheetApp.flush();
    return { ok: true, displayName: value.firstName, waiverUrl: getRequiredScriptProperty_(REGISTRATION_CONFIG_.waiverUrlProperty) };
  } finally {
    lock.releaseLock();
  }
}

function openRegistrationSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredScriptProperty_(REGISTRATION_CONFIG_.spreadsheetProperty));
}

function requireSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Registration sheet is missing: " + name);
  return sheet;
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
}

function assertHeaders_(sheet, expected) {
  const headers = getHeaders_(sheet);
  expected.forEach(function (header) {
    if (headers.indexOf(header) === -1) throw new Error(sheet.getName() + " is missing the " + header + " column.");
  });
}

function appendNamedRow_(sheet, valuesByHeader) {
  const headers = getHeaders_(sheet);
  const row = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : ""; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function appendIdentifierRow_(sheet, valuesByHeader) {
  const headers = getHeaders_(sheet);
  const nextRow = sheet.getLastRow() + 1;
  const valueColumn = headers.indexOf("Value") + 1;
  const normalizedColumn = headers.indexOf("Normalized Value") + 1;
  if (valueColumn > 0) sheet.getRange(nextRow, valueColumn).setNumberFormat("@");
  if (normalizedColumn > 0) sheet.getRange(nextRow, normalizedColumn).setNumberFormat("@");
  const row = headers.map(function (header) { return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : ""; });
  sheet.getRange(nextRow, 1, 1, headers.length).setValues([row]);
}

function identifierTypeLabel_(type) {
  if (type === "Student PID") return "PID";
  if (type === "Triton Student Number (TSN)") return "TSN";
  if (type === "Employee ID") return "Employee ID";
  return "Other UCSD ID";
}

function canonicalIdentifier_(identifier, type) {
  const cleaned = String(identifier || "").trim().toUpperCase().replace(/[\s-]+/g, "");
  if (type === "Employee ID" && /^\d+$/.test(cleaned)) return cleaned.replace(/^0+(?=\d)/, "");
  return cleaned;
}

function newId_(prefix) {
  return prefix + "_" + Utilities.getUuid().replace(/-/g, "");
}

function getRequiredScriptProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Registration deployment is not configured.");
  return value;
}
