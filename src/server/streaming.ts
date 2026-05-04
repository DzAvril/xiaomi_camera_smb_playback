import { createReadStream, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClipRecord } from "../shared/types";

export type ByteRange = {
  start: number;
  end: number;
};

const ESCAPE_ERROR = "Clip path escapes recording root";

function isPathInsideRoot(root: string, target: string): boolean {
  const relativeToRoot = path.relative(root, target);
  return relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot));
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isSyntacticallyValidUnsatisfiableRange(header: string | undefined, sizeBytes: number): boolean {
  if (header === undefined) {
    return false;
  }

  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) {
    return false;
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? start : Number(match[2]);

  return Number.isSafeInteger(start) && Number.isSafeInteger(requestedEnd) && start <= requestedEnd && start >= sizeBytes;
}

export function resolveClipPath(rootPath: string, relativePath: string): string {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, relativePath);

  if (!isPathInsideRoot(root, resolved)) {
    throw new Error(ESCAPE_ERROR);
  }

  try {
    lstatSync(resolved);
  } catch (error) {
    if (isMissingFileError(error)) {
      return resolved;
    }
    throw error;
  }

  if (!isPathInsideRoot(realpathSync(root), realpathSync(resolved))) {
    throw new Error(ESCAPE_ERROR);
  }

  return resolved;
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
  let filePath: string;
  let sizeBytes: number;

  try {
    filePath = resolveClipPath(clip.rootPath, clip.relativePath);
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return reply.code(404).send();
    }
    sizeBytes = stats.size;
  } catch (error) {
    if (error instanceof Error && error.message === ESCAPE_ERROR) {
      return reply.code(403).send();
    }
    if (isMissingFileError(error)) {
      return reply.code(404).send();
    }
    throw error;
  }

  const range = parseRangeHeader(request.headers.range, sizeBytes);

  reply.header("Accept-Ranges", "bytes").type("video/mp4");

  if (range === null && isSyntacticallyValidUnsatisfiableRange(request.headers.range, sizeBytes)) {
    return reply.code(416).header("Content-Range", `bytes */${sizeBytes}`).send();
  }

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
