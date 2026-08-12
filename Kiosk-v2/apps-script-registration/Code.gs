const REGISTRATION_CONFIG_ = {
  spreadsheetProperty: "USER_DATABASE_SPREADSHEET_ID",
  waiverUrlProperty: "WAIVER_POWERFORM_URL",
  sheetName: "Form Responses 1",
  reviewSheetName: "Registration Review Log",
  consentVersion: "2026-08-11",
  baseHeaders: [
    "Name",
    "Timestamp",
    "Card UUID",
    "Student ID",
    "Type",
    "Email Address",
    "Secondary Email",
    "Waiver Signed?",
  ],
  reviewHeaders: [
    "Review Status",
    "Registration Source",
    "Registration Submitted At",
    "Reviewed By",
    "Reviewed At",
    "Program / Department",
    "Role",
    "Identifier Type",
    "DocuSign Status",
    "Consent Version",
  ],
};

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Create a Scripps Sandbox account");
}

function setupRegistrationSheet() {
  const sheet = openRegistrationSheet_();
  const width = Math.max(sheet.getLastColumn(), REGISTRATION_CONFIG_.baseHeaders.length);
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];

  REGISTRATION_CONFIG_.baseHeaders.forEach(function (expected, index) {
    if (headers[index] !== expected) {
      throw new Error("The user database header layout does not match the expected kiosk schema.");
    }
  });

  const reviewSheet = openRegistrationReviewSheet_(true);
  return {
    ok: true,
    spreadsheetId: sheet.getParent().getId(),
    sheetName: sheet.getName(),
    reviewSheetName: reviewSheet.getName(),
  };
}

function registrationStatus() {
  const sheet = openRegistrationSheet_();
  return {
    configured: true,
    spreadsheetId: sheet.getParent().getId(),
    spreadsheetName: sheet.getParent().getName(),
    sheetName: sheet.getName(),
    reviewSheetName: openRegistrationReviewSheet_(false).getName(),
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

  try {
    const sheet = openRegistrationSheet_();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    assertRegistrationHeaders_(headers);

    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const existing = sheet.getRange(2, 4, lastRow - 1, 3).getDisplayValues();
      const duplicate = existing.some(function (row) {
        const existingIdentifier = cleanText_(row[0], 32).toUpperCase().replace(/[\s-]+/g, "");
        const submittedIdentifier = validated.value.identifier.replace(/[\s-]+/g, "");
        const existingEmail = normalizeEmail_(row[2]);
        return existingIdentifier === submittedIdentifier || existingEmail === validated.value.primaryEmail;
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
    const valuesByHeader = {
      "Name": sheetSafe_(validated.value.name),
      "Timestamp": submittedAt,
      "Card UUID": "",
      "Student ID": sheetSafe_(validated.value.identifier),
      "Type": sheetSafe_(validated.value.role),
      "Email Address": sheetSafe_(validated.value.primaryEmail),
      "Secondary Email": sheetSafe_(validated.value.secondaryEmail),
      "Waiver Signed?": "",
      "Review Status": "Unreviewed",
      "Registration Source": "Online registration",
      "Registration Submitted At": submittedAt,
      "Reviewed By": "",
      "Reviewed At": "",
      "Program / Department": sheetSafe_(validated.value.affiliation),
      "Role": sheetSafe_(validated.value.role),
      "Identifier Type": sheetSafe_(validated.value.identifierType),
      "DocuSign Status": "Awaiting verification",
      "Consent Version": REGISTRATION_CONFIG_.consentVersion,
    };

    const row = headers.map(function (header) {
      return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : "";
    });
    const reviewSheet = openRegistrationReviewSheet_(false);
    const reviewHeaders = reviewSheet.getRange(1, 1, 1, reviewSheet.getLastColumn()).getDisplayValues()[0];
    const userDatabaseRow = sheet.getLastRow() + 1;
    const reviewRow = reviewHeaders.map(function (header) {
      if (header === "User Database Row") return userDatabaseRow;
      return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? valuesByHeader[header] : "";
    });
    sheet.appendRow(row);
    try {
      reviewSheet.appendRow(reviewRow);
    } catch (reviewError) {
      sheet.deleteRow(userDatabaseRow);
      throw reviewError;
    }

    return {
      ok: true,
      firstName: validated.value.firstName,
      waiverUrl: getRequiredScriptProperty_(REGISTRATION_CONFIG_.waiverUrlProperty),
    };
  } catch (error) {
    return {
      ok: false,
      message: "We could not create the account. No information was intentionally retained by this form. Please try again or ask Sandbox staff for help.",
    };
  } finally {
    lock.releaseLock();
  }
}

function openRegistrationSheet_() {
  const spreadsheetId = getRequiredScriptProperty_(REGISTRATION_CONFIG_.spreadsheetProperty);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(REGISTRATION_CONFIG_.sheetName);
  if (!sheet) throw new Error("Registration sheet was not found.");
  return sheet;
}

function openRegistrationReviewSheet_(createIfMissing) {
  const spreadsheetId = getRequiredScriptProperty_(REGISTRATION_CONFIG_.spreadsheetProperty);
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  let sheet = spreadsheet.getSheetByName(REGISTRATION_CONFIG_.reviewSheetName);
  const headers = ["Student ID", "User Database Row"].concat(REGISTRATION_CONFIG_.reviewHeaders);
  if (!sheet && createIfMissing) {
    sheet = spreadsheet.insertSheet(REGISTRATION_CONFIG_.reviewSheetName);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground("#d9e2f3").setFontWeight("bold").setWrap(true);
    sheet.setFrozenRows(1);
  }
  if (!sheet) throw new Error("Registration review sheet setup is incomplete.");
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  headers.forEach(function (header, index) {
    if (actual[index] !== header) throw new Error("Registration review sheet layout does not match the expected schema.");
  });
  return sheet;
}

function getRequiredScriptProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Registration deployment is not configured.");
  return value;
}

function assertRegistrationHeaders_(headers) {
  REGISTRATION_CONFIG_.baseHeaders.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      throw new Error("Registration sheet setup is incomplete.");
    }
  });
}
