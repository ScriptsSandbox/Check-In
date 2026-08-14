export type ProfileSnapshot = {
  role: string;
  affiliation: string;
  anticipatedGraduation: string;
};

export type ProfileField = "role" | "affiliation" | "anticipatedGraduation";

export type ProfileQuestion = {
  field: ProfileField;
  eyebrow: string;
  heading: string;
  prompt: string;
};

export const PROFILE_ROLES = [
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
] as const;

const UNDERGRADUATE_ROLES = new Set([
  "Undergraduate Student (UG)",
  "UG Student Employee",
]);

export const SCRIPPS_UNITS = [
  "IOD-Biology", "CMBB-Biology", "MBRD-Biology", "GRD-Earth", "IGPP-Earth",
  "CASPO-O&A", "MPL-O&A", "SIO/DO", "Birch Aquarium", "MarFac", "MSDC",
  "Sea Grant", "SIO Academic Department", "SOMTS",
];

export const SCRIPPS_GRADUATE_PROGRAMS = [
  "Applied Ocean Science", "Climate Sciences", "Physical Oceanography", "Geophysics",
  "Geosciences", "Marine Chemistry and Geochemistry", "Biological Oceanography",
  "Marine Biology",
];

export const UCSD_DEPARTMENTS = [
  "Mechanical & Aerospace Engineering", "Electrical & Computer Engineering",
  "Computer Science & Engineering", "Bioengineering", "Chemical & NanoEngineering",
  "Structural Engineering", "Biological Sciences", "Chemistry & Biochemistry", "Physics",
  "Mathematics", "Data Science", "Cognitive Science", "Environmental Systems",
  "Public Health", "School of Medicine or Health Sciences", "Rady School of Management",
  "School of Global Policy & Strategy", "Social Sciences", "Arts & Humanities",
  "Central administration or campus services",
];

export const UNDERGRADUATE_MAJORS = [
  "Marine Biology", "Geosciences", "Oceanic and Atmospheric Sciences",
  "Mechanical Engineering", "Aerospace Engineering", "Electrical Engineering",
  "Computer Engineering", "Computer Science", "Bioengineering", "Chemical Engineering",
  "NanoEngineering", "Structural Engineering", "General Biology",
  "Ecology, Behavior and Evolution", "Molecular and Cell Biology", "Microbiology",
  "Human Biology", "Neurobiology", "Environmental Systems", "Chemistry or Biochemistry",
  "Physics", "Mathematics", "Data Science", "Cognitive Science", "Public Health",
  "Social Sciences", "Arts & Humanities", "Business or Economics", "Undeclared",
];

export const VISITOR_ORGANIZATIONS = [
  "Scripps Oceanography", "UC San Diego – other department or unit",
  "External university or institution", "Government laboratory or agency",
  "Nonprofit organization", "Industry or company",
  "Community member – no institutional affiliation",
];

export function emptyProfile(): ProfileSnapshot {
  return { role: "", affiliation: "", anticipatedGraduation: "" };
}

export function nextProfileQuestion(profile: ProfileSnapshot): ProfileQuestion | null {
  if (!profile.role.trim()) {
    return profileQuestionForField("role", profile.role);
  }
  if (!profile.affiliation.trim()) {
    return profileQuestionForField("affiliation", profile.role);
  }
  if (UNDERGRADUATE_ROLES.has(profile.role) && !profile.anticipatedGraduation.trim()) {
    return profileQuestionForField("anticipatedGraduation", profile.role);
  }
  return null;
}

export function profileQuestionForField(field: ProfileField, role: string): ProfileQuestion {
  if (field === "role") {
    return {
      field,
      eyebrow: "COMPLETE YOUR PROFILE",
      heading: "What best describes you?",
      prompt: "Choose your role. You can go back and change it before finishing.",
    };
  }
  if (field === "affiliation") {
    const student = role.includes("Student");
    return {
      field,
      eyebrow: "ONE MORE QUESTION",
      heading: student ? "What do you study?" : "Where do you work?",
      prompt: affiliationLabel(role),
    };
  }
  return {
    field,
    eyebrow: "LAST QUESTION",
    heading: "When do you expect to graduate?",
    prompt: "Choose your anticipated graduation month and year.",
  };
}

export function affiliationLabel(role: string): string {
  if (UNDERGRADUATE_ROLES.has(role)) return "Choose your major.";
  if (role === "Graduate Student MS, PhD") return "Choose your graduate program or department.";
  if (role === "MAS Student") return "Choose your MAS program.";
  if (["Academic", "Staff", "Postdoc"].includes(role)) return "Choose your department, division, or unit.";
  return "Choose your organization or affiliation.";
}

export function affiliationOptions(role: string): string[] {
  if (UNDERGRADUATE_ROLES.has(role)) return [...UNDERGRADUATE_MAJORS, "Other"];
  if (role === "Graduate Student MS, PhD") {
    return [...SCRIPPS_GRADUATE_PROGRAMS, ...UCSD_DEPARTMENTS, "External university or institution", "Other"];
  }
  if (role === "MAS Student") return ["Marine Biodiversity & Conservation", "Climate Science & Policy", "Other"];
  if (["Academic", "Staff", "Postdoc"].includes(role)) return [...SCRIPPS_UNITS, ...UCSD_DEPARTMENTS, "Other"];
  return [...VISITOR_ORGANIZATIONS, "Other"];
}

export function normalizedProfileAnswer(field: ProfileField, value: string): string {
  const cleaned = [...value]
    .map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 120) return "";
  if (field === "anticipatedGraduation" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cleaned)) return "";
  return cleaned;
}
