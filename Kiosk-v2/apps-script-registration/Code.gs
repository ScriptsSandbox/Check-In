const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  peopleSheet: "People",
  identifiersSheet: "Identifiers",
  registrationsSheet: "Registrations",
  consentVersion: "2026-08-11",
};

function doGet(event) {
  const template = HtmlService.createTemplateFromFile("Index");
  template.isKiosk = Boolean(event && event.parameter && event.parameter.mode === "kiosk");
  return template.evaluate().setTitle("Create a Scripps Sandbox account");
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
