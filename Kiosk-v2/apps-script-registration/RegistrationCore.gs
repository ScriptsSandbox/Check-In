const REGISTRATION_ALLOWED_ROLES_ = [
  "Undergraduate student",
  "Graduate student",
  "Postdoctoral scholar",
  "Faculty",
  "Staff",
  "Visiting scholar or visitor",
  "Community member or other",
];

const REGISTRATION_ALLOWED_ID_TYPES_ = [
  "Student PID",
  "Employee ID",
  "Other UC San Diego ID",
];

const REGISTRATION_ALLOWED_AFFILIATIONS_ = [
  "Scripps – Biological Oceanography",
  "Scripps – Climate Sciences",
  "Scripps – Geophysics",
  "Scripps – Marine Biology",
  "Scripps – Marine Chemistry and Geochemistry",
  "Scripps – Physical Oceanography",
  "Scripps staff – Director's Office",
  "Scripps staff – other program or unit",
  "UC San Diego – Mechanical and Aerospace Engineering",
  "UC San Diego – Bioengineering",
  "UC San Diego – Computer Science and Engineering",
  "UC San Diego – Electrical and Computer Engineering",
  "UC San Diego – NanoEngineering",
  "UC San Diego – Structural Engineering",
  "UC San Diego – Chemical Engineering",
  "UC San Diego – other engineering program",
  "UC San Diego – Biological Sciences",
  "UC San Diego – Physical Sciences",
  "UC San Diego – Social Sciences",
  "UC San Diego – Arts and Humanities",
  "UC San Diego – Health Sciences",
  "UC San Diego – Rady School of Management",
  "UC San Diego – School of Global Policy and Strategy",
  "UC San Diego undergraduate – undeclared",
  "UC San Diego – other academic program",
  "UC San Diego staff – central administration",
  "UC San Diego staff – academic department or unit",
  "UC San Diego staff – other unit",
  "External university or institution",
  "Community member – no institutional affiliation",
  "Other",
];

function cleanText_(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeEmail_(value) {
  return cleanText_(value, 254).toLowerCase();
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeIdentifier_(value, identifierType) {
  const normalized = cleanText_(value, 32).toUpperCase().replace(/[\s-]+/g, "");
  if (identifierType === "Student PID") {
    if (!/^A?\d{8}$/.test(normalized)) return "";
    return normalized.charAt(0) === "A" ? normalized : "A" + normalized;
  }
  if (identifierType === "Employee ID") {
    return /^\d{6,12}$/.test(normalized) ? normalized : "";
  }
  return /^[A-Z0-9]{4,20}$/.test(normalized) ? normalized : "";
}

function canonicalAffiliation_(value, otherValue) {
  const affiliation = cleanText_(value, 120);
  if (REGISTRATION_ALLOWED_AFFILIATIONS_.indexOf(affiliation) === -1) return "";
  if (affiliation !== "Other") return affiliation;
  const other = cleanText_(otherValue, 120);
  return other ? "Other – " + other : "";
}

function sheetSafe_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function validateRegistration_(payload, nowMs) {
  const input = payload || {};
  const firstName = cleanText_(input.firstName, 80);
  const lastName = cleanText_(input.lastName, 80);
  const preferredName = cleanText_(input.preferredName, 80);
  const role = cleanText_(input.role, 80);
  const identifierType = cleanText_(input.identifierType, 40);
  const identifier = normalizeIdentifier_(input.identifier, identifierType);
  const primaryEmail = normalizeEmail_(input.primaryEmail);
  const secondaryEmail = normalizeEmail_(input.secondaryEmail);
  const affiliation = canonicalAffiliation_(input.affiliation, input.otherAffiliation);
  const startedAt = Number(input.formStartedAt);

  if (cleanText_(input.website, 200)) return { ok: false, message: "Registration could not be submitted." };
  if (!Number.isFinite(startedAt) || nowMs - startedAt < 2000 || nowMs - startedAt > 86400000) {
    return { ok: false, message: "Please reload the form and try again." };
  }
  if (!firstName || !lastName) return { ok: false, message: "Enter your first and last name." };
  if (REGISTRATION_ALLOWED_ROLES_.indexOf(role) === -1) return { ok: false, message: "Choose your role." };
  if (!affiliation) return { ok: false, message: "Choose your program, department, or organization." };
  if (REGISTRATION_ALLOWED_ID_TYPES_.indexOf(identifierType) === -1 || !identifier) {
    return { ok: false, message: "Enter a valid PID or employee ID." };
  }
  if (!isValidEmail_(primaryEmail) || (secondaryEmail && !isValidEmail_(secondaryEmail))) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (input.consent !== true) return { ok: false, message: "Consent is required to create an account." };

  const displayFirstName = preferredName || firstName;
  return {
    ok: true,
    value: {
      name: displayFirstName + " " + lastName,
      firstName: displayFirstName,
      role: role,
      affiliation: affiliation,
      identifierType: identifierType,
      identifier: identifier,
      primaryEmail: primaryEmail,
      secondaryEmail: secondaryEmail,
    },
  };
}
