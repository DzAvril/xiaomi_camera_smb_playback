import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "xcp_session";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

type SessionRecord = {
  tokenHash: Buffer;
  expiresAtMs: number;
};

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimePasswordEquals(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
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
  };
}
