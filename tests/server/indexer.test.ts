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

function makeMp4WithMovieDuration(durationSeconds: number): Buffer {
  const timescale = 1_000;
  const duration = Math.round(durationSeconds * timescale);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("isom", 8, "ascii");

  const mvhd = Buffer.alloc(32);
  mvhd.writeUInt32BE(32, 0);
  mvhd.write("mvhd", 4, "ascii");
  mvhd.writeUInt32BE(timescale, 20);
  mvhd.writeUInt32BE(duration, 24);

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write("moov", 4, "ascii");

  return Buffer.concat([ftyp, moov, mvhd]);
}

function makeFragmentedMp4WithSidxDuration(durationSeconds: number): Buffer {
  const timescale = 1_000;
  const duration = Math.round(durationSeconds * timescale);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("iso6", 8, "ascii");

  const mvhd = Buffer.alloc(32);
  mvhd.writeUInt32BE(32, 0);
  mvhd.write("mvhd", 4, "ascii");
  mvhd.writeUInt32BE(timescale, 20);
  mvhd.writeUInt32BE(0, 24);

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write("moov", 4, "ascii");

  const sidx = Buffer.alloc(44);
  sidx.writeUInt32BE(44, 0);
  sidx.write("sidx", 4, "ascii");
  sidx.writeUInt32BE(1, 12);
  sidx.writeUInt32BE(timescale, 16);
  sidx.writeUInt16BE(1, 30);
  sidx.writeUInt32BE(1024, 32);
  sidx.writeUInt32BE(duration, 36);

  return Buffer.concat([ftyp, moov, mvhd, sidx]);
}

function mp4Box(type: string, content: Buffer): Buffer {
  const box = Buffer.alloc(8);
  box.writeUInt32BE(8 + content.length, 0);
  box.write(type, 4, "ascii");
  return Buffer.concat([box, content]);
}

function makeMikeIndexBox(timestampSeconds: number, fileOffset: number, byteLength: number): Buffer {
  const userType = Buffer.alloc(16);
  const payload = Buffer.alloc(40);
  payload.write("mike_index", 0, "ascii");
  payload.writeUInt32LE(timestampSeconds, 20);
  payload.writeUInt32LE(1, 24);
  payload.writeUInt32LE(fileOffset, 28);
  payload.writeUInt32LE(byteLength, 32);
  return mp4Box("uuid", Buffer.concat([userType, payload]));
}

function makeMdatBox(byteLength: number): Buffer {
  return mp4Box("mdat", Buffer.alloc(byteLength - 8));
}

function unixSecondsForShanghai(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  return Math.floor(Date.UTC(year, month - 1, day, hour - 8, minute, second) / 1000);
}

