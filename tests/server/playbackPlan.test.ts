import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../../src/shared/types";
import { buildPlaybackPlan } from "../../src/server/playbackPlan";

function clip(id: string, start: Date, end: Date, mediaStartSeconds = 0, sourceFileId?: string): ClipRecord {
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
    mediaStartSeconds,
    sourceFileId
  };
}

function at(hour: number, minute: number, second = 0): Date {
  return new Date(2026, 4, 4, hour, minute, second);
}

function expectMonotonicNonOverlappingVirtualSegments(plan: ReturnType<typeof buildPlaybackPlan>): void {
  let cursorSeconds = 0;
  for (const segment of plan.segments) {
    expect(segment.virtualStartSeconds).toBeGreaterThanOrEqual(cursorSeconds);
    expect(segment.virtualEndSeconds).toBeGreaterThan(segment.virtualStartSeconds);
    cursorSeconds = segment.virtualEndSeconds;
  }
}

function expectUniqueVirtualCoverage(plan: ReturnType<typeof buildPlaybackPlan>, expectedSeconds: number): void {
  const virtualCoverageSeconds = plan.segments.reduce(
    (sum, segment) => sum + segment.virtualEndSeconds - segment.virtualStartSeconds,
    0
  );

  expect(plan.playableSeconds).toBe(expectedSeconds);
  expect(virtualCoverageSeconds).toBe(expectedSeconds);
}

describe("buildPlaybackPlan", () => {
  it("clips files to the requested range and records gaps", () => {
    const start = at(11, 5).getTime();
    const end = at(11, 30).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [
        clip("a", at(11, 0), at(11, 10)),
        clip("b", at(11, 12), at(11, 20))
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
    expect(plan.gaps.map((gap) => [
      gap.startAtMs,
      gap.endAtMs,
      gap.durationSeconds,
      gap.virtualStartSeconds,
      gap.virtualEndSeconds
    ])).toEqual([
      [at(11, 10).getTime(), at(11, 12).getTime(), 120, 300, 420],
      [at(11, 20).getTime(), at(11, 30).getTime(), 600, 900, 1500]
    ]);
  });

  it("emits only uncovered portions for overlapping clips", () => {
    const start = at(11, 0).getTime();
    const end = at(11, 15).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [clip("a", at(11, 0), at(11, 10)), clip("b", at(11, 5), at(11, 15))],
      start,
      end
    );

    expect(plan.segments.map((segment) => [
      segment.clipId,
      segment.clipOffsetSeconds,
      segment.playableSeconds,
      segment.virtualStartSeconds,
      segment.virtualEndSeconds
    ])).toEqual([
      ["a", 0, 600, 0, 600],
      ["b", 300, 300, 600, 900]
    ]);
    expect(plan.gaps).toEqual([]);
    expectMonotonicNonOverlappingVirtualSegments(plan);
    expectUniqueVirtualCoverage(plan, 900);
  });

  it("skips duplicate and contained clips already covered by earlier clips", () => {
    const start = at(11, 0).getTime();
    const end = at(11, 15).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [
        clip("a", at(11, 0), at(11, 15)),
        clip("duplicate", at(11, 0), at(11, 15)),
        clip("contained", at(11, 5), at(11, 10))
      ],
      start,
      end
    );

    expect(plan.segments.map((segment) => segment.clipId)).toEqual(["a"]);
    expect(plan.gaps).toEqual([]);
    expectMonotonicNonOverlappingVirtualSegments(plan);
    expectUniqueVirtualCoverage(plan, 900);
  });

  it("chooses the longest same-start clip deterministically regardless of input order", () => {
    const start = at(11, 0).getTime();
    const end = at(11, 15).getTime();
    const short = clip("short", at(11, 0), at(11, 5));
    const long = clip("long", at(11, 0), at(11, 15));

    const shortFirstPlan = buildPlaybackPlan("cam-00", [short, long], start, end);
    const longFirstPlan = buildPlaybackPlan("cam-00", [long, short], start, end);

    const expectedSegments = [
      {
        clipId: "long",
        fileUrl: "/api/clips/long/file",
        wallStartAtMs: start,
        wallEndAtMs: end,
        clipOffsetSeconds: 0,
        playableSeconds: 900,
        virtualStartSeconds: 0,
        virtualEndSeconds: 900
      }
    ];

    expect(shortFirstPlan.segments).toEqual(expectedSegments);
    expect(longFirstPlan.segments).toEqual(expectedSegments);
    expect(shortFirstPlan.playableSeconds).toBe(900);
    expect(longFirstPlan.playableSeconds).toBe(900);
    expect(shortFirstPlan.gaps).toEqual([]);
    expect(longFirstPlan.gaps).toEqual([]);
    expectMonotonicNonOverlappingVirtualSegments(shortFirstPlan);
    expectMonotonicNonOverlappingVirtualSegments(longFirstPlan);
  });

  it("rejects invalid ranges", () => {
    expect(() => buildPlaybackPlan("cam-00", [], at(11, 5).getTime(), at(11, 5).getTime())).toThrow(
      "Playback plan end must be after start"
    );
  });

  it("returns a full-range gap when no clips overlap", () => {
    const start = at(11, 0).getTime();
    const end = at(11, 15).getTime();
    const plan = buildPlaybackPlan("cam-00", [clip("outside", at(11, 20), at(11, 30))], start, end);

    expect(plan.playableSeconds).toBe(0);
    expect(plan.segments).toEqual([]);
    expect(plan.gaps.map((gap) => [gap.durationSeconds, gap.virtualStartSeconds, gap.virtualEndSeconds])).toEqual([
      [900, 0, 900]
    ]);
  });

  it("does not create gaps at exact clip boundaries", () => {
    const start = at(11, 0).getTime();
    const end = at(11, 20).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [clip("a", at(11, 0), at(11, 10)), clip("b", at(11, 10), at(11, 20))],
      start,
      end
    );

    expect(plan.gaps).toEqual([]);
    expect(plan.segments.map((segment) => [segment.clipId, segment.virtualStartSeconds, segment.virtualEndSeconds])).toEqual([
      ["a", 0, 600],
      ["b", 600, 1200]
    ]);
    expectMonotonicNonOverlappingVirtualSegments(plan);
    expectUniqueVirtualCoverage(plan, 1200);
  });

  it("seeks from the logical clip offset inside a discontinuous physical file", () => {
    const start = at(14, 0, 30).getTime();
    const end = at(14, 0, 45).getTime();
    const plan = buildPlaybackPlan("cam-00", [clip("jump", at(14, 0), at(14, 1), 3600)], start, end);

    expect(plan.segments.map((segment) => [segment.clipId, segment.clipOffsetSeconds, segment.playableSeconds])).toEqual([
      ["jump", 3630, 15]
    ]);
  });

  it("keeps a stable file URL for logical clips from the same physical file", () => {
    const start = at(10, 0).getTime();
    const end = at(10, 2).getTime();
    const plan = buildPlaybackPlan(
      "cam-00",
      [
        clip("physical-a-0", at(10, 0), at(10, 1), 0, "physical-a"),
        clip("physical-a-1", at(10, 1), at(10, 2), 60, "physical-a")
      ],
      start,
      end
    );

    expect(plan.segments.map((segment) => [segment.clipId, segment.fileUrl, segment.clipOffsetSeconds])).toEqual([
      ["physical-a-0", "/api/clips/physical-a-0/file", 0],
      ["physical-a-1", "/api/clips/physical-a-0/file", 60]
    ]);
  });
});
