import { describe, expect, it } from "vitest";
import { startOfLocalDay } from "../../src/shared/time";
import type { ClipRecord } from "../../src/shared/types";
import { buildDayTimeline, listRecordedDays } from "../../src/server/timeline";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function clip(id: string, startAtMs: number, endAtMs: number, sizeBytes = 100): ClipRecord {
  return {
    id,
    cameraId: "cam-00",
    rootPath: "/recordings/cam",
    relativePath: `${id}.mp4`,
    channel: "00",
    startAtMs,
    endAtMs,
    durationSeconds: (endAtMs - startAtMs) / 1000,
    sizeBytes,
    mtimeMs: 1,
  };
}

describe("buildDayTimeline", () => {
  it("merges adjacent clips with gaps of one second or less", () => {
    const dayStart = startOfLocalDay("2026-05-04");
    const spans = buildDayTimeline(
      [
        clip("a", dayStart + 11 * HOUR_MS, dayStart + 11 * HOUR_MS + 10 * MINUTE_MS),
        clip(
          "b",
          dayStart + 11 * HOUR_MS + 10 * MINUTE_MS + 1000,
          dayStart + 11 * HOUR_MS + 20 * MINUTE_MS,
        ),
        clip("c", dayStart + 11 * HOUR_MS + 22 * MINUTE_MS, dayStart + 11 * HOUR_MS + 30 * MINUTE_MS),
      ],
      "2026-05-04",
    );

    expect(spans).toHaveLength(2);
    expect(spans[0].clipIds).toEqual(["a", "b"]);
    expect(spans[1].clipIds).toEqual(["c"]);
  });

  it("clips spans to the requested Shanghai day bounds", () => {
    const dayStart = startOfLocalDay("2026-05-04");
    const dayEnd = startOfLocalDay("2026-05-05");

    const spans = buildDayTimeline([clip("a", dayStart - MINUTE_MS, dayEnd + MINUTE_MS)], "2026-05-04");

    expect(spans).toEqual([
      {
        startAtMs: dayStart,
        endAtMs: dayEnd,
        durationSeconds: 24 * 60 * 60,
        clipIds: ["a"],
      },
    ]);
  });
});

describe("listRecordedDays", () => {
  it("summarizes days with total seconds and bytes", () => {
    const may4 = startOfLocalDay("2026-05-04");
    const may5 = startOfLocalDay("2026-05-05");
    const days = listRecordedDays([
      clip("a", may4 + 11 * HOUR_MS, may4 + 11 * HOUR_MS + 10 * MINUTE_MS),
      clip("b", may5 + 9 * HOUR_MS, may5 + 9 * HOUR_MS + 5 * MINUTE_MS),
    ]);

    expect(days).toEqual([
      { date: "2026-05-05", totalSeconds: 300, totalBytes: 100 },
      { date: "2026-05-04", totalSeconds: 600, totalBytes: 100 },
    ]);
  });

  it("splits coverage seconds across Shanghai midnight", () => {
    const may4 = startOfLocalDay("2026-05-04");
    const may5 = startOfLocalDay("2026-05-05");

    const days = listRecordedDays([clip("a", may4 + 23 * HOUR_MS + 50 * MINUTE_MS, may5 + 10 * MINUTE_MS)]);

    expect(days).toEqual([
      { date: "2026-05-05", totalSeconds: 600, totalBytes: 0 },
      { date: "2026-05-04", totalSeconds: 600, totalBytes: 100 },
    ]);
  });

  it("does not double count overlapping coverage seconds", () => {
    const may4 = startOfLocalDay("2026-05-04");

    const days = listRecordedDays([
      clip("a", may4 + 11 * HOUR_MS, may4 + 11 * HOUR_MS + 10 * MINUTE_MS),
      clip("b", may4 + 11 * HOUR_MS + 5 * MINUTE_MS, may4 + 11 * HOUR_MS + 15 * MINUTE_MS),
    ]);

    expect(days).toEqual([{ date: "2026-05-04", totalSeconds: 900, totalBytes: 200 }]);
  });
});
