import { createHash } from "node:crypto";

function digest(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

export function createCameraId(rootId: string, channel: string): string {
  return `${rootId}-${channel}`.toLowerCase();
}

export function createClipId(absolutePath: string, sizeBytes: number, mtimeMs: number): string {
  return digest(`${absolutePath}:${sizeBytes}:${mtimeMs}`);
}
