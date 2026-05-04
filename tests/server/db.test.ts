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

function upsertDefaultCamera(
  catalog: ReturnType<typeof openCatalog>,
  cameraId = createCameraId("dual", "00"),
  channel = "00",
) {
  catalog.upsertCamera({
    id: cameraId,
    rootId: "dual",
    rootPath: "/recordings/dual",
    channel,
    alias: "双摄 A",
    enabled: true,
  });
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

    upsertDefaultCamera(catalog, cameraId);
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

  it("keeps clips for other cameras when pruning unseen clips", () => {
    const catalog = createTempCatalog();
    const cameraAId = createCameraId("dual", "00");
    const cameraBId = createCameraId("dual", "01");

    upsertDefaultCamera(catalog, cameraAId);
    upsertDefaultCamera(catalog, cameraBId, "01");
    catalog.upsertClip({
      id: "camera-a-seen",
      cameraId: cameraAId,
      rootPath: "/recordings/dual",
      relativePath: "00_seen.mp4",
      channel: "00",
      startAtMs: Date.UTC(2026, 4, 4, 3, 0, 0),
      endAtMs: Date.UTC(2026, 4, 4, 3, 1, 0),
      durationSeconds: 60,
      sizeBytes: 100,
      mtimeMs: 1,
    });
    catalog.upsertClip({
      id: "camera-a-unseen",
      cameraId: cameraAId,
      rootPath: "/recordings/dual",
      relativePath: "00_unseen.mp4",
      channel: "00",
      startAtMs: Date.UTC(2026, 4, 4, 3, 1, 0),
      endAtMs: Date.UTC(2026, 4, 4, 3, 2, 0),
      durationSeconds: 60,
      sizeBytes: 101,
      mtimeMs: 2,
    });
    catalog.upsertClip({
      id: "camera-b-unrelated",
      cameraId: cameraBId,
      rootPath: "/recordings/dual",
      relativePath: "01_unrelated.mp4",
      channel: "01",
      startAtMs: Date.UTC(2026, 4, 4, 3, 0, 0),
      endAtMs: Date.UTC(2026, 4, 4, 3, 1, 0),
      durationSeconds: 60,
      sizeBytes: 102,
      mtimeMs: 3,
    });

    catalog.removeClipsNotSeen(cameraAId, ["camera-a-seen"]);

    expect(catalog.listClipsForCamera(cameraAId, 0, Number.MAX_SAFE_INTEGER).map((clip) => clip.id)).toEqual([
      "camera-a-seen",
    ]);
    expect(catalog.listClipsForCamera(cameraBId, 0, Number.MAX_SAFE_INTEGER).map((clip) => clip.id)).toEqual([
      "camera-b-unrelated",
    ]);

    catalog.close();
  });

  it("uses the camera end/start index for overlap timeline lookups", () => {
    const catalog = createTempCatalog();
    const rows = catalog.db
      .prepare(
        `
        EXPLAIN QUERY PLAN
        SELECT * FROM clips INDEXED BY idx_clips_camera_end_start
        WHERE camera_id = ?
          AND end_at_ms > ?
          AND start_at_ms < ?
        ORDER BY start_at_ms ASC
      `,
      )
      .all(createCameraId("dual", "00"), Date.UTC(2026, 4, 4, 3, 0, 0), Date.UTC(2026, 4, 4, 4, 0, 0)) as Array<{
      detail: string;
    }>;

    expect(rows.map((row) => row.detail).join("\n")).toContain("idx_clips_camera_end_start");

    catalog.close();
  });

  it("returns only clips that overlap the requested interval", () => {
    const catalog = createTempCatalog();
    const cameraId = createCameraId("dual", "00");
    const startAtMs = Date.UTC(2026, 4, 4, 3, 0, 0);
    const endAtMs = Date.UTC(2026, 4, 4, 4, 0, 0);

    upsertDefaultCamera(catalog, cameraId);
    for (const clip of [
      {
        id: "ends-at-start",
        startAtMs: Date.UTC(2026, 4, 4, 2, 30, 0),
        endAtMs: startAtMs,
      },
      {
        id: "starts-at-end",
        startAtMs: endAtMs,
        endAtMs: Date.UTC(2026, 4, 4, 4, 30, 0),
      },
      {
        id: "spans-interval",
        startAtMs: Date.UTC(2026, 4, 4, 2, 30, 0),
        endAtMs: Date.UTC(2026, 4, 4, 4, 30, 0),
      },
    ]) {
      catalog.upsertClip({
        ...clip,
        cameraId,
        rootPath: "/recordings/dual",
        relativePath: `${clip.id}.mp4`,
        channel: "00",
        durationSeconds: (clip.endAtMs - clip.startAtMs) / 1000,
        sizeBytes: 100,
        mtimeMs: 1,
      });
    }

    expect(catalog.listClipsForCamera(cameraId, startAtMs, endAtMs).map((clip) => clip.id)).toEqual([
      "spans-interval",
    ]);

    catalog.close();
  });
});
