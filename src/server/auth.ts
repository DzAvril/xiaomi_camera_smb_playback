import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "xcp_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

type SessionRecord = {
  tokenHash: Buffer;
  expiresAtMs: number;
};

const PASSWORD_HASH_SCHEME = "scrypt";
const PASSWORD_HASH_BYTES = 64;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimePasswordEquals(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, PASSWORD_HASH_BYTES).toString("base64url");

  return `${PASSWORD_HASH_SCHEME}$${salt}$${hash}`;
}

export function verifyPasswordHash(candidate: string, passwordHash: string): boolean {
  const [scheme, salt, expectedHash] = passwordHash.split("$");
  if (scheme !== PASSWORD_HASH_SCHEME || !salt || !expectedHash) {
    return false;
  }

  const expected = Buffer.from(expectedHash, "base64url");
  const actual = scryptSync(candidate, salt, expected.length);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function createSessionStore(ttlMs = SESSION_TTL_MS) {
  const sessions = new Map<string, SessionRecord>();

  function pruneExpiredSessions(nowMs: number) {
    for (const [key, session] of sessions) {
      if (session.expiresAtMs <= nowMs) {
        sessions.delete(key);
      }
    }
  }

  return {
    create(nowMs = Date.now()): { token: string; expiresAtMs: number } {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = sha256(token);
      const expiresAtMs = nowMs + ttlMs;

      sessions.set(tokenHash.toString("hex"), { tokenHash, expiresAtMs });

      return { token, expiresAtMs };
    },
    isValid(candidate: string | undefined, nowMs = Date.now()): boolean {
      if (!candidate) {
        return false;
      }

      pruneExpiredSessions(nowMs);

      const candidateHash = sha256(candidate);
      for (const session of sessions.values()) {
        if (timingSafeEqual(candidateHash, session.tokenHash)) {
          return true;
        }
      }

      return false;
    },
    clear() {
      sessions.clear();
    },
  };
}
