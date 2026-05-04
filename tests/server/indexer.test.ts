import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openCatalog } from "../../src/server/db";
import { scanRecordings } from "../../src/server/indexer";

describe("scanRecordings", () => {
  it("indexes configured streams and removes disappeared clips", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xcp-index-"));
    const root = path.join(dir, "B888809544F6");
    mkdirSync(root);
    const first = path.join(root, "00_20260504103350_20260504104702.mp4");
    const second = path.join(root, "10_20260504103350_20260504104720.mp4");
    writeFileSync(first, Buffer.alloc(16));
    writeFileSync(second, Buffer.alloc(32));

    const catalog = openCatalog(path.join(dir, "catalog.sqlite"));
    scanRecordings(catalog, [
      {
        id: "b888809544f6",
        path: root,
        streams: [
          { channel: "00", alias: "双摄 A", enabled: true },
          { channel: "10", alias: "双摄 B", enabled: true }
        ]
      }
    ]);

    const cameras = catalog.listCameras();
    expect(cameras.map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["10", 1],
      ["00", 1]
    ]);

    rmSync(first);
    scanRecordings(catalog, [
      {
        id: "b888809544f6",
        path: root,
        streams: [
          { channel: "00", alias: "双摄 A", enabled: true },
          { channel: "10", alias: "双摄 B", enabled: true }
        ]
      }
    ]);

    expect(catalog.listCameras().map((camera) => [camera.channel, camera.clipCount])).toEqual([
      ["10", 1],
      ["00", 0]
    ]);

    catalog.close();
  });
});
