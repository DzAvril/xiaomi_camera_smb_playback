import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { ClipRecord } from "../shared/types";
import type { AppConfig } from "./config";
import type { Catalog } from "./db";
import { createCameraId, createClipId } from "./ids";
import { parseXiaomiClipName } from "./parser";

type RootConfig = AppConfig["roots"][number];

export type ScanResult = {
  cameraCount: number;
  clipCount: number;
};

export function scanRecordings(catalog: Catalog, roots: RootConfig[]): ScanResult {
  let cameraCount = 0;
  let clipCount = 0;

  for (const root of roots) {
    const files = existsSync(root.path) ? readdirSync(root.path, { withFileTypes: true }) : [];
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
        const stat = statSync(absolutePath);
        const clip: ClipRecord = {
          id: createClipId(absolutePath, stat.size, stat.mtimeMs),
          cameraId,
          rootPath: root.path,
          relativePath: entry.name,
          channel: parsed.channel,
          startAtMs: parsed.startAtMs,
          endAtMs: parsed.endAtMs,
          durationSeconds: parsed.durationSeconds,
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
