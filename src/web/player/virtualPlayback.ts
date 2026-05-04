import type { PlaybackPlan, PlaybackSegment } from "../../shared/types";

export type VirtualPlaybackMatch = {
  segment: PlaybackSegment;
  segmentIndex: number;
  clipTimeSeconds: number;
};

function isPlayableSegment(segment: PlaybackSegment): boolean {
  return segment.virtualEndSeconds > segment.virtualStartSeconds;
}

function toMatch(segment: PlaybackSegment, segmentIndex: number, virtualSeconds: number): VirtualPlaybackMatch {
  return {
    segment,
    segmentIndex,
    clipTimeSeconds: segment.clipOffsetSeconds + (virtualSeconds - segment.virtualStartSeconds),
  };
}

export function findSegmentAtVirtualTime(
  plan: PlaybackPlan | null | undefined,
  virtualSeconds: number,
): VirtualPlaybackMatch | null {
  if (!plan || !Number.isFinite(virtualSeconds)) {
    return null;
  }

  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index];
    if (
      isPlayableSegment(segment) &&
      virtualSeconds >= segment.virtualStartSeconds &&
      virtualSeconds < segment.virtualEndSeconds
    ) {
      return toMatch(segment, index, virtualSeconds);
    }
  }

  return null;
}

export function findNextSegmentAfter(
  plan: PlaybackPlan | null | undefined,
  virtualSeconds: number,
): VirtualPlaybackMatch | null {
  if (!plan || !Number.isFinite(virtualSeconds)) {
    return null;
  }

  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index];
    if (isPlayableSegment(segment) && segment.virtualStartSeconds >= virtualSeconds) {
      return toMatch(segment, index, segment.virtualStartSeconds);
    }
  }

  return null;
}
