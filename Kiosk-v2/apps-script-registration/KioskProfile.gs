const KIOSK_PROFILE_ROLES_ = [
  "Academic",
  "Staff",
  "Postdoc",
  "Graduate Student MS, PhD",
  "MAS Student",
  "Undergraduate Student (UG)",
  "UG Student Employee",
  "Affiliate (Retirees, Volunteers, etc.)",
  "Visiting scholar or visitor",
  "Community member",
  "Other",
];

function kioskProfileForPerson_(database, personId) {
  const person = kioskRecords_(database.people).find(function (record) {
    return record["Person ID"] === personId && String(record.Status).toLowerCase() === "active";
  });
  if (!person) return null;

  const registration = kioskRecords_(database.registrations).filter(function (record) {
    return record["Person ID"] === personId;
  }).pop();
  return {
    role: String(person.Role || "").trim(),
    affiliation: registration ? String(registration["Program / Department"] || "").trim() : "",
    anticipatedGraduation: registration ? String(registration["Anticipated Graduation"] || "").trim() : "",
  };
}

function kioskProfileColumn_(sheet, header) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const index = headers.indexOf(header);
  if (index < 0) throw new Error(sheet.getName() + " is missing the " + header + " column.");
  return index + 1;
}

function kioskProfileRow_(sheet, personId) {
  const personIdColumn = kioskProfileColumn_(sheet, "Person ID");
  if (sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, personIdColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index][0]) === personId) return index + 2;
  }
  return 0;
}

function updateKioskProfile_(request) {
  const personId = String(request.personId || "").trim();
  const field = String(request.field || "").trim();
  const value = String(request.value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!personId || ["role", "affiliation", "anticipatedGraduation"].indexOf(field) < 0 || !value || value.length > 120) {
    return { ok: false, outcome: "profile_error", message: "That profile answer is not valid." };
  }
  if (field === "role" && KIOSK_PROFILE_ROLES_.indexOf(value) < 0) {
    return { ok: false, outcome: "profile_error", message: "Choose one of the listed roles." };
  }
  if (field === "anticipatedGraduation" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return { ok: false, outcome: "profile_error", message: "Choose a valid graduation month and year." };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const database = openRegistrationDatabase_();
    const current = kioskProfileForPerson_(database, personId);
    if (!current) return { ok: false, outcome: "profile_error", message: "That active Sandbox account could not be found." };
    const currentValue = field === "role" ? current.role : field === "affiliation" ? current.affiliation : current.anticipatedGraduation;
    if (currentValue) {
      if (currentValue === value) return { ok: true, outcome: "profile_updated", personId: personId, profile: current, message: "Your profile is already up to date." };
      return { ok: false, outcome: "profile_error", message: "That profile field is already filled in. Ask Sandbox staff if it needs to change." };
    }

    if (field === "role") {
      const row = kioskProfileRow_(database.people, personId);
      database.people.getRange(row, kioskProfileColumn_(database.people, "Role")).setValue(sheetSafe_(value));
      database.people.getRange(row, kioskProfileColumn_(database.people, "Updated At")).setValue(new Date());
    } else {
      let row = kioskProfileRow_(database.registrations, personId);
      if (!row) {
        database.registrations.appendRow([
          "registration_" + Utilities.getUuid().replace(/-/g, ""), personId, "Profile enrichment", new Date(), "", "", "", "", "", REGISTRATION_CONFIG_.consentVersion, "", "Kiosk profile enrichment",
        ]);
        row = database.registrations.getLastRow();
      }
      const header = field === "affiliation" ? "Program / Department" : "Anticipated Graduation";
      database.registrations.getRange(row, kioskProfileColumn_(database.registrations, header)).setValue(sheetSafe_(value));
    }
    SpreadsheetApp.flush();
    return {
      ok: true,
      outcome: "profile_updated",
      personId: personId,
      profile: kioskProfileForPerson_(database, personId),
      message: "Profile updated.",
    };
  } finally {
    lock.releaseLock();
  }
}
