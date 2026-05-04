import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClipRecord } from "../shared/types";

export type ByteRange = {
  start: number;
  end: number;
};

const ESCAPE_ERROR = "Clip path escapes recording root";

export function resolveClipPath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, relativePath);
  const relativeToRoot = path.relative(root, resolved);

  if (relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))) {
    return resolved;
  }

  throw new Error(ESCAPE_ERROR);
}

export function parseRangeHeader(header: string | undefined, sizeBytes: number): ByteRange | null {
  if (header === undefined || sizeBytes <= 0) {
    return null;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? sizeBytes - 1 : Number(match[2]);
  const end = Math.min(requestedEnd, sizeBytes - 1);

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start > end) {
    return null;
  }

  return { start, end };
}

export function streamClipFile(request: FastifyRequest, reply: FastifyReply, clip: ClipRecord) {
  const filePath = resolveClipPath(clip.rootPath, clip.relativePath);
  const sizeBytes = statSync(filePath).size;
  const range = parseRangeHeader(request.headers.range, sizeBytes);

  reply.header("Accept-Ranges", "bytes").type("video/mp4");

  if (range === null) {
    return reply.header("Content-Length", sizeBytes).send(createReadStream(filePath));
  }

  const contentLength = range.end - range.start + 1;
  return reply
    .code(206)
    .header("Content-Length", contentLength)
    .header("Content-Range", `bytes ${range.start}-${range.end}/${sizeBytes}`)
    .send(createReadStream(filePath, { start: range.start, end: range.end }));
}
