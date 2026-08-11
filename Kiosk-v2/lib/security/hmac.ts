function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, namespace: string, value: string): Promise<string> {
  if (secret.length < 32) {
    throw new Error("CARD_UID_HMAC_SECRET must contain at least 32 characters.");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${namespace}\u0000${value}`),
  );
  return bytesToHex(signature);
}

export async function stablePrivateId(
  prefix: string,
  secret: string,
  namespace: string,
  value: string,
): Promise<string> {
  return `${prefix}_${(await hmacHex(secret, namespace, value)).slice(0, 32)}`;
}
