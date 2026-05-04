import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "xcp_session";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimePasswordEquals(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function createSessionToken(password: string): string {
  return createHmac("sha256", password).update("xcp_session", "utf8").digest("hex");
}

export function isValidSessionToken(candidate: string | undefined, password: string): boolean {
  if (!candidate) {
    return false;
  }

  return timingSafeEqual(sha256(candidate), sha256(createSessionToken(password)));
}
