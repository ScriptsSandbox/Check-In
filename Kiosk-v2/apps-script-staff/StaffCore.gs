function staffClean_(value, maxLength) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function staffTrue_(value) {
  return ["true", "1", "yes"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

const STAFF_PROFILE_ROLES_ = [
  "Academic",
  "Staff",
  "Postdoc",
  "Graduate Student (MS)",
  "Graduate Student (PhD)",
  "MAS Student",
  "Undergraduate Student (UG)",
  "Affiliate (Retirees, Volunteers, etc.)",
  "Visiting scholar or visitor",
  "Community member",
  "Other",
];

const STAFF_PROFILE_STUDENT_ROLES_ = [
  "Graduate Student (MS)",
  "Graduate Student (PhD)",
  "MAS Student",
  "Undergraduate Student (UG)",
];

function staffValidateProfile_(payload) {
  const input = payload || {};
  const role = staffClean_(input.role, 80);
  const affiliation = staffClean_(input.affiliation, 120);
  let anticipatedGraduation = staffClean_(input.anticipatedGraduation, 7);
  if (STAFF_PROFILE_ROLES_.indexOf(role) === -1) return { ok: false, message: "Choose a listed role." };
  if (!affiliation) return { ok: false, message: "Choose a program, department, major, or organization." };
  const isStudent = STAFF_PROFILE_STUDENT_ROLES_.indexOf(role) !== -1;
  if (isStudent && !/^\d{4}-(0[1-9]|1[0-2])$/.test(anticipatedGraduation)) {
    return { ok: false, message: "Choose the student's anticipated graduation month and year." };
  }
  if (!isStudent) anticipatedGraduation = "";
  return { ok: true, value: { role: role, affiliation: affiliation, anticipatedGraduation: anticipatedGraduation } };
}

function staffMissingHeaders_(actual, required) {
  const present = (actual || []).map(function (header) { return String(header || "").trim(); });
  return (required || []).filter(function (header) { return present.indexOf(header) === -1; });
}

function staffPreferredName_(displayName) {
  const cleaned = staffClean_(displayName, 120);
  return cleaned ? cleaned.split(/\s+/)[0] : "Member";
}

function staffPrivateName_(displayName) {
  const cleaned = staffClean_(displayName, 120);
  if (!cleaned) return "Member";
  const parts = cleaned.split(/\s+/);
  return parts.length > 1 ? parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + "." : parts[0];
}

function staffIdentifierHint_(value) {
  const cleaned = staffClean_(value, 120);
  return cleaned.length >= 4 ? "ID ending " + cleaned.slice(-4) : "";
}

function staffToolLabel_(toolKey) {
  const cleaned = staffClean_(toolKey, 80).toLowerCase();
  if (cleaned === "epilog_laser_cutter") return "Laser cutter";
  return cleaned.split(/[_-]+/).filter(Boolean).map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); }).join(" ");
}

function staffRoleLabel_(role) {
  const cleaned = staffClean_(role, 80).toLowerCase();
  if (cleaned.indexOf("faculty") !== -1) return "Faculty";
  if (cleaned.indexOf("staff") !== -1) return "Staff";
  if (cleaned.indexOf("student") !== -1 || cleaned.indexOf("postdoc") !== -1) return "Student";
  return "Visitor";
}

function staffAttentionFlags_(registration) {
  if (!registration) return [];
  const flags = [];
  const accountStatus = staffClean_(registration.Status, 80).toLowerCase();
  const waiverStatus = staffClean_(registration["DocuSign Status"], 120).toLowerCase();
  if (["unreviewed", "incomplete", "pending", "pending_waiver_review"].indexOf(accountStatus) !== -1) flags.push("Account incomplete");
  if (waiverStatus && !/(signed|complete|completed|matched|verified|approved)/.test(waiverStatus)) flags.push("Waiver verification pending");
  return flags;
}

function staffVisitFlagDetails_(value) {
  const flags = staffClean_(value, 160).split(",").map(function (flag) { return flag.trim(); }).filter(Boolean);
  const manual = flags.some(function (flag) { return flag.toLowerCase() === "manual check-in"; });
  return {
    flags: flags.filter(function (flag) { return flag.toLowerCase() !== "manual check-in"; }),
    checkInMethod: manual ? "Staff check-in" : "",
  };
}

function staffTodayKey_(date, timeZone) {
  return Utilities.formatDate(date, timeZone, "yyyy-MM-dd");
}

function staffDerivePresence_(people, visits, training, timeZone) {
  const byPerson = {};
  people.forEach(function (person) {
    byPerson[person["Person ID"]] = {
      personId: person["Person ID"],
      name: staffPreferredName_(person["Display Name"]),
      role: staffRoleLabel_(person.Role),
      tools: [],
    };
  });
  training.forEach(function (record) {
    if (!byPerson[record["Person ID"]] || String(record.Status).toLowerCase() !== "approved") return;
    byPerson[record["Person ID"]].tools.push(staffClean_(record.Tool, 80));
  });

  const today = staffTodayKey_(new Date(), timeZone);
  const events = visits.map(function (visit, index) {
    const at = new Date(visit["Check In At"]);
    return { visit: visit, at: at, index: index };
  }).filter(function (entry) {
    return !isNaN(entry.at.getTime()) && staffTodayKey_(entry.at, timeZone) === today;
  }).sort(function (a, b) { return a.at.getTime() - b.at.getTime() || a.index - b.index; });

  const state = {};
  events.forEach(function (entry) {
    const visit = entry.visit;
    const personId = visit["Person ID"];
    const eventType = String(visit["Event Type"] || "");
    if (!byPerson[personId]) return;
    if (eventType === "User Checkin" || eventType === "Staff Reopen") {
      state[personId] = { present: true, checkedInAt: entry.at, event: visit };
    } else if (eventType === "Staff Checkout") {
      state[personId] = { present: false, checkedInAt: state[personId] ? state[personId].checkedInAt : entry.at, event: visit };
    }
  });

  const present = [];
  const left = [];
  Object.keys(state).forEach(function (personId) {
    const current = state[personId];
    const person = byPerson[personId];
    const visitDetails = staffVisitFlagDetails_(current.event.Flags);
    const item = {
      personId: personId,
      name: person.name,
      role: person.role,
      tools: person.tools.filter(Boolean),
      checkedInAt: current.checkedInAt.toISOString(),
      flags: visitDetails.flags,
      checkInMethod: visitDetails.checkInMethod,
    };
    (current.present ? present : left).push(item);
  });
  present.sort(function (a, b) { return b.checkedInAt.localeCompare(a.checkedInAt); });
  left.sort(function (a, b) { return b.checkedInAt.localeCompare(a.checkedInAt); });
  return { present: present, left: left };
}

if (typeof module !== "undefined") module.exports = {
  staffClean_: staffClean_,
  staffTrue_: staffTrue_,
  staffMissingHeaders_: staffMissingHeaders_,
  staffPreferredName_: staffPreferredName_,
  staffPrivateName_: staffPrivateName_,
  staffIdentifierHint_: staffIdentifierHint_,
  staffToolLabel_: staffToolLabel_,
  staffRoleLabel_: staffRoleLabel_,
  staffAttentionFlags_: staffAttentionFlags_,
  staffVisitFlagDetails_: staffVisitFlagDetails_,
  staffValidateProfile_: staffValidateProfile_,
};
