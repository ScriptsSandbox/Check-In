function staffClean_(value, maxLength) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function staffTrue_(value) {
  return ["true", "1", "yes"].indexOf(String(value || "").trim().toLowerCase()) !== -1;
}

const STAFF_TASK_STATUSES_ = ["To do", "In progress", "Review / test", "Done"];
const STAFF_TASK_PRIORITIES_ = ["Normal", "High"];

function staffValidateTask_(input) {
  const value = input || {};
  const title = staffClean_(value.title, 160);
  const details = staffClean_(value.details, 1000);
  const suggestedFor = staffClean_(value.suggestedFor, 80) || "Anyone";
  const priority = staffClean_(value.priority, 20) || "Normal";
  const rawMinutes = String(value.estimatedMinutes == null ? "" : value.estimatedMinutes).trim();
  const estimatedMinutes = rawMinutes ? Number(rawMinutes) : 0;
  if (!title) return { ok: false, message: "Enter a task title." };
  if (rawMinutes && (!Number.isFinite(estimatedMinutes) || estimatedMinutes < 5 || estimatedMinutes > 480 || Math.round(estimatedMinutes) !== estimatedMinutes)) {
    return { ok: false, message: "Estimated time must be a whole number from 5 to 480 minutes." };
  }
  if (STAFF_TASK_PRIORITIES_.indexOf(priority) === -1) return { ok: false, message: "Choose Normal or High priority." };
  return {
    ok: true,
    value: {
      title: title,
      details: details,
      estimatedMinutes: estimatedMinutes,
      suggestedFor: suggestedFor,
      priority: priority,
    },
  };
}

function staffValidateTaskStatus_(status) {
  const cleaned = staffClean_(status, 40);
  return STAFF_TASK_STATUSES_.indexOf(cleaned) === -1
    ? { ok: false, message: "Choose a valid task status." }
    : { ok: true, value: cleaned };
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

function staffNormalizeWaiverIdentifier_(value) {
  const normalized = staffClean_(value, 120).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^A\d{8}$/.test(normalized)) return normalized.slice(1);
  if (/^0+\d+$/.test(normalized)) return normalized.replace(/^0+(?=\d)/, "");
  return normalized;
}

function staffScrippsWaiverMatchesFromRecords_(queries, records) {
  const matches = {};
  const completed = (records || []).filter(function (record) {
    return staffClean_(record.Status, 40).toLowerCase() === "completed";
  });
  (queries || []).forEach(function (query) {
    const identifiers = (query.identifiers || []).map(staffNormalizeWaiverIdentifier_).filter(Boolean);
    const email = staffClean_(query.email, 254).toLowerCase();
    const matched = completed.some(function (record) {
      const recordIdentifier = staffNormalizeWaiverIdentifier_(record["Normalized Identifier"] || record["Participant ID"]);
      const recordEmail = staffClean_(record["Participant Email"], 254).toLowerCase();
      return (Boolean(recordIdentifier) && identifiers.indexOf(recordIdentifier) !== -1)
        || (Boolean(email) && recordEmail === email);
    });
    if (matched && query.requestId) matches[String(query.requestId)] = true;
  });
  return matches;
}

function staffLegacyWaiverMatchesFromRecords_(queries, records) {
  const matches = {};
  (queries || []).forEach(function (query) {
    const identifiers = (query.identifiers || []).map(staffNormalizeWaiverIdentifier_).filter(Boolean);
    const email = staffClean_(query.email, 254).toLowerCase();
    const matched = (records || []).some(function (record) {
      const recordIdentifier = staffNormalizeWaiverIdentifier_(record.A_Number);
      const recordEmail = staffClean_(record.Email, 254).toLowerCase();
      return (Boolean(recordIdentifier) && identifiers.indexOf(recordIdentifier) !== -1)
        || (Boolean(email) && recordEmail === email);
    });
    if (matched && query.requestId) matches[String(query.requestId)] = true;
  });
  return matches;
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

function staffAttentionFlags_(registration, waiverMatched) {
  if (!registration) return [];
  const flags = [];
  const accountStatus = staffClean_(registration.Status, 80).toLowerCase();
  const waiverStatus = staffClean_(registration["DocuSign Status"], 120).toLowerCase();
  if (["incomplete", "pending"].indexOf(accountStatus) !== -1) flags.push("Account incomplete");
  if (!waiverMatched && waiverStatus && !/(signed|complete|completed|matched|verified|approved)/.test(waiverStatus)) flags.push("Waiver verification pending");
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

function staffPresenceFromSnapshotRecords_(records, timeZone) {
  const people = {};
  const visits = (records || []).map(function (record) {
    const personId = staffClean_(record["Person ID"], 120);
    if (personId && !people[personId]) {
      people[personId] = {
        "Person ID": personId,
        "Display Name": staffClean_(record.Name, 120) || "Member",
        Role: staffClean_(record.Role, 80),
      };
    }
    return {
      "Person ID": personId,
      "Check In At": record["Check In At"],
      "Event Type": record["Event Type"],
      Flags: record.Flags,
    };
  }).filter(function (visit) { return Boolean(visit["Person ID"]); });
  return staffDerivePresence_(Object.keys(people).map(function (personId) { return people[personId]; }), visits, [], timeZone);
}

function staffEnrichPresence_(presence, peopleIndex) {
  const detailsByPerson = {};
  (peopleIndex || []).forEach(function (person) { detailsByPerson[person.personId] = person; });
  ["present", "left"].forEach(function (listName) {
    (presence[listName] || []).forEach(function (person) {
      const details = detailsByPerson[person.personId];
      person.eventFlags = (person.flags || []).slice();
      person.detailsPending = !details;
      if (!details) return;
      person.tools = (details.toolLabels || []).slice();
      person.flags = person.eventFlags.slice();
      (details.attention || []).forEach(function (flag) {
        if (person.flags.indexOf(flag) === -1) person.flags.push(flag);
      });
    });
  });
  return presence;
}

if (typeof module !== "undefined") module.exports = {
  staffClean_: staffClean_,
  staffTrue_: staffTrue_,
  staffMissingHeaders_: staffMissingHeaders_,
  staffPreferredName_: staffPreferredName_,
  staffPrivateName_: staffPrivateName_,
  staffIdentifierHint_: staffIdentifierHint_,
  staffNormalizeWaiverIdentifier_: staffNormalizeWaiverIdentifier_,
  staffScrippsWaiverMatchesFromRecords_: staffScrippsWaiverMatchesFromRecords_,
  staffLegacyWaiverMatchesFromRecords_: staffLegacyWaiverMatchesFromRecords_,
  staffToolLabel_: staffToolLabel_,
  staffRoleLabel_: staffRoleLabel_,
  staffAttentionFlags_: staffAttentionFlags_,
  staffVisitFlagDetails_: staffVisitFlagDetails_,
  staffDerivePresence_: staffDerivePresence_,
  staffPresenceFromSnapshotRecords_: staffPresenceFromSnapshotRecords_,
  staffEnrichPresence_: staffEnrichPresence_,
  staffValidateProfile_: staffValidateProfile_,
  staffValidateTask_: staffValidateTask_,
  staffValidateTaskStatus_: staffValidateTaskStatus_,
};
