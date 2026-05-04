import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../../src/server/config";
import { createApp } from "../../src/server/app";
import { describe, expect, it } from "vitest";

const PASSWORD = "correct horse battery staple";
const INDEX_HTML = "<!doctype html><html><body><div id=\"root\">Xiaomi playback</div></body></html>";

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "xcp-static-"));
}

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

describe("static frontend serving", () => {
  it("serves built assets, falls back to the SPA for non-API routes, and keeps API misses as JSON 404s", async () => {
    const webRoot = createTempDir();
    mkdirSync(path.join(webRoot, "assets"));
    writeFileSync(path.join(webRoot, "index.html"), INDEX_HTML);
    writeFileSync(path.join(webRoot, "assets", "app.js"), "console.log('built asset');");

    const app = createApp(createTestConfig(), { webRoot });

    try {
      const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toBe("console.log('built asset');");

      const spa = await app.inject({ method: "GET", url: "/cameras/front-door/2026-05-04" });
      expect(spa.statusCode).toBe(200);
      expect(spa.headers["content-type"]).toContain("text/html");
      expect(spa.body).toBe(INDEX_HTML);

      const missingApi = await app.inject({ method: "GET", url: "/api/does-not-exist" });
      expect(missingApi.statusCode).toBe(404);
      expect(missingApi.headers["content-type"]).toContain("application/json");
      expect(missingApi.json()).toEqual({ error: "Not found" });
    } finally {
      await app.close();
      rmSync(webRoot, { recursive: true, force: true });
    }
  });
});
