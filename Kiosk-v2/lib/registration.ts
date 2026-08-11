export const WAIVER_POWERFORM_URL =
  "https://www.docusign.net/Member/PowerFormSigning.aspx?PowerFormId=18262c4d-dbe4-4fb5-a22e-d44c4dc0b8f0";

export const REGISTRATION_CONSENT_VERSION = "2026-08-10";

const CLAIM_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}
export function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function makeDisplayName(firstName: string, lastName: string, preferredName?: string) {
  return `${preferredName?.trim() || firstName.trim()} ${lastName.trim()}`.trim();
}

export function createClaimCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CLAIM_ALPHABET[byte % CLAIM_ALPHABET.length]).join("");
}

export async function digestClaimCode(value: string) {
  const bytes = new TextEncoder().encode(value.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
