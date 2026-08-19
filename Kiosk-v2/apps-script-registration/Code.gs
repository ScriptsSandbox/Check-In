const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  docusignConnectTokenProperty: "DOCUSIGN_CONNECT_TOKEN",
  docusignTemplateIdProperty: "DOCUSIGN_WAIVER_TEMPLATE_ID",
  fabmanApiKeyProperty: "FABMAN_API_KEY",
  fabmanAccountId: 1046,
  fabmanSpaceId: 2628,
  fabmanPackageId: 9464,
  peopleSheet: "People",
  identifiersSheet: "Identifiers",
  registrationsSheet: "Registrations",
  fabmanLinksSheet: "FabMan Links",
  fabmanProvisioningSheet: "FabMan Provisioning",
  scrippsWaiversSheet: "Scripps Waivers",
  consentVersion: "2026-08-11",
};

const FABMAN_LINK_HEADERS_ = ["Link ID", "Person ID", "FabMan Member ID", "Status", "Match Method", "Confirmed By", "Confirmed At", "Notes"];
const FABMAN_PROVISIONING_HEADERS_ = ["Provisioning ID", "Person ID", "First Name", "Last Name", "Status", "Attempt Count", "Last Attempt At", "Next Attempt At", "FabMan Member ID", "Last Error", "Created At", "Updated At"];

function doGet(event) {
  const template = HtmlService.createTemplateFromFile("Index");
  const isKiosk = Boolean(event && event.parameter && event.parameter.mode === "kiosk");
  template.isKiosk = isKiosk;
  const output = template.evaluate()
    .setTitle("Create a Scripps Sandbox account")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
  if (isKiosk) output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
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
  const fabmanLinks = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanLinksSheet, FABMAN_LINK_HEADERS_);
  const fabmanProvisioning = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanProvisioningSheet, FABMAN_PROVISIONING_HEADERS_);
  assertHeaders_(people, ["Person ID", "Status", "Display Name", "Role", "Primary Email", "Secondary Emails", "Created At", "Updated At", "Source System", "Source Rows"]);
  assertHeaders_(identifiers, ["Identifier ID", "Person ID", "Type", "Value", "Normalized Value", "Primary", "Verified", "Active", "Created At", "Source System", "Source Rows"]);
  assertHeaders_(registrations, ["Registration ID", "Person ID", "Status", "Submitted At", "Reviewed By", "Reviewed At", "Program / Department", "Identifier Type", "DocuSign Status", "Consent Version", "Anticipated Graduation", "Source"]);
  assertHeaders_(fabmanLinks, FABMAN_LINK_HEADERS_);
  assertHeaders_(fabmanProvisioning, FABMAN_PROVISIONING_HEADERS_);
  return { ok: true, spreadsheetId: spreadsheet.getId(), spreadsheetName: spreadsheet.getName(), peopleSheet: people.getName(), identifiersSheet: identifiers.getName(), registrationsSheet: registrations.getName(), fabmanConfigured: Boolean(PropertiesService.getScriptProperties().getProperty(REGISTRATION_CONFIG_.fabmanApiKeyProperty)) };
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
  let created = null;
  try {
    const value = validated.value;
    const spreadsheet = openRegistrationSpreadsheet_();
    const people = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.peopleSheet);
    const identifiers = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.identifiersSheet);
    const registrations = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.registrationsSheet);
    const fabmanProvisioning = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanProvisioningSheet, FABMAN_PROVISIONING_HEADERS_);
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
    appendNamedRow_(registrations, { "Registration ID": newId_("registration"), "Person ID": personId, "Status": "Submitted", "Submitted At": now, "Reviewed By": "", "Reviewed At": "", "Program / Department": value.affiliation, "Identifier Type": value.identifierType, "DocuSign Status": "Awaiting verification", "Consent Version": REGISTRATION_CONFIG_.consentVersion, "Anticipated Graduation": value.anticipatedGraduation || "", "Source": source });
    appendNamedRow_(fabmanProvisioning, { "Provisioning ID": newId_("fabman"), "Person ID": personId, "First Name": value.firstName, "Last Name": value.lastName, "Status": "Pending", "Attempt Count": 0, "Last Attempt At": "", "Next Attempt At": now, "FabMan Member ID": "", "Last Error": "", "Created At": now, "Updated At": now });
    SpreadsheetApp.flush();
    created = { personId: personId, displayName: value.firstName, waiverUrl: getRequiredScriptProperty_(REGISTRATION_CONFIG_.waiverUrlProperty) };
  } finally {
    lock.releaseLock();
  }
  let fabman = { ok: false, status: "Pending" };
  try {
    fabman = registrationProvisionFabman_(created.personId);
  } catch (error) {
    console.error("FabMan provisioning failed after registration: " + safeFabmanError_(error));
  }
  return { ok: true, displayName: created.displayName, waiverUrl: created.waiverUrl, fabmanStatus: fabman.status || (fabman.ok ? "Complete" : "Pending") };
}

