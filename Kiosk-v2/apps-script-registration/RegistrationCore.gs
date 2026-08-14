const REGISTRATION_ALLOWED_ROLES_ = [
  "Academic",
  "Staff",
  "Postdoc",
  "Graduate Student MS, PhD",
  "MAS Student",
  "Undergraduate Student (UG)",
  "Affiliate (Retirees, Volunteers, etc.)",
  "Visiting scholar or visitor",
  "Community member",
  "Other",
];

const REGISTRATION_STUDENT_ROLES_ = [
  "Graduate Student MS, PhD",
  "MAS Student",
  "Undergraduate Student (UG)",
];

const REGISTRATION_ALLOWED_ID_TYPES_ = [
  "Student PID",
  "Triton Student Number (TSN)",
  "Employee ID",
  "Other UC San Diego ID",
];

const REGISTRATION_ALLOWED_AFFILIATIONS_ = [
  // SIO organizational units (faculty, staff, and postdocs)
  "IOD-Biology",
  "CMBB-Biology",
  "MBRD-Biology",
  "GRD-Earth",
  "IGPP-Earth",
  "CASPO-O&A",
  "MPL-O&A",
  "SIO/DO",
  "Birch Aquarium",
  "MarFac",
  "MSDC",
  "Sea Grant",
  "SIO Academic Department",
  "SOMTS",

  // Scripps graduate curricular groups and MAS programs
  "Applied Ocean Science",
  "Climate Sciences",
  "Physical Oceanography",
  "Geophysics",
  "Geosciences",
  "Marine Chemistry and Geochemistry",
  "Biological Oceanography",
  "Marine Biology",
  "Oceanic and Atmospheric Sciences",
  "Marine Biodiversity & Conservation",
  "Climate Science & Policy",

  // UC San Diego majors, departments, and programs
  "Mechanical & Aerospace Engineering",
  "Mechanical Engineering",
  "Aerospace Engineering",
  "Electrical & Computer Engineering",
  "Electrical Engineering",
  "Computer Engineering",
  "Computer Science & Engineering",
  "Computer Science",
  "Bioengineering",
  "Chemical & NanoEngineering",
  "Chemical Engineering",
  "NanoEngineering",
  "Structural Engineering",
  "Biological Sciences",
  "General Biology",
  "Ecology, Behavior and Evolution",
  "Molecular and Cell Biology",
  "Microbiology",
  "Human Biology",
  "Neurobiology",
  "Environmental Systems",
  "Chemistry & Biochemistry",
  "Chemistry or Biochemistry",
  "Physics",
  "Mathematics",
  "Data Science",
  "Cognitive Science",
  "Public Health",
  "School of Medicine or Health Sciences",
  "Rady School of Management",
  "School of Global Policy & Strategy",
  "Social Sciences",
  "Arts & Humanities",
  "Business or Economics",
  "Central administration or campus services",
  "Other UCSD department or program",
  "Undeclared",

  // Visitors and external/community members
  "Scripps Oceanography",
  "UC San Diego – other department or unit",
  "External university or institution",
  "San Diego State University",
  "University of San Diego",
  "CSU San Marcos",
  "Government laboratory or agency",
  "Nonprofit organization",
  "Industry or company",
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
  if (identifierType === "Triton Student Number (TSN)") {
    return /^\d{9}$/.test(normalized) ? normalized : "";
  }
  if (identifierType === "Employee ID") {
    return /^\d{6,12}$/.test(normalized) ? normalized : "";
  }
  return /^[A-Z0-9]{4,20}$/.test(normalized) ? normalized : "";
}

function canonicalAffiliation_(value, otherValue) {
  const affiliation = cleanText_(value, 120);
  if (REGISTRATION_ALLOWED_AFFILIATIONS_.indexOf(affiliation) === -1) return "";
  const needsDetail = [
    "External university or institution",
    "Government laboratory or agency",
    "Nonprofit organization",
    "Industry or company",
    "Other",
  ].indexOf(affiliation) !== -1;
  if (!needsDetail) return affiliation;
  const other = cleanText_(otherValue, 120);
  return other ? affiliation + " – " + other : "";
}

function canonicalRole_(value, otherValue) {
  const role = cleanText_(value, 80);
  if (REGISTRATION_ALLOWED_ROLES_.indexOf(role) === -1) return "";
  if (role !== "Other") return role;
  const other = cleanText_(otherValue, 80);
  return other ? "Other – " + other : "";
}

function isStudentRole_(role) {
  return REGISTRATION_STUDENT_ROLES_.indexOf(role) !== -1;
}

function normalizeAnticipatedGraduation_(value) {
  const graduation = cleanText_(value, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(graduation) ? graduation : "";
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
  const selectedRole = cleanText_(input.role, 80);
  const role = canonicalRole_(selectedRole, input.otherRole);
  const identifierType = cleanText_(input.identifierType, 40);
  const identifier = normalizeIdentifier_(input.identifier, identifierType);
  const primaryEmail = normalizeEmail_(input.primaryEmail);
  const secondaryEmail = normalizeEmail_(input.secondaryEmail);
  const affiliation = canonicalAffiliation_(input.affiliation, input.otherAffiliation);
  const anticipatedGraduation = normalizeAnticipatedGraduation_(input.anticipatedGraduation);
  const startedAt = Number(input.formStartedAt);

  if (cleanText_(input.website, 200)) return { ok: false, message: "Registration could not be submitted." };
  if (!Number.isFinite(startedAt) || nowMs - startedAt < 2000 || nowMs - startedAt > 86400000) {
    return { ok: false, message: "Please reload the form and try again." };
  }
  if (!firstName || !lastName) return { ok: false, message: "Enter your first and last name." };
  if (!role) return { ok: false, message: "Choose your role and specify it if you selected Other." };
  if (!affiliation) return { ok: false, message: "Choose the requested major, program, department, or organization and specify it if you selected Other." };
  if (isStudentRole_(selectedRole) && !anticipatedGraduation) {
    return { ok: false, message: "Enter your anticipated graduation month and year." };
  }
  if (REGISTRATION_ALLOWED_ID_TYPES_.indexOf(identifierType) === -1 || !identifier) {
    return { ok: false, message: "Enter a valid PID, TSN, or employee ID." };
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
      anticipatedGraduation: isStudentRole_(selectedRole) ? anticipatedGraduation : "",
    },
  };
}
