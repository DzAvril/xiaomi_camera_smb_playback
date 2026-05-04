import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCatalog } from "../../src/server/db";
import { createCameraId, createClipId } from "../../src/server/ids";

describe("catalog", () => {
  it("stores camera streams and clips", () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "xcp-db-")), "catalog.sqlite");
    const catalog = openCatalog(dbPath);
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
});
