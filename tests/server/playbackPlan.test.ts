import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../../src/shared/types";
import { buildPlaybackPlan } from "../../src/server/playbackPlan";

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
    mtimeMs: 1
  };
}

describe("buildPlaybackPlan", () => {
  it("clips files to the requested range and records gaps", () => {
    const start = new Date(2026, 4, 4, 11, 5, 0).getTime();
    const end = new Date(2026, 4, 4, 11, 30, 0).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [
        clip("a", new Date(2026, 4, 4, 11, 0, 0), new Date(2026, 4, 4, 11, 10, 0)),
        clip("b", new Date(2026, 4, 4, 11, 12, 0), new Date(2026, 4, 4, 11, 20, 0))
      ],
      start,
      end
    );

    expect(plan.durationSeconds).toBe(1500);
    expect(plan.playableSeconds).toBe(780);
    expect(plan.segments.map((segment) => [segment.clipId, segment.clipOffsetSeconds, segment.playableSeconds])).toEqual([
      ["a", 300, 300],
      ["b", 0, 480]
    ]);
    expect(plan.gaps.map((gap) => gap.durationSeconds)).toEqual([120, 600]);
  });
});
