import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { endOfLocalDay, startOfLocalDay } from "../../src/shared/time";
import { createApp } from "../../src/server/app";
import type { AppConfig } from "../../src/server/config";
import { openCatalog } from "../../src/server/db";
import { registerRoutes } from "../../src/server/routes";

const PASSWORD = "correct horse battery staple";

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "xcp-routes-"));
}

async function withHostTimeZone<T>(timeZone: string, run: () => Promise<T>): Promise<T> {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = timeZone;

  try {
    return await run();
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
}

function createTestConfig(dir: string, root: string): AppConfig {
  return {
    password: PASSWORD,
    timezone: "Asia/Shanghai",
    dataDir: dir,
    databasePath: path.join(dir, "catalog.sqlite"),
    cameraConfigPath: path.join(dir, "cameras.yaml"),
    scanIntervalSeconds: 300,
    roots: [
      {
        id: "b888809544f6",
        path: root,
        streams: [{ channel: "00", alias: "Front Door", enabled: true }],
      },
    ],
  };
}

async function login(app: FastifyInstance) {
  const response = await app.inject({
    method: "POST",
    url: "/api/session",
    payload: { password: PASSWORD },
  });
  const cookie = response.cookies[0];
  return { [cookie.name]: cookie.value };
}

function createFixtureApp() {
  const dir = createTempDir();
  const root = path.join(dir, "B888809544F6");
  mkdirSync(root);
  writeFileSync(path.join(root, "00_20260504110000_20260504111000.mp4"), Buffer.from("0123456789"));

  return {
    dir,
    root,
    app: createApp(createTestConfig(dir, root)),
  };
}

async function withIndexedFixture<T>(fn: (fixture: { app: FastifyInstance; cookies: Record<string, string> }) => Promise<T>) {
  const fixture = createFixtureApp();

  try {
    const cookies = await login(fixture.app);
    const refresh = await fixture.app.inject({
      method: "POST",
      url: "/api/index/refresh",
      cookies,
    });
    expect(refresh.statusCode).toBe(200);

    return await fn({ app: fixture.app, cookies });
  } finally {
    await fixture.app.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

describe("playback API routes", () => {
  it("requires auth for protected API routes", async () => {
    const fixture = createFixtureApp();

    try {
      const response = await fixture.app.inject({ method: "POST", url: "/api/index/refresh" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await fixture.app.close();
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  it("refreshes the index and exposes cameras, days, timeline, and playback plan", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const camerasResponse = await app.inject({ method: "GET", url: "/api/cameras", cookies });
      expect(camerasResponse.statusCode).toBe(200);
      const cameras = camerasResponse.json();
      expect(cameras).toEqual([
        expect.objectContaining({
          alias: "Front Door",
          channel: "00",
          clipCount: 1,
          enabled: true,
        }),
      ]);

      const cameraId = cameras[0].id;
      const daysResponse = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/days`,
        cookies,
      });
      expect(daysResponse.statusCode).toBe(200);
      expect(daysResponse.json()).toEqual([
        {
          date: "2026-05-04",
          totalBytes: 10,
          totalSeconds: 600,
        },
      ]);

      const timelineResponse = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/timeline?date=2026-05-04`,
        cookies,
      });
      expect(timelineResponse.statusCode).toBe(200);
      expect(timelineResponse.json()).toEqual([
        expect.objectContaining({
          durationSeconds: 600,
          startAtMs: new Date("2026-05-04T03:00:00.000Z").getTime(),
          endAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
        }),
      ]);

      const planResponse = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-05-04T03:00:00.000Z&end=2026-05-04T03:10:00.000Z`,
        cookies,
      });
      expect(planResponse.statusCode).toBe(200);
      expect(planResponse.json()).toEqual(
        expect.objectContaining({
          cameraId,
          durationSeconds: 600,
          playableSeconds: 600,
          segments: [
            expect.objectContaining({
              playableSeconds: 600,
              virtualStartSeconds: 0,
              virtualEndSeconds: 600,
            }),
          ],
          gaps: [],
        }),
      );
    });
  });

  it("returns stable 500 JSON when refreshing the index fails", async () => {
    const dir = createTempDir();
    const app = Fastify({ logger: false });
    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    app.decorate("catalog", catalog);

    registerRoutes(app, createTestConfig(dir, path.join(dir, "recordings")), {
      scanRecordings: () => {
        throw new Error("boom");
      },
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/index/refresh",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Failed to refresh index" });
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updates camera alias and enabled fields while preserving omitted values", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      const aliasResponse = await app.inject({
        method: "PATCH",
        url: `/api/cameras/${cameraId}`,
        cookies,
        payload: { alias: "Garage" },
      });

      expect(aliasResponse.statusCode).toBe(200);
      expect(aliasResponse.json()).toEqual(expect.objectContaining({ alias: "Garage", enabled: true }));

      const enabledResponse = await app.inject({
        method: "PATCH",
        url: `/api/cameras/${cameraId}`,
        cookies,
        payload: { enabled: false },
      });

      expect(enabledResponse.statusCode).toBe(200);
      expect(enabledResponse.json()).toEqual(expect.objectContaining({ alias: "Garage", enabled: false }));
    });
  });

  it("preserves patched camera alias and enabled values after refreshing the index", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      const patchResponse = await app.inject({
        method: "PATCH",
        url: `/api/cameras/${cameraId}`,
        cookies,
        payload: { alias: "Garage", enabled: false },
      });
      expect(patchResponse.statusCode).toBe(200);

      const refreshResponse = await app.inject({
        method: "POST",
        url: "/api/index/refresh",
        cookies,
      });
      expect(refreshResponse.statusCode).toBe(200);

      const camerasResponse = await app.inject({ method: "GET", url: "/api/cameras", cookies });
      expect(camerasResponse.statusCode).toBe(200);
      expect(camerasResponse.json()[0]).toEqual(expect.objectContaining({ alias: "Garage", enabled: false }));
    });
  });

  it("rejects non-object camera patch bodies", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      const response = await app.inject({
        method: "PATCH",
        url: `/api/cameras/${cameraId}`,
        cookies,
        payload: ["bad"],
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid camera update" });
    });
  });

  it("returns 404 when patching a missing camera", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/cameras/missing-camera",
        cookies,
        payload: { alias: "Missing" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Camera not found" });
    });
  });

  it("returns a controlled 400 for invalid plan query parameters", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      const missingEnd = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-05-04T03:00:00.000Z`,
        cookies,
      });
      expect(missingEnd.statusCode).toBe(400);
      expect(missingEnd.json()).toEqual({ error: "Invalid plan range" });

      const inverted = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-05-04T03:10:00.000Z&end=2026-05-04T03:00:00.000Z`,
        cookies,
      });
      expect(inverted.statusCode).toBe(400);
      expect(inverted.json()).toEqual({ error: "Invalid plan range" });

      const malformed = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=not-a-date&end=2026-05-04T03:00:00.000Z`,
        cookies,
      });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toEqual({ error: "Invalid plan range" });

      const impossibleUtcDate = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-02-31T00:00:00Z&end=2026-05-04T03:10:00Z`,
        cookies,
      });
      expect(impossibleUtcDate.statusCode).toBe(400);
      expect(impossibleUtcDate.json()).toEqual({ error: "Invalid plan range" });

      const impossibleOffsetDate = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-02-31T00:00:00%2B08:00&end=2026-05-04T11:10:00%2B08:00`,
        cookies,
      });
      expect(impossibleOffsetDate.statusCode).toBe(400);
      expect(impossibleOffsetDate.json()).toEqual({ error: "Invalid plan range" });
    });
  });

  it("parses explicit offset plan timestamps as absolute instants", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      const response = await app.inject({
        method: "GET",
        url: `/api/cameras/${cameraId}/plan?start=2026-05-04T11:00:00%2B08:00&end=2026-05-04T11:10:00%2B08:00`,
        cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({
          playableSeconds: 600,
          segments: [
            expect.objectContaining({
              playableSeconds: 600,
              virtualStartSeconds: 0,
              virtualEndSeconds: 600,
            }),
          ],
          gaps: [],
        }),
      );
    });
  });

  it("parses timezone-less plan timestamps as Shanghai local time under a UTC host timezone", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;

      await withHostTimeZone("UTC", async () => {
        const response = await app.inject({
          method: "GET",
          url: `/api/cameras/${cameraId}/plan?start=2026-05-04T11:00:00&end=2026-05-04T11:10:00`,
          cookies,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(
          expect.objectContaining({
            playableSeconds: 600,
            segments: [
              expect.objectContaining({
                playableSeconds: 600,
                virtualStartSeconds: 0,
                virtualEndSeconds: 600,
              }),
            ],
            gaps: [],
          }),
        );
      });
    });
  });

  it("streams indexed clips and supports byte ranges", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const cameraId = app.catalog.listCameras()[0].id;
      const clip = app.catalog.listClipsForCamera(cameraId, startOfLocalDay("2026-05-04"), endOfLocalDay("2026-05-04"))[0];

      const fullResponse = await app.inject({
        method: "GET",
        url: `/api/clips/${clip.id}/file`,
        cookies,
      });
      expect(fullResponse.statusCode).toBe(200);
      expect(fullResponse.headers["content-type"]).toBe("video/mp4");
      expect(fullResponse.body).toBe("0123456789");

      const rangeResponse = await app.inject({
        method: "GET",
        url: `/api/clips/${clip.id}/file`,
        headers: { range: "bytes=2-5" },
        cookies,
      });
      expect(rangeResponse.statusCode).toBe(206);
      expect(rangeResponse.headers["content-range"]).toBe("bytes 2-5/10");
      expect(rangeResponse.body).toBe("2345");
    });
  });

  it("returns 404 when streaming a missing clip id", async () => {
    await withIndexedFixture(async ({ app, cookies }) => {
      const response = await app.inject({
        method: "GET",
        url: "/api/clips/missing/file",
        cookies,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Clip not found" });
    });
  });
});
