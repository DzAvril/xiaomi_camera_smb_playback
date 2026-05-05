import type { AppConfig } from "../../src/server/config";
import { createApp } from "../../src/server/app";
import { createCameraId } from "../../src/server/ids";
import { describe, expect, it } from "vitest";

const PASSWORD = "correct horse battery staple";

function createTestConfig(): AppConfig {
  return {
    password: PASSWORD,
    timezone: "Asia/Shanghai",
    dataDir: ":memory:",
    databasePath: ":memory:",
    cameraConfigPath: "config/cameras.test.yaml",
    scanIntervalSeconds: 300,
    roots: [],
  };
}

async function login(app: ReturnType<typeof createApp>) {
  return app.inject({
    method: "POST",
    url: "/api/session",
    payload: { password: PASSWORD },
  });
}

describe("auth app shell", () => {
  it("sets an http-only session cookie for the correct password", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await login(app);

      expect(response.statusCode).toBe(204);
      expect(response.headers["set-cookie"]).toContain("xcp_session=");
      expect(response.headers["set-cookie"]).toContain("HttpOnly");
      expect(response.headers["set-cookie"]).toContain("Path=/");
      expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    } finally {
      await app.close();
    }
  });

  it("creates a different session token for each successful login", async () => {
    const app = createApp(createTestConfig());

    try {
      const firstResponse = await login(app);
      const secondResponse = await login(app);

      expect(firstResponse.statusCode).toBe(204);
      expect(secondResponse.statusCode).toBe(204);
      expect(firstResponse.cookies[0].name).toBe("xcp_session");
      expect(secondResponse.cookies[0].name).toBe("xcp_session");
      expect(firstResponse.cookies[0].value).not.toEqual(secondResponse.cookies[0].value);
    } finally {
      await app.close();
    }
  });

  it("rejects a wrong password without setting a session cookie", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { password: "bad password" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Unauthorized" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("rejects a missing password without setting a session cookie", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: {},
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Unauthorized" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("allows health checks without a session", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("allows health checks when request logging is enabled", async () => {
    const app = createApp(createTestConfig(), { logger: true });

    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("rejects protected camera requests without a session", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await app.inject({ method: "GET", url: "/api/cameras" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await app.close();
    }
  });

  it("rejects an invalid session cookie", async () => {
    const app = createApp(createTestConfig());

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/cameras",
        cookies: { xcp_session: "stale-or-forged-token" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await app.close();
    }
  });

  it("returns cameras with a valid session", async () => {
    const app = createApp(createTestConfig());
    try {
      const cameraId = createCameraId("front-door", "00");
      app.catalog.upsertCamera({
        id: cameraId,
        rootId: "front-door",
        rootPath: "/recordings/front-door",
        channel: "00",
        alias: "Front Door",
        enabled: true,
      });

      const loginResponse = await login(app);
      const cookie = loginResponse.cookies[0];

      const response = await app.inject({
        method: "GET",
        url: "/api/cameras",
        cookies: { [cookie.name]: cookie.value },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          id: cameraId,
          alias: "Front Door",
        }),
      ]);
    } finally {
      await app.close();
    }
  });

  it("changes the app password and refreshes the active session", async () => {
    const app = createApp(createTestConfig());

    try {
      const loginResponse = await login(app);
      const oldCookie = loginResponse.cookies[0];

      const changeResponse = await app.inject({
        method: "POST",
        url: "/api/settings/password",
        cookies: { [oldCookie.name]: oldCookie.value },
        payload: {
          currentPassword: PASSWORD,
          newPassword: "new correct horse password",
        },
      });

      expect(changeResponse.statusCode).toBe(204);
      expect(changeResponse.cookies[0].name).toBe("xcp_session");
      expect(changeResponse.cookies[0].value).not.toEqual(oldCookie.value);

      const oldPasswordResponse = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { password: PASSWORD },
      });
      expect(oldPasswordResponse.statusCode).toBe(401);

      const newPasswordResponse = await app.inject({
        method: "POST",
        url: "/api/session",
        payload: { password: "new correct horse password" },
      });
      expect(newPasswordResponse.statusCode).toBe(204);

      const staleSessionResponse = await app.inject({
        method: "GET",
        url: "/api/cameras",
        cookies: { [oldCookie.name]: oldCookie.value },
      });
      expect(staleSessionResponse.statusCode).toBe(401);

      const freshCookie = changeResponse.cookies[0];
      const freshSessionResponse = await app.inject({
        method: "GET",
        url: "/api/cameras",
        cookies: { [freshCookie.name]: freshCookie.value },
      });
      expect(freshSessionResponse.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("rejects password changes with the wrong current password or a short new password", async () => {
    const app = createApp(createTestConfig());

    try {
      const loginResponse = await login(app);
      const cookie = loginResponse.cookies[0];

      const wrongCurrentResponse = await app.inject({
        method: "POST",
        url: "/api/settings/password",
        cookies: { [cookie.name]: cookie.value },
        payload: {
          currentPassword: "bad password",
          newPassword: "new correct horse password",
        },
      });
      expect(wrongCurrentResponse.statusCode).toBe(401);
      expect(wrongCurrentResponse.json()).toEqual({ error: "Unauthorized" });

      const shortPasswordResponse = await app.inject({
        method: "POST",
        url: "/api/settings/password",
        cookies: { [cookie.name]: cookie.value },
        payload: {
          currentPassword: PASSWORD,
          newPassword: "short",
        },
      });
      expect(shortPasswordResponse.statusCode).toBe(400);
      expect(shortPasswordResponse.json()).toEqual({ error: "New password must be at least 8 characters" });
    } finally {
      await app.close();
    }
  });
});
