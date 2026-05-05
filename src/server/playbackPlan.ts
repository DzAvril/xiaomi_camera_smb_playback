import type { ClipRecord, PlaybackGap, PlaybackPlan, PlaybackSegment } from "../shared/types.js";

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
    .sort((a, b) => a.startAtMs - b.startAtMs || b.endAtMs - a.endAtMs || a.id.localeCompare(b.id));
  const fileUrlClipIdBySource = new Map<string, string>();

  for (const clip of sorted) {
    const sourceKey = clip.sourceFileId ?? clip.id;
    if (!fileUrlClipIdBySource.has(sourceKey)) {
      fileUrlClipIdBySource.set(sourceKey, clip.id);
    }
  }

  const segments: PlaybackSegment[] = [];
  const gaps: PlaybackGap[] = [];
  let cursorMs = startAtMs;

  for (const clip of sorted) {
    const segmentStartMs = Math.max(clip.startAtMs, startAtMs);
    const segmentEndMs = Math.min(clip.endAtMs, endAtMs);
    const effectiveStartMs = Math.max(segmentStartMs, cursorMs);

    if (effectiveStartMs > cursorMs) {
      gaps.push(makeGap(cursorMs, effectiveStartMs, startAtMs));
    }

    if (segmentEndMs > effectiveStartMs) {
      const virtualStartSeconds = (effectiveStartMs - startAtMs) / 1000;
      const virtualEndSeconds = (segmentEndMs - startAtMs) / 1000;
      const sourceKey = clip.sourceFileId ?? clip.id;
      const fileUrlClipId = fileUrlClipIdBySource.get(sourceKey) ?? clip.id;
      const segment: PlaybackSegment = {
        clipId: clip.id,
        fileUrl: `/api/clips/${fileUrlClipId}/file`,
        wallStartAtMs: effectiveStartMs,
        wallEndAtMs: segmentEndMs,
        clipOffsetSeconds: (clip.mediaStartSeconds ?? 0) + (effectiveStartMs - clip.startAtMs) / 1000,
        playableSeconds: (segmentEndMs - effectiveStartMs) / 1000,
        virtualStartSeconds,
        virtualEndSeconds
      };
      segments.push(segment);
      cursorMs = segmentEndMs;
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
