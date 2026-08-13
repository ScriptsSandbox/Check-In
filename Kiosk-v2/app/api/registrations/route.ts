import {
  auditEvents,
  cardLinkSessions,
  registrationApplications,
  userIdentifiers,
  users,
  waiverStatuses,
} from "@/db/schema";
import {
  createClaimCode,
  digestClaimCode,
  id,
  makeDisplayName,
  normalizeEmail,
  normalizeRegistrationIdentifier,
  REGISTRATION_CONSENT_VERSION,
  WAIVER_POWERFORM_URL,
} from "@/lib/registration";

type RegistrationPayload = {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  userType?: string;
  affiliation?: string;
  email?: string;
  secondaryEmail?: string;
  identifierType?: string;
  identifierValue?: string;
  consent?: boolean;
};

const allowedUserTypes = new Set(["student", "staff", "faculty", "postdoc", "visitor", "other"]);
const allowedIdentifierTypes = new Set(["pid", "tsn", "employee_id", "other"]);

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected registration error";
  if (message.includes("UNIQUE constraint failed")) {
    return "An account already exists for that email or UC San Diego ID. Please use the existing-account option at the kiosk or ask staff for help.";
  }
  if (
    message.includes("D1 binding") ||
    message.includes("cloudflare:workers") ||
    message.includes("no such table")
  ) {
    return "Registration storage is not ready yet. No information was saved.";
  }
  return "We could not save the registration. Please try again or ask Sandbox staff for help.";
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as RegistrationPayload;
    const firstName = payload.firstName?.trim() ?? "";
    const lastName = payload.lastName?.trim() ?? "";
    const preferredName = payload.preferredName?.trim() || null;
    const userType = payload.userType?.trim().toLowerCase() ?? "";
    const affiliation = payload.affiliation?.trim() ?? "";
    const primaryEmail = normalizeEmail(payload.email ?? "");
    const secondaryEmail = payload.secondaryEmail
      ? normalizeEmail(payload.secondaryEmail)
      : null;
    const identifierType = payload.identifierType?.trim().toLowerCase() ?? "";
    const identifierValue = payload.identifierValue?.trim() ?? "";
    const normalizedIdentifier = normalizeRegistrationIdentifier(identifierValue, identifierType);

    if (!firstName || !lastName || !affiliation) {
      return Response.json({ error: "Name and affiliation are required." }, { status: 400 });
    }
    if (!allowedUserTypes.has(userType) || !allowedIdentifierTypes.has(identifierType)) {
      return Response.json({ error: "Choose a valid role and ID type." }, { status: 400 });
    }
    if (!validEmail(primaryEmail) || (secondaryEmail && !validEmail(secondaryEmail))) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (!normalizedIdentifier) {
      return Response.json({ error: "Enter a valid PID, TSN, or employee ID." }, { status: 400 });
    }
    if (!payload.consent) {
      return Response.json({ error: "Consent is required to create an account." }, { status: 400 });
    }

    // Loading the Cloudflare binding only after validation keeps the local Pi
    // route importable. A missing hosted DB is then handled as a JSON response
    // instead of escaping as a plain-text module-load error.
    const { getDb } = await import("@/db");
    const userId = id("usr");
    const identifierId = id("uid");
    const waiverId = id("wvr");
    const applicationId = id("reg");
    const linkSessionId = id("lnk");
    const auditId = id("aud");
    const claimCode = createClaimCode();
    const codeDigest = await digestClaimCode(claimCode);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const displayName = makeDisplayName(firstName, lastName, preferredName ?? undefined);

    const db = getDb();
    await db.batch([
      db.insert(users).values({
        id: userId,
        firstName,
        lastName,
        preferredName,
        displayName,
        userType,
        affiliation,
        primaryEmail,
        secondaryEmail,
        status: "pending_waiver",
      }),
      db.insert(userIdentifiers).values({
        id: identifierId,
        userId,
        identifierType,
        identifierValue,
        normalizedValue: normalizedIdentifier,
        isPrimary: true,
        sourceSystem: "Sandbox website registration",
      }),
      db.insert(waiverStatuses).values({
        id: waiverId,
        userId,
        status: "pending",
      }),
      db.insert(registrationApplications).values({
        id: applicationId,
        userId,
        consentVersion: REGISTRATION_CONSENT_VERSION,
      }),
      db.insert(cardLinkSessions).values({
        id: linkSessionId,
        userId,
        applicationId,
        codeDigest,
        codeLastTwo: claimCode.slice(-2),
        expiresAt,
      }),
      db.insert(auditEvents).values({
        id: auditId,
        actorEmail: primaryEmail,
        action: "registration.submitted",
        entityType: "registration_application",
        entityId: applicationId,
        detailJson: JSON.stringify({ source: "website", consentVersion: REGISTRATION_CONSENT_VERSION }),
      }),
    ]);

    return Response.json(
      {
        applicationId,
        displayName,
        claimCode,
        claimCodeExpiresAt: expiresAt,
        waiverUrl: WAIVER_POWERFORM_URL,
      },
      { status: 201 },
    );
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
