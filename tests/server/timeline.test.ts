import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../../src/shared/types";
import { buildDayTimeline, listRecordedDays } from "../../src/server/timeline";

function clip(id: string, start: Date, end: Date): ClipRecord {
  return {
    id,
    cameraId: "cam-00",
    rootPath: "/recordings/cam",
    relativePath: `${id}.mp4`,
    channel: "00",
    startAtMs: start.getTime(),
    endAtMs: end.getTime(),
    durationSeconds: (end.getTime() - start.getTime()) / 1000,
    sizeBytes: 100,
    mtimeMs: 1,
  };
}

describe("buildDayTimeline", () => {
  it("merges adjacent clips with gaps of one second or less", () => {
    const spans = buildDayTimeline(
      [
        clip("a", new Date(2026, 4, 4, 11, 0, 0), new Date(2026, 4, 4, 11, 10, 0)),
        clip("b", new Date(2026, 4, 4, 11, 10, 1), new Date(2026, 4, 4, 11, 20, 0)),
        clip("c", new Date(2026, 4, 4, 11, 22, 0), new Date(2026, 4, 4, 11, 30, 0)),
      ],
      "2026-05-04",
    );

    expect(spans).toHaveLength(2);
    expect(spans[0].clipIds).toEqual(["a", "b"]);
    expect(spans[1].clipIds).toEqual(["c"]);
  });
});

describe("listRecordedDays", () => {
  it("summarizes days with total seconds and bytes", () => {
    const days = listRecordedDays([
      clip("a", new Date(2026, 4, 4, 11, 0, 0), new Date(2026, 4, 4, 11, 10, 0)),
      clip("b", new Date(2026, 4, 5, 9, 0, 0), new Date(2026, 4, 5, 9, 5, 0)),
    ]);

    expect(days).toEqual([
      { date: "2026-05-05", totalSeconds: 300, totalBytes: 100 },
      { date: "2026-05-04", totalSeconds: 600, totalBytes: 100 },
    ]);
  });
});
