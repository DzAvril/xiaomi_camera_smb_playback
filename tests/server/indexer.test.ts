import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCatalog } from "../../src/server/db";

async function loadScanRecordings() {
  const indexer = await import("../../src/server/indexer");
  return indexer.scanRecordings;
}

async function loadScanRecordingsWithFileSystem() {
  const indexer = await import("../../src/server/indexer");
  return indexer.scanRecordingsWithFileSystem;
}

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "xcp-index-"));
}

function configuredRoot(root: string) {
  return {
    id: "b888809544f6",
    path: root,
    streams: [
      { channel: "00", alias: "双摄 A", enabled: true },
      { channel: "10", alias: "双摄 B", enabled: true }
    ]
  };
}

describe("scanRecordings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("indexes configured streams and removes disappeared clips", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    const first = path.join(root, "00_20260504103350_20260504104702.mp4");
    const second = path.join(root, "10_20260504103350_20260504104720.mp4");
    writeFileSync(first, Buffer.alloc(16));
    writeFileSync(second, Buffer.alloc(32));

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);

    const cameras = catalog.listCameras();
    expect(cameras.map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["10", 1],
      ["00", 1]
    ]);

    rmSync(first);
    scanRecordings(catalog, [configuredRoot(root)]);

    expect(catalog.listCameras().map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["10", 1],
      ["00", 0]
    ]);

    catalog.close();
  });

  it("preserves existing clips when a configured root is missing", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(path.join(root, "00_20260504103350_20260504104702.mp4"), Buffer.alloc(16));

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);
    rmSync(root, { recursive: true, force: true });

    const result = scanRecordings(catalog, [configuredRoot(root)]);

    expect(result).toEqual({ cameraCount: 2, clipCount: 0 });
    expect(catalog.listCameras().map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["00", 1],
      ["10", 0]
    ]);

    catalog.close();
  });

  it("prunes existing clips when a configured root is an empty directory", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    const first = path.join(root, "00_20260504103350_20260504104702.mp4");
    writeFileSync(first, Buffer.alloc(16));

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);
    rmSync(first);

    const result = scanRecordings(catalog, [configuredRoot(root)]);

    expect(result).toEqual({ cameraCount: 2, clipCount: 0 });
    expect(catalog.listCameras().map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["00", 0],
      ["10", 0]
    ]);

    catalog.close();
  });

  it("continues scanning when a matching file disappears before stat", async () => {
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    const disappeared = path.join(root, "00_20260504103350_20260504104702.mp4");
    const remaining = path.join(root, "00_20260504105000_20260504105500.mp4");
    writeFileSync(disappeared, Buffer.alloc(16));
    writeFileSync(remaining, Buffer.alloc(32));

    const scanRecordingsWithFileSystem = await loadScanRecordingsWithFileSystem();
    const fileSystem = {
      existsSync: () => true,
      readdirSync: () => [
        { name: path.basename(disappeared), isFile: () => true },
        { name: path.basename(remaining), isFile: () => true }
      ],
      statSync: (filePath: string) => {
        if (filePath === disappeared) {
          const error = new Error("file disappeared") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return {
          size: 32,
          mtimeMs: 123
        };
      }
    };

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    const result = scanRecordingsWithFileSystem(catalog, [configuredRoot(root)], fileSystem);

    expect(result).toEqual({ cameraCount: 2, clipCount: 1 });
    expect(catalog.listCameras().map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["00", 1],
      ["10", 0]
    ]);

    catalog.close();
  });

  it("reports counts and ignores malformed or wrong-channel files", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    const valid = "00_20260504103350_20260504104702.mp4";
    writeFileSync(path.join(root, valid), Buffer.alloc(16));
    writeFileSync(path.join(root, "00_not-a-xiaomi-name.mp4"), Buffer.alloc(16));
    writeFileSync(path.join(root, "99_20260504103350_20260504104702.mp4"), Buffer.alloc(16));

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    const result = scanRecordings(catalog, [configuredRoot(root)]);
    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;

    expect(result).toEqual({ cameraCount: 2, clipCount: 1 });
    expect(cameraId).toBeDefined();
    expect(catalog.listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER).map((clip) => clip.relativePath)).toEqual([
      valid
    ]);

    catalog.close();
  });
});
