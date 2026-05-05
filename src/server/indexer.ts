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
  closeSync?(fd: number): void;
  openSync?(path: string, flags: string): number;
  readSync?(fd: number, buffer: Buffer, offset: number, length: number, position: number): number;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{
    name: string;
    isFile(): boolean;
  }>;
  statSync(path: string): {
    size: number;
    mtimeMs: number;
  };
};

type LogicalClipSegment = {
  durationSeconds: number;
  mediaStartSeconds: number;
  startAtMs: number;
};

type MikeIndexEntry = {
  fileOffset: number;
  timestampSeconds: number;
};

const BOX_HEADER_BYTES = 8;
const MAX_UUID_SCAN_BYTES = 256;
const MIKE_INDEX_MARKER = Buffer.from("mike_index", "ascii");
const SPLIT_DURATION_TOLERANCE_SECONDS = 1;

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

function readBytesAt(fileSystem: FileSystem, fd: number, position: number, length: number): Buffer | null {
  if (!fileSystem.readSync || length <= 0) {
    return null;
  }

  const buffer = Buffer.alloc(length);
  const bytesRead = fileSystem.readSync(fd, buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
}

function parseSidxDurations(box: Buffer): number[] {
  if (box.length < 32) {
    return [];
  }

  const version = box.readUInt8(8);
  if (version !== 0) {
    return [];
  }

  const timescale = box.readUInt32BE(16);
  if (timescale <= 0) {
    return [];
  }

  const referenceCount = box.readUInt16BE(30);
  const durations: number[] = [];
  for (let index = 0; index < referenceCount; index += 1) {
    const entryOffset = 32 + index * 12;
    if (entryOffset + 8 > box.length) {
      return durations;
    }
    durations.push(box.readUInt32BE(entryOffset + 4) / timescale);
  }

  return durations;
}

function parseMikeIndexEntry(content: Buffer): MikeIndexEntry | null {
  const markerOffset = content.indexOf(MIKE_INDEX_MARKER);
  if (markerOffset < 0 || markerOffset + 36 > content.length) {
    return null;
  }

  return {
    timestampSeconds: content.readUInt32LE(markerOffset + 20),
    fileOffset: content.readUInt32LE(markerOffset + 28),
  };
}

function readFragmentedLogicalSegments(
  fileSystem: FileSystem,
  filePath: string,
  fileSize: number,
  filenameDurationSeconds: number,
  mediaDurationSeconds: number,
): LogicalClipSegment[] | null {
  if (
    Math.abs(filenameDurationSeconds - mediaDurationSeconds) <= SPLIT_DURATION_TOLERANCE_SECONDS ||
    !fileSystem.openSync ||
    !fileSystem.closeSync ||
    !fileSystem.readSync
  ) {
    return null;
  }

  const mikeIndexes: MikeIndexEntry[] = [];
  let sidxDurations: number[] = [];
  let fd: number | null = null;

  try {
    fd = fileSystem.openSync(filePath, "r");
    let position = 0;
    while (position + BOX_HEADER_BYTES <= fileSize) {
      const header = readBytesAt(fileSystem, fd, position, BOX_HEADER_BYTES);
      if (!header) {
        break;
      }

      const size = header.readUInt32BE(0);
      const type = header.toString("ascii", 4, 8);
      if (size < BOX_HEADER_BYTES) {
        break;
      }

      if (type === "sidx") {
        const box = readBytesAt(fileSystem, fd, position, size);
        sidxDurations = box ? parseSidxDurations(box) : [];
      } else if (type === "uuid") {
        const contentSize = Math.min(size - BOX_HEADER_BYTES, MAX_UUID_SCAN_BYTES);
        const content = readBytesAt(fileSystem, fd, position + BOX_HEADER_BYTES, contentSize);
        const entry = content ? parseMikeIndexEntry(content) : null;
        if (entry) {
          mikeIndexes.push(entry);
        }
      }

      position += size;
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fileSystem.closeSync(fd);
    }
  }

  if (mikeIndexes.length < 2 || sidxDurations.length < mikeIndexes.length) {
    return null;
  }

  let mediaStartSeconds = 0;
  return mikeIndexes
    .sort((a, b) => a.fileOffset - b.fileOffset)
    .map((entry, index) => {
      const durationSeconds = sidxDurations[index];
      const segment = {
        durationSeconds,
        mediaStartSeconds,
        startAtMs: entry.timestampSeconds * 1000,
      };
      mediaStartSeconds += durationSeconds;
      return segment;
    })
    .filter((segment) => segment.durationSeconds > 0);
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
        const sourceFileId = createClipId(absolutePath, stat.size, stat.mtimeMs);
        const logicalSegments =
          mediaDurationSeconds === null
            ? null
            : readFragmentedLogicalSegments(fileSystem, absolutePath, stat.size, parsed.durationSeconds, durationSeconds);
        const clipSegments = logicalSegments ?? [
          {
            durationSeconds,
            mediaStartSeconds: 0,
            startAtMs: parsed.startAtMs,
          },
        ];

        for (const [index, segment] of clipSegments.entries()) {
          const clip: ClipRecord = {
            id: logicalSegments ? `${sourceFileId}-${index}` : sourceFileId,
            sourceFileId,
            cameraId,
            rootPath: root.path,
            relativePath: entry.name,
            channel: parsed.channel,
            startAtMs: segment.startAtMs,
            endAtMs: segment.startAtMs + Math.round(segment.durationSeconds * 1000),
            durationSeconds: segment.durationSeconds,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            mediaStartSeconds: segment.mediaStartSeconds,
          };
          catalog.upsertClip(clip);
          seenIds.push(clip.id);
          clipCount += 1;
        }
      }

      catalog.removeClipsNotSeen(cameraId, seenIds);
    }
  }

  return { cameraCount, clipCount };
}
