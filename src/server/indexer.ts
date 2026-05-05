import fs from "node:fs";
import path from "node:path";
import type { ClipRecord } from "../shared/types.js";
import type { AppConfig } from "./config.js";
import type { Catalog } from "./db.js";
import { createCameraId, createClipId } from "./ids.js";
import { readMp4DurationSeconds } from "./mediaDuration.js";
import { parseXiaomiClipName } from "./parser.js";

type RootConfig = AppConfig["roots"][number];

export type ScanResult = {
  cameraCount: number;
  clipCount: number;
};

export function scanRecordings(catalog: Catalog, roots: RootConfig[]): ScanResult {
  return scanRecordingsWithFileSystem(catalog, roots, fs);
}

type FileSystem = {
  existsSync(path: string): boolean;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{
    name: string;
    isFile(): boolean;
  }>;
  statSync(path: string): {
    size: number;
    mtimeMs: number;
  };
};

function readRootFiles(fileSystem: FileSystem, rootPath: string) {
  try {
    if (!fileSystem.existsSync(rootPath)) {
      return null;
    }
    return fileSystem.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return null;
  }
}

function statFile(fileSystem: FileSystem, filePath: string) {
  try {
    return fileSystem.statSync(filePath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return null;
    }
    throw error;
  }
}

export function scanRecordingsWithFileSystem(
  catalog: Catalog,
  roots: RootConfig[],
  fileSystem: FileSystem,
): ScanResult {
  let cameraCount = 0;
  let clipCount = 0;

  for (const root of roots) {
    const files = readRootFiles(fileSystem, root.path);
    for (const stream of root.streams) {
      const cameraId = createCameraId(root.id, stream.channel);
      cameraCount += 1;
      catalog.upsertCamera({
        id: cameraId,
        rootId: root.id,
        rootPath: root.path,
        channel: stream.channel,
        alias: stream.alias,
        enabled: stream.enabled,
      });

      if (files === null) {
        continue;
      }

      const seenIds: string[] = [];
      for (const entry of files) {
        if (!entry.isFile()) {
          continue;
        }
        const parsed = parseXiaomiClipName(entry.name);
        if (!parsed || parsed.channel !== stream.channel) {
          continue;
        }

        const absolutePath = path.join(root.path, entry.name);
        const stat = statFile(fileSystem, absolutePath);
        if (stat === null) {
          continue;
        }

        const mediaDurationSeconds = readMp4DurationSeconds(absolutePath);
        const durationSeconds =
          mediaDurationSeconds === null ? parsed.durationSeconds : Math.round(mediaDurationSeconds * 1000) / 1000;
        const endAtMs = parsed.startAtMs + Math.round(durationSeconds * 1000);

        const clip: ClipRecord = {
          id: createClipId(absolutePath, stat.size, stat.mtimeMs),
          cameraId,
          rootPath: root.path,
          relativePath: entry.name,
          channel: parsed.channel,
          startAtMs: parsed.startAtMs,
          endAtMs,
          durationSeconds,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        };
        catalog.upsertClip(clip);
        seenIds.push(clip.id);
        clipCount += 1;
      }

      catalog.removeClipsNotSeen(cameraId, seenIds);
    }
  }

  return { cameraCount, clipCount };
}
