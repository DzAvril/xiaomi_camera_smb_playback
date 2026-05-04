import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../../src/shared/types";
import { parseRangeHeader, resolveClipPath, streamClipFile } from "../../src/server/streaming";

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "xcp-stream-"));
}

function clip(rootPath: string, relativePath: string, sizeBytes: number): ClipRecord {
  return {
    id: "clip-1",
    cameraId: "cam-00",
    rootPath,
    relativePath,
    channel: "00",
    startAtMs: 0,
    endAtMs: 10_000,
    durationSeconds: 10,
    sizeBytes,
    mtimeMs: 1,
  };
}

describe("resolveClipPath", () => {
  it("keeps nested clip paths inside the recording root", () => {
    const root = createTempDir();

    expect(resolveClipPath(root, "nested/clip.mp4")).toBe(path.join(root, "nested", "clip.mp4"));
  });

  it("rejects relative paths that escape the recording root", () => {
    const root = createTempDir();

    expect(() => resolveClipPath(root, "../secret.mp4")).toThrow("Clip path escapes recording root");
  });

  it("rejects absolute paths that escape the recording root", () => {
    const root = createTempDir();

    expect(() => resolveClipPath(root, path.join(path.dirname(root), "secret.mp4"))).toThrow(
      "Clip path escapes recording root",
    );
  });
});

describe("parseRangeHeader", () => {
  it("returns null when the range header is missing", () => {
    expect(parseRangeHeader(undefined, 10)).toBeNull();
  });

  it("parses a single byte range", () => {
    expect(parseRangeHeader("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
  });

  it("uses the file end for open-ended ranges", () => {
    expect(parseRangeHeader("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
  });

  it("clamps overlarge range ends to the file end", () => {
    expect(parseRangeHeader("bytes=7-99", 10)).toEqual({ start: 7, end: 9 });
  });

  it.each(["items=2-5", "bytes=", "bytes=5-2", "bytes=10-12", "bytes=-4", "bytes=1-2,4-5"])(
    "returns null for invalid range %s",
    (header) => {
      expect(parseRangeHeader(header, 10)).toBeNull();
    },
  );
});

describe("streamClipFile", () => {
  it("streams the full file when no valid range is provided", async () => {
    const root = createTempDir();
    const file = path.join(root, "clip.mp4");
    writeFileSync(file, Buffer.from("0123456789"));

    const app = Fastify();
    app.get("/clip", (request, reply) => streamClipFile(request, reply, clip(root, "clip.mp4", 10)));

    try {
      const response = await app.inject({ method: "GET", url: "/clip" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["accept-ranges"]).toBe("bytes");
      expect(response.headers["content-type"]).toBe("video/mp4");
      expect(response.headers["content-length"]).toBe("10");
      expect(response.body).toBe("0123456789");
    } finally {
      await app.close();
    }
  });

  it("uses the actual file size for full-file content length when indexed metadata is stale", async () => {
    const root = createTempDir();
    const file = path.join(root, "clip.mp4");
    writeFileSync(file, Buffer.from("0123456789"));

    const app = Fastify();
    app.get("/clip", (request, reply) => streamClipFile(request, reply, clip(root, "clip.mp4", 99)));

    try {
      const response = await app.inject({ method: "GET", url: "/clip" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-length"]).toBe("10");
      expect(response.body).toBe("0123456789");
    } finally {
      await app.close();
    }
  });

  it("streams only the requested byte range", async () => {
    const root = createTempDir();
    const file = path.join(root, "clip.mp4");
    writeFileSync(file, Buffer.from("0123456789"));

    const app = Fastify();
    app.get("/clip", (request, reply) => streamClipFile(request, reply, clip(root, "clip.mp4", 10)));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/clip",
        headers: { range: "bytes=2-5" },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers["accept-ranges"]).toBe("bytes");
      expect(response.headers["content-type"]).toBe("video/mp4");
      expect(response.headers["content-length"]).toBe("4");
      expect(response.headers["content-range"]).toBe("bytes 2-5/10");
      expect(response.body).toBe("2345");
    } finally {
      await app.close();
    }
  });

  it("uses the actual file size for range parsing and content range when indexed metadata is stale", async () => {
    const root = createTempDir();
    const file = path.join(root, "clip.mp4");
    writeFileSync(file, Buffer.from("0123456789"));

    const app = Fastify();
    app.get("/clip", (request, reply) => streamClipFile(request, reply, clip(root, "clip.mp4", 99)));

    try {
      const response = await app.inject({
        method: "GET",
        url: "/clip",
        headers: { range: "bytes=7-98" },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers["content-length"]).toBe("3");
      expect(response.headers["content-range"]).toBe("bytes 7-9/10");
      expect(response.body).toBe("789");
    } finally {
      await app.close();
    }
  });
});