function setupFabmanProvisioning() {
  setupRegistrationSheet();
  getRequiredScriptProperty_(REGISTRATION_CONFIG_.fabmanApiKeyProperty);
  const handler = "retryFabmanProvisioning";
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (!exists) ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  const retry = retryFabmanProvisioning();
  return { ok: true, triggerCreated: !exists, retry: retry };
}

function retryFabmanProvisioning() {
  const spreadsheet = openRegistrationSpreadsheet_();
  const sheet = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanProvisioningSheet, FABMAN_PROVISIONING_HEADERS_);
  const now = new Date();
  const due = registrationRecords_(sheet).filter(function (row) {
    const status = String(row.Status || "").toLowerCase();
    if (["pending", "retry"].indexOf(status) === -1) return false;
    const next = row["Next Attempt At"] ? new Date(row["Next Attempt At"]) : new Date(0);
    return isNaN(next.getTime()) || next.getTime() <= now.getTime();
  }).slice(0, 8);
  const results = due.map(function (row) {
    return registrationProvisionFabman_(String(row["Person ID"] || ""));
  });
  return { ok: true, attempted: results.length, completed: results.filter(function (result) { return result.ok; }).length };
}

function registrationProvisionFabman_(personId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let provisioningRow = 0;
  let attempt = 0;
  try {
    const spreadsheet = openRegistrationSpreadsheet_();
    const people = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.peopleSheet);
    const identifiers = requireSheet_(spreadsheet, REGISTRATION_CONFIG_.identifiersSheet);
    const links = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanLinksSheet, FABMAN_LINK_HEADERS_);
    const provisioning = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanProvisioningSheet, FABMAN_PROVISIONING_HEADERS_);
    const person = registrationRecords_(people).find(function (row) {
      return String(row["Person ID"]) === String(personId) && String(row.Status || "").toLowerCase() === "active";
    });
    if (!person) throw new Error("The active Sandbox account could not be found.");
    const request = registrationRecords_(provisioning).filter(function (row) {
      return String(row["Person ID"]) === String(personId);
    }).pop();
    if (!request) throw new Error("The FabMan provisioning request could not be found.");
    provisioningRow = Number(request.__row);
    attempt = Number(request["Attempt Count"] || 0) + 1;

    const existingLink = registrationRecords_(links).find(function (row) {
      return String(row["Person ID"]) === String(personId) && String(row.Status || "").toLowerCase() === "active";
    });
    if (existingLink) {
      registrationUpdateProvisioning_(provisioning, provisioningRow, { Status: "Complete", "Attempt Count": attempt, "Last Attempt At": new Date(), "Next Attempt At": "", "FabMan Member ID": existingLink["FabMan Member ID"], "Last Error": "", "Updated At": new Date() });
      SpreadsheetApp.flush();
      return { ok: true, status: "Complete", memberId: Number(existingLink["FabMan Member ID"]) };
    }

    registrationUpdateProvisioning_(provisioning, provisioningRow, { Status: "Processing", "Attempt Count": attempt, "Last Attempt At": new Date(), "Next Attempt At": "", "Last Error": "", "Updated At": new Date() });
    SpreadsheetApp.flush();

    const personIdentifiers = registrationRecords_(identifiers).filter(function (row) {
      return String(row["Person ID"]) === String(personId) && registrationTrue_(row.Active);
    });
    const primaryIdentifier = personIdentifiers.find(function (row) {
      return String(row.Type) !== "Email" && registrationTrue_(row.Primary);
    }) || personIdentifiers.find(function (row) { return String(row.Type) !== "Email"; });
    if (!primaryIdentifier) throw new Error("The UC San Diego identifier could not be found.");
    const profile = {
      personId: String(personId),
      firstName: cleanText_(request["First Name"] || String(person["Display Name"] || "").split(/\s+/)[0], 80),
      lastName: cleanText_(request["Last Name"] || String(person["Display Name"] || "").split(/\s+/).slice(1).join(" "), 80),
      email: normalizeEmail_(person["Primary Email"]),
      identifierType: cleanText_(primaryIdentifier.Type, 40),
      identifier: cleanText_(primaryIdentifier["Normalized Value"] || primaryIdentifier.Value, 120),
    };
    if (!profile.firstName || !profile.lastName || !profile.email || !profile.identifier) throw new Error("The Sandbox account is missing information required by FabMan.");

    const candidate = registrationFindFabmanMember_(profile);
    let memberId = candidate ? Number(candidate.member.id) : 0;
    let matchMethod = candidate ? candidate.method : "Automatic registration: new FabMan member";
    if (!memberId) {
      const created = registrationFabmanFetch_("members", "post", {
        account: REGISTRATION_CONFIG_.fabmanAccountId,
        space: REGISTRATION_CONFIG_.fabmanSpaceId,
        memberNumber: profile.identifier,
        firstName: profile.firstName,
        lastName: profile.lastName,
        emailAddress: profile.email,
        state: "active",
        notes: "Created automatically by Scripps Sandbox account registration.",
        metadata: {
          scrippsSandboxPersonId: profile.personId,
          scrippsSandboxIdentifierType: profile.identifierType,
          source: "Scripps Sandbox registration",
        },
      });
      if (!created.ok || !created.data || !Number(created.data.id)) throw new Error("FabMan member creation failed: " + created.error);
      memberId = Number(created.data.id);
    }

    const duplicateLink = registrationRecords_(links).find(function (row) {
      return Number(row["FabMan Member ID"]) === memberId && String(row.Status || "").toLowerCase() === "active" && String(row["Person ID"]) !== String(personId);
    });
    if (duplicateLink) throw new Error("The matching FabMan member is already linked to another Sandbox account.");
    registrationEnsureFabmanPackage_(memberId);
    appendNamedRow_(links, { "Link ID": newId_("fmlink"), "Person ID": personId, "FabMan Member ID": memberId, "Status": "Active", "Match Method": matchMethod, "Confirmed By": "Automatic registration", "Confirmed At": new Date(), "Notes": "Created or matched automatically and assigned Scripps Sandbox package " + REGISTRATION_CONFIG_.fabmanPackageId + "." });
    registrationUpdateProvisioning_(provisioning, provisioningRow, { Status: "Complete", "Attempt Count": attempt, "Last Attempt At": new Date(), "Next Attempt At": "", "FabMan Member ID": memberId, "Last Error": "", "Updated At": new Date() });
    SpreadsheetApp.flush();
    return { ok: true, status: "Complete", memberId: memberId };
  } catch (error) {
    const message = safeFabmanError_(error);
    try {
      if (provisioningRow) {
        const spreadsheet = openRegistrationSpreadsheet_();
        const provisioning = requireOrCreateSheet_(spreadsheet, REGISTRATION_CONFIG_.fabmanProvisioningSheet, FABMAN_PROVISIONING_HEADERS_);
        const delayMinutes = Math.min(360, 5 * Math.pow(2, Math.max(0, attempt - 1)));
        registrationUpdateProvisioning_(provisioning, provisioningRow, { Status: "Retry", "Attempt Count": attempt, "Last Attempt At": new Date(), "Next Attempt At": new Date(Date.now() + delayMinutes * 60000), "Last Error": message, "Updated At": new Date() });
        SpreadsheetApp.flush();
      }
    } catch (updateError) {
      console.error("Could not update FabMan provisioning status: " + safeFabmanError_(updateError));
    }
    console.error("FabMan provisioning retry scheduled for " + personId + ": " + message);
    return { ok: false, status: "Retry", error: message };
  } finally {
    lock.releaseLock();
  }
}

