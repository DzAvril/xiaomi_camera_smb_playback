import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCatalog } from "../../src/server/db";
import { createCameraId, createClipId } from "../../src/server/ids";

function createTempCatalog() {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "xcp-db-")), "catalog.sqlite");
  return openCatalog(dbPath);
}

function withHostTimeZone<T>(timeZone: string, run: () => T): T {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = timeZone;

  try {
    return run();
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
}

describe("catalog", () => {
  it("stores camera streams and clips", () => {
    const catalog = createTempCatalog();
    const cameraId = createCameraId("dual", "00");
    const clipId = createClipId("/recordings/dual/00_20260504110024_20260504111027.mp4", 100, 123);

    catalog.upsertCamera({
      id: cameraId,
      rootId: "dual",
      rootPath: "/recordings/dual",
      channel: "00",
      alias: "双摄 A",
      enabled: true,
    });
    catalog.upsertClip({
      id: clipId,
      cameraId,
      rootPath: "/recordings/dual",
      relativePath: "00_20260504110024_20260504111027.mp4",
      channel: "00",
      startAtMs: 1777863624000,
      endAtMs: 1777864227000,
      durationSeconds: 603,
      sizeBytes: 134217728,
      mtimeMs: 123,
    });

    expect(catalog.listCameras()[0]).toMatchObject({
      id: cameraId,
      alias: "双摄 A",
      clipCount: 1,
      totalSeconds: 603,
      totalBytes: 134217728,
    });
    expect(catalog.listClipsForCamera(cameraId, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);

    catalog.close();
  });

  it("counts recorded days in Shanghai time under UTC host timezone", () => {
    withHostTimeZone("UTC", () => {
      const catalog = createTempCatalog();
      const cameraId = createCameraId("dual", "00");

      catalog.upsertCamera({
        id: cameraId,
        rootId: "dual",
        rootPath: "/recordings/dual",
        channel: "00",
        alias: "双摄 A",
        enabled: true,
      });
      catalog.upsertClip({
        id: "same-shanghai-day-1",
        cameraId,
        rootPath: "/recordings/dual",
        relativePath: "00_20260504003000_20260504004000.mp4",
        channel: "00",
        startAtMs: Date.UTC(2026, 4, 3, 16, 30, 0),
        endAtMs: Date.UTC(2026, 4, 3, 16, 40, 0),
        durationSeconds: 600,
        sizeBytes: 100,
        mtimeMs: 1,
      });
      catalog.upsertClip({
        id: "same-shanghai-day-2",
        cameraId,
        rootPath: "/recordings/dual",
        relativePath: "00_20260504233000_20260504234000.mp4",
        channel: "00",
        startAtMs: Date.UTC(2026, 4, 4, 15, 30, 0),
        endAtMs: Date.UTC(2026, 4, 4, 15, 40, 0),
        durationSeconds: 600,
        sizeBytes: 100,
        mtimeMs: 2,
      });

      expect(catalog.listCameras()[0]).toMatchObject({
        id: cameraId,
        recordedDays: 1,
      });

      catalog.close();
    });
  });

  it("removes unseen clips when the seen id list exceeds SQLite bind limits", () => {
    const catalog = createTempCatalog();
    const cameraId = createCameraId("dual", "00");

    catalog.upsertCamera({
      id: cameraId,
      rootId: "dual",
      rootPath: "/recordings/dual",
      channel: "00",
      alias: "双摄 A",
      enabled: true,
    });
    for (let index = 0; index < 3; index += 1) {
      catalog.upsertClip({
        id: `clip-${index}`,
        cameraId,
        rootPath: "/recordings/dual",
        relativePath: `00_clip_${index}.mp4`,
        channel: "00",
        startAtMs: Date.UTC(2026, 4, 4, 3, index, 0),
        endAtMs: Date.UTC(2026, 4, 4, 3, index + 1, 0),
        durationSeconds: 60,
        sizeBytes: 100 + index,
        mtimeMs: index,
      });
    }

    const seenIds = ["clip-0", "clip-2", ...Array.from({ length: 33_000 }, (_, index) => `seen-${index}`)];

    expect(() => catalog.removeClipsNotSeen(cameraId, seenIds)).not.toThrow();
    expect(catalog.listClipsForCamera(cameraId, 0, Number.MAX_SAFE_INTEGER).map((clip) => clip.id)).toEqual([
      "clip-0",
      "clip-2",
    ]);

    catalog.close();
  });
});
