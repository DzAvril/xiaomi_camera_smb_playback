import { describe, expect, it } from "vitest";
import type { PlaybackPlan, PlaybackSegment } from "../../src/shared/types";
import { findNextSegmentAfter, findSegmentAtVirtualTime } from "../../src/web/player/virtualPlayback";

function segment(
  clipId: string,
  virtualStartSeconds: number,
  virtualEndSeconds: number,
  clipOffsetSeconds: number,
): PlaybackSegment {
  return {
    clipId,
    fileUrl: `/api/clips/${clipId}/file?token=encoded%20value`,
    wallStartAtMs: Date.UTC(2026, 4, 4, 3, 0, virtualStartSeconds),
    wallEndAtMs: Date.UTC(2026, 4, 4, 3, 0, virtualEndSeconds),
    clipOffsetSeconds,
    playableSeconds: virtualEndSeconds - virtualStartSeconds,
    virtualStartSeconds,
    virtualEndSeconds,
  };
}

function playbackPlan(segments: PlaybackSegment[]): PlaybackPlan {
  return {
    cameraId: "front-main",
    startAtMs: Date.UTC(2026, 4, 4, 3, 0, 0),
    endAtMs: Date.UTC(2026, 4, 4, 3, 1, 0),
    durationSeconds: 60,
    playableSeconds: segments.reduce((sum, item) => sum + item.playableSeconds, 0),
    segments,
    gaps: [],
  };
}

describe("virtual playback mapping", () => {
  it("maps virtual time inside a segment to the source clip offset", () => {
    const plan = playbackPlan([segment("clip-a", 0, 10, 5)]);

    expect(findSegmentAtVirtualTime(plan, 6)).toMatchObject({
      segmentIndex: 0,
      clipTimeSeconds: 11,
      segment: {
        clipId: "clip-a",
      },
    });
  });

  it("returns the next playable segment after a gap", () => {
    const plan = playbackPlan([segment("clip-a", 0, 10, 5), segment("clip-b", 15, 25, 30)]);

    expect(findNextSegmentAfter(plan, 12)).toMatchObject({
      segmentIndex: 1,
      clipTimeSeconds: 30,
      segment: {
        clipId: "clip-b",
      },
    });
  });

  it("treats segment ranges as half-open at exact boundaries", () => {
    const gapped = playbackPlan([segment("clip-a", 0, 10, 0), segment("clip-b", 15, 25, 30)]);
    const contiguous = playbackPlan([segment("clip-a", 0, 10, 0), segment("clip-b", 10, 20, 30)]);

    expect(findSegmentAtVirtualTime(gapped, 10)).toBeNull();
    expect(findSegmentAtVirtualTime(gapped, 15)).toMatchObject({ segmentIndex: 1, clipTimeSeconds: 30 });
    expect(findSegmentAtVirtualTime(contiguous, 10)).toMatchObject({ segmentIndex: 1, clipTimeSeconds: 30 });
  });

  it("returns null before the first segment and after the last segment", () => {
    const plan = playbackPlan([segment("clip-a", 5, 10, 0), segment("clip-b", 15, 25, 30)]);

    expect(findSegmentAtVirtualTime(plan, 4)).toBeNull();
    expect(findSegmentAtVirtualTime(plan, 25)).toBeNull();
    expect(findNextSegmentAfter(plan, 26)).toBeNull();
  });

  it("finds the first segment when virtual time starts before all playable video", () => {
    const plan = playbackPlan([segment("clip-a", 5, 10, 0)]);

    expect(findNextSegmentAfter(plan, 0)).toMatchObject({ segmentIndex: 0, clipTimeSeconds: 0 });
  });
});
