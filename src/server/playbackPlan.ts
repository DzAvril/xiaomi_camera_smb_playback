import type { ClipRecord, PlaybackGap, PlaybackPlan, PlaybackSegment } from "../shared/types";

export function buildPlaybackPlan(
  cameraId: string,
  clips: ClipRecord[],
  startAtMs: number,
  endAtMs: number
): PlaybackPlan {
  if (endAtMs <= startAtMs) {
    throw new Error("Playback plan end must be after start");
  }

  const sorted = clips
    .filter((clip) => clip.endAtMs > startAtMs && clip.startAtMs < endAtMs)
    .sort((a, b) => a.startAtMs - b.startAtMs);

  const segments: PlaybackSegment[] = [];
  const gaps: PlaybackGap[] = [];
  let cursorMs = startAtMs;

  for (const clip of sorted) {
    const segmentStartMs = Math.max(clip.startAtMs, startAtMs);
    const segmentEndMs = Math.min(clip.endAtMs, endAtMs);

    if (segmentStartMs > cursorMs) {
      gaps.push(makeGap(cursorMs, segmentStartMs, startAtMs));
    }

    if (segmentEndMs > segmentStartMs) {
      const virtualStartSeconds = (segmentStartMs - startAtMs) / 1000;
      const virtualEndSeconds = (segmentEndMs - startAtMs) / 1000;
      const segment: PlaybackSegment = {
        clipId: clip.id,
        fileUrl: `/api/clips/${clip.id}/file`,
        wallStartAtMs: segmentStartMs,
        wallEndAtMs: segmentEndMs,
        clipOffsetSeconds: (segmentStartMs - clip.startAtMs) / 1000,
        playableSeconds: (segmentEndMs - segmentStartMs) / 1000,
        virtualStartSeconds,
        virtualEndSeconds
      };
      segments.push(segment);
      cursorMs = Math.max(cursorMs, segmentEndMs);
    }
  }

  if (cursorMs < endAtMs) {
    gaps.push(makeGap(cursorMs, endAtMs, startAtMs));
  }

  return {
    cameraId,
    startAtMs,
    endAtMs,
    durationSeconds: (endAtMs - startAtMs) / 1000,
    playableSeconds: segments.reduce((sum, segment) => sum + segment.playableSeconds, 0),
    segments,
    gaps
  };
}

function makeGap(startAtMs: number, endAtMs: number, planStartAtMs: number): PlaybackGap {
  return {
    startAtMs,
    endAtMs,
    durationSeconds: (endAtMs - startAtMs) / 1000,
    virtualStartSeconds: (startAtMs - planStartAtMs) / 1000,
    virtualEndSeconds: (endAtMs - planStartAtMs) / 1000
  };
}