function registrationFindFabmanMember_(profile) {
  const candidatesById = {};
  const queries = [
    "members?account=" + REGISTRATION_CONFIG_.fabmanAccountId + "&metadataKey=scrippsSandboxPersonId&metadataValue=" + encodeURIComponent(profile.personId) + "&limit=20",
    "members?account=" + REGISTRATION_CONFIG_.fabmanAccountId + "&q=" + encodeURIComponent(profile.email) + "&limit=20",
    "members?account=" + REGISTRATION_CONFIG_.fabmanAccountId + "&memberNumber=" + encodeURIComponent(profile.identifier) + "&limit=20",
  ];
  queries.forEach(function (path) {
    const response = registrationFabmanFetch_(path);
    if (!response.ok) throw new Error("FabMan duplicate check failed: " + response.error);
    registrationFabmanArray_(response.data).forEach(function (member) {
      if (member && Number(member.id)) candidatesById[Number(member.id)] = member;
    });
  });
  const profileName = registrationComparable_(profile.firstName + " " + profile.lastName);
  const matches = Object.keys(candidatesById).map(function (id) {
    const member = candidatesById[id];
    const metadata = member.metadata || {};
    const exactPerson = String(metadata.scrippsSandboxPersonId || "") === profile.personId;
    const exactEmail = normalizeEmail_(member.emailAddress || member.email) === profile.email;
    const exactIdentifier = registrationComparable_(member.memberNumber) === registrationComparable_(profile.identifier);
    const exactName = registrationComparable_([member.firstName, member.lastName].filter(Boolean).join(" ")) === profileName;
    if (exactPerson) return { member: member, method: "Automatic registration: Sandbox person ID" };
    if (exactEmail) return { member: member, method: "Automatic registration: exact email" };
    if (exactIdentifier && exactName) return { member: member, method: "Automatic registration: exact UCSD ID and name" };
    return null;
  }).filter(Boolean);
  const uniqueIds = {};
  matches.forEach(function (match) { uniqueIds[Number(match.member.id)] = match; });
  const unique = Object.keys(uniqueIds).map(function (id) { return uniqueIds[id]; });
  if (unique.length > 1) throw new Error("Multiple FabMan members match this Sandbox account; automatic linking stopped.");
  return unique[0] || null;
}