function makeDiscontinuousFragmentedMp4(
  segments: Array<{ timestampSeconds: number; durationSeconds?: number; referenceDurationsSeconds?: number[] }>,
): Buffer {
  const timescale = 1_000;
  const references = segments.flatMap((segment) =>
    segment.referenceDurationsSeconds ?? [segment.durationSeconds ?? 0]
  );
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "ascii");
  ftyp.write("iso6", 8, "ascii");

  const mvhd = Buffer.alloc(32);
  mvhd.writeUInt32BE(32, 0);
  mvhd.write("mvhd", 4, "ascii");
  mvhd.writeUInt32BE(timescale, 20);
  mvhd.writeUInt32BE(0, 24);

  const moov = Buffer.alloc(8);
  moov.writeUInt32BE(8 + mvhd.length, 0);
  moov.write("moov", 4, "ascii");

  const referenceSize = 128;
  const sidx = Buffer.alloc(32 + 12 * references.length);
  sidx.writeUInt32BE(sidx.length, 0);
  sidx.write("sidx", 4, "ascii");
  sidx.writeUInt32BE(1, 12);
  sidx.writeUInt32BE(timescale, 16);
  sidx.writeUInt16BE(references.length, 30);
  for (const [index, durationSeconds] of references.entries()) {
    const entryOffset = 32 + 12 * index;
    sidx.writeUInt32BE(referenceSize, entryOffset);
    sidx.writeUInt32BE(Math.round(durationSeconds * timescale), entryOffset + 4);
  }

  const prefix = Buffer.concat([ftyp, moov, mvhd, sidx]);
  let fileOffset = prefix.length;
  const chunks: Buffer[] = [];
  for (const segment of segments) {
    const segmentReferenceDurations = segment.referenceDurationsSeconds ?? [segment.durationSeconds ?? 0];
    const segmentByteLength = referenceSize * segmentReferenceDurations.length;
    const uuid = makeMikeIndexBox(segment.timestampSeconds, fileOffset, segmentByteLength);
    const firstMdat = makeMdatBox(referenceSize - uuid.length);
    const remainingReferences = Array.from({ length: segmentReferenceDurations.length - 1 }, () =>
      makeMdatBox(referenceSize)
    );
    chunks.push(Buffer.concat([uuid, firstMdat, ...remainingReferences]));
    fileOffset += segmentByteLength;
  }

  return Buffer.concat([prefix, ...chunks]);
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

  it("uses the MP4 movie duration when the filename end timestamp is too long", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "00_20260504120000_20260504150000.mp4"),
      makeMp4WithMovieDuration(120.5)
    );

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);

    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;
    expect(cameraId).toBeDefined();
    expect(catalog.listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      expect.objectContaining({
        durationSeconds: 120.5,
        endAtMs: new Date("2026-05-04T04:02:00.500Z").getTime(),
        startAtMs: new Date("2026-05-04T04:00:00.000Z").getTime()
      })
    ]);

    catalog.close();
  });

  it("uses the MP4 segment index duration when the movie duration is empty", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "00_20260504120000_20260504150000.mp4"),
      makeFragmentedMp4WithSidxDuration(95.25)
    );

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);

    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;
    expect(cameraId).toBeDefined();
    expect(catalog.listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      expect.objectContaining({
        durationSeconds: 95.25,
        endAtMs: new Date("2026-05-04T04:01:35.250Z").getTime(),
        startAtMs: new Date("2026-05-04T04:00:00.000Z").getTime()
      })
    ]);

    catalog.close();
  });

  it("splits discontinuous fragmented MP4 files into logical clips from mike_index timestamps", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "00_20260504120000_20260504150000.mp4"),
      makeDiscontinuousFragmentedMp4([
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 12, 0), durationSeconds: 60 },
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 14, 0), durationSeconds: 60 },
      ])
    );

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    const result = scanRecordings(catalog, [configuredRoot(root)]);
    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;

    expect(result).toEqual({ cameraCount: 2, clipCount: 2 });
    expect(cameraId).toBeDefined();
    const clips = catalog.listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER);
    expect(clips).toEqual([
      expect.objectContaining({
        startAtMs: Date.UTC(2026, 4, 4, 4, 0, 0),
        endAtMs: Date.UTC(2026, 4, 4, 4, 1, 0),
        durationSeconds: 60,
        mediaStartSeconds: 0,
      }),
      expect.objectContaining({
        startAtMs: Date.UTC(2026, 4, 4, 6, 0, 0),
        endAtMs: Date.UTC(2026, 4, 4, 6, 1, 0),
        durationSeconds: 60,
        mediaStartSeconds: 60,
      })
    ]);
    expect(new Set(clips.map((clip) => clip.sourceFileId)).size).toBe(1);
    expect(catalog.listCameras().find((camera) => camera.channel === "00")).toMatchObject({
      clipCount: 2,
      totalSeconds: 120,
    });

    catalog.close();
  });

  it("sums all segment-index references between mike_index boxes", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "00_20260504120000_20260504150000.mp4"),
      makeDiscontinuousFragmentedMp4([
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 12, 0), referenceDurationsSeconds: [30, 30] },
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 14, 0), referenceDurationsSeconds: [20, 40] },
      ])
    );

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);
    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;

    expect(cameraId).toBeDefined();
    expect(
      catalog
        .listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER)
        .map((clip) => [clip.durationSeconds, clip.mediaStartSeconds]),
    ).toEqual([
      [60, 0],
      [60, 60],
    ]);

    catalog.close();
  });

  it("keeps cheap continuous indexing when the filename span matches the media duration", async () => {
    const scanRecordings = await loadScanRecordings();
    const dir = createTempDir();
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "00_20260504120000_20260504120200.mp4"),
      makeDiscontinuousFragmentedMp4([
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 12, 0), durationSeconds: 60 },
        { timestampSeconds: unixSecondsForShanghai(2026, 5, 4, 14, 0), durationSeconds: 60 },
      ])
    );

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [configuredRoot(root)]);
    const cameraId = catalog.listCameras().find((camera) => camera.channel === "00")?.id;

    expect(cameraId).toBeDefined();
    expect(catalog.listClipsForCamera(cameraId!, 0, Number.MAX_SAFE_INTEGER)).toEqual([
      expect.objectContaining({
        startAtMs: Date.UTC(2026, 4, 4, 4, 0, 0),
        endAtMs: Date.UTC(2026, 4, 4, 4, 2, 0),
        durationSeconds: 120,
        mediaStartSeconds: 0,
      })
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
