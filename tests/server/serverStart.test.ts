import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/server/config";
import { startServer } from "../../src/server/server";

const PASSWORD = "correct horse battery staple";

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "xcp-server-"));
}

function createTestConfig(dir: string): AppConfig {
  return {
    password: PASSWORD,
    timezone: "Asia/Shanghai",
    dataDir: dir,
    databasePath: path.join(dir, "catalog.sqlite"),
    cameraConfigPath: path.join(dir, "cameras.yaml"),
    scanIntervalSeconds: 300,
    roots: [],
  };
}

describe("server startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listens before triggering startup indexing and keeps health responsive", async () => {
    const dir = createTempDir();
    const events: string[] = [];
    let app: FastifyInstance | null = null;

    try {
      const server = await startServer(createTestConfig(dir), {
        host: "127.0.0.1",
        port: 0,
        registerSignals: false,
        createBackgroundIndexer: () => ({
          close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          isRunning: () => false,
          start: vi.fn(),
          trigger: vi.fn(() => {
            events.push("trigger");
            return true;
          }),
        }),
        onListening: () => {
          events.push("listen");
        },
      });
      app = server.app;

      expect(events).toEqual(["listen", "trigger"]);
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