function registrationEnsureFabmanPackage_(memberId) {
  const before = registrationFabmanFetch_("members/" + encodeURIComponent(memberId) + "/packages");
  if (!before.ok) throw new Error("FabMan package check failed: " + before.error);
  const packageActive = registrationFabmanArray_(before.data).some(function (item) {
    const packageId = Number(item && item.package && item.package.id ? item.package.id : (item && (item.package || item.id)));
    const state = String(item && (item.state || item.status) || "active").toLowerCase();
    return packageId === REGISTRATION_CONFIG_.fabmanPackageId && ["expired", "cancelled", "archived"].indexOf(state) === -1;
  });
  if (packageActive) return;
  const added = registrationFabmanFetch_("members/" + encodeURIComponent(memberId) + "/packages", "post", [{ package: REGISTRATION_CONFIG_.fabmanPackageId, fromDate: Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd") }]);
  if (!added.ok) throw new Error("The Scripps Sandbox package was not added: " + added.error);
}

function registrationFabmanFetch_(path, method, payload) {
  const token = getRequiredScriptProperty_(REGISTRATION_CONFIG_.fabmanApiKeyProperty);
  const options = { method: method || "get", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, muteHttpExceptions: true };
  if (payload !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch("https://fabman.io/api/v1/" + path, options);
  const status = response.getResponseCode();
  const body = response.getContentText();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch (error) {}
  const message = data && (data.message || data.error || data.title);
  return { ok: status >= 200 && status < 300, status: status, data: data, error: status >= 200 && status < 300 ? "" : cleanText_(message || ("FabMan returned HTTP " + status), 180) };
}

function registrationFabmanArray_(data) {
  return Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
}

function registrationComparable_(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function registrationTrue_(value) {
  return ["true", "yes", "1"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

function registrationRecords_(sheet) {
  const headers = getHeaders_(sheet);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getDisplayValues();
  return values.map(function (row, index) {
    const record = { __row: index + 2 };
    headers.forEach(function (header, column) { record[header] = row[column]; });
    return record;
  });
}

function registrationUpdateProvisioning_(sheet, rowNumber, valuesByHeader) {
  const headers = getHeaders_(sheet);
  Object.keys(valuesByHeader).forEach(function (header) {
    const column = headers.indexOf(header) + 1;
    if (!column) throw new Error("FabMan Provisioning is missing the " + header + " column.");
    sheet.getRange(rowNumber, column).setValue(valuesByHeader[header]);
  });
}

function safeFabmanError_(error) {
  return cleanText_(error && error.message ? error.message : error, 240) || "Unknown FabMan error";
}

function openRegistrationSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredScriptProperty_(REGISTRATION_CONFIG_.spreadsheetProperty));
}

function requireSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Registration sheet is missing: " + name);
  return sheet;
}

function requireOrCreateSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  assertHeaders_(sheet, headers);
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
