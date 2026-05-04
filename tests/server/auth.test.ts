import type { AppConfig } from "../../src/server/config";
import { createApp } from "../../src/server/app";
import { createCameraId } from "../../src/server/ids";
import { describe, expect, it } from "vitest";

function createTestConfig(): AppConfig {
  return {
    password: "correct horse battery staple",
    timezone: "Asia/Shanghai",
    dataDir: ":memory:",
    databasePath: ":memory:",
    cameraConfigPath: "config/cameras.test.yaml",
    scanIntervalSeconds: 300,
    roots: [],
  };
}

describe("auth app shell", () => {
  it("sets an http-only session cookie for the correct password", async () => {
    const app = createApp(createTestConfig());

    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { password: "correct horse battery staple" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toContain("xcp_session=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");

    await app.close();
  });

  it("rejects a wrong password without setting a session cookie", async () => {
    const app = createApp(createTestConfig());

    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { password: "bad password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers["set-cookie"]).toBeUndefined();

    await app.close();
  });

  it("rejects a missing password without setting a session cookie", async () => {
    const app = createApp(createTestConfig());

    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers["set-cookie"]).toBeUndefined();

    await app.close();
  });

  it("allows health checks without a session", async () => {
    const app = createApp(createTestConfig());

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    await app.close();
  });

  it("rejects protected camera requests without a session", async () => {
    const app = createApp(createTestConfig());

    const response = await app.inject({ method: "GET", url: "/api/cameras" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized" });

    await app.close();
  });

  it("returns cameras with a valid session", async () => {
    const app = createApp(createTestConfig());
    const cameraId = createCameraId("front-door", "00");
    app.catalog.upsertCamera({
      id: cameraId,
      rootId: "front-door",
      rootPath: "/recordings/front-door",
      channel: "00",
      alias: "Front Door",
      enabled: true,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { password: "correct horse battery staple" },
    });
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

    await app.close();
  });
});
