import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYBACK_RATES, type PlaybackPlan, type PlaybackRate } from "../../shared/types";
import { findNextSegmentAfter, findSegmentAtVirtualTime } from "./virtualPlayback";

type VirtualPlayerProps = {
  plan: PlaybackPlan | null;
};

type ResolvedVirtualTime = {
  notice: string | null;
  virtualSeconds: number;
};

const SHANGHAI_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Shanghai",
});

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function formatElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatWallTime(plan: PlaybackPlan, virtualSeconds: number): string {
  return SHANGHAI_TIME_FORMATTER.format(new Date(plan.startAtMs + virtualSeconds * 1000));
}

function resolveVirtualTime(plan: PlaybackPlan, requestedSeconds: number): ResolvedVirtualTime {
  const virtualSeconds = clamp(requestedSeconds, 0, plan.durationSeconds);
  const current = findSegmentAtVirtualTime(plan, virtualSeconds);
  if (current) {
    return {
      notice: null,
      virtualSeconds,
    };
  }

  const next = findNextSegmentAfter(plan, virtualSeconds);
  if (next) {
    return {
      notice: `No recording at this time; jumping to ${formatWallTime(plan, next.segment.virtualStartSeconds)}`,
      virtualSeconds: next.segment.virtualStartSeconds,
    };
  }

  return {
    notice: "No more recordings in this selected range.",
    virtualSeconds,
  };
}

export function VirtualPlayer({ plan }: VirtualPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [virtualSeconds, setVirtualSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);

  const currentMatch = useMemo(() => findSegmentAtVirtualTime(plan, virtualSeconds), [plan, virtualSeconds]);
  const durationSeconds = plan?.durationSeconds ?? 0;
  const rangeValue = clamp(virtualSeconds, 0, durationSeconds);

  useEffect(() => {
    setPlaybackRate(1);

    if (!plan) {
      setNotice(null);
      setVirtualSeconds(0);
      return;
    }

    const resolved = resolveVirtualTime(plan, 0);
    setNotice(resolved.notice);
    setVirtualSeconds(resolved.virtualSeconds);
  }, [plan]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentMatch) {
      return;
    }

    video.playbackRate = playbackRate;

    try {
      if (Math.abs(video.currentTime - currentMatch.clipTimeSeconds) > 0.25) {
        video.currentTime = currentMatch.clipTimeSeconds;
      }
    } catch {
      // Some browsers defer seeking until enough metadata is available.
    }
  }, [
    currentMatch?.clipTimeSeconds,
    currentMatch?.segment.clipId,
    currentMatch?.segment.fileUrl,
    currentMatch?.segment.virtualStartSeconds,
    playbackRate,
  ]);

  function moveToVirtualTime(requestedSeconds: number) {
    if (!plan) {
      return;
    }

    const resolved = resolveVirtualTime(plan, requestedSeconds);
    setNotice(resolved.notice);
    setVirtualSeconds(resolved.virtualSeconds);
  }

  function syncVideoToCurrentMatch() {
    const video = videoRef.current;
    if (!video || !currentMatch) {
      return;
    }

    video.playbackRate = playbackRate;

    try {
      video.currentTime = currentMatch.clipTimeSeconds;
    } catch {
      // Keep the source loaded; the next metadata/time update can seek again.
    }
  }

  function updateVirtualTimeFromVideo() {
    const video = videoRef.current;
    if (!video || !plan || !currentMatch) {
      return;
    }

    const nextVirtualSeconds =
      currentMatch.segment.virtualStartSeconds + (video.currentTime - currentMatch.segment.clipOffsetSeconds);

    if (nextVirtualSeconds >= currentMatch.segment.virtualEndSeconds) {
      moveToVirtualTime(currentMatch.segment.virtualEndSeconds);
      return;
    }

    setVirtualSeconds(
      clamp(nextVirtualSeconds, currentMatch.segment.virtualStartSeconds, currentMatch.segment.virtualEndSeconds),
    );
  }

  function handleSegmentEnded() {
    if (!currentMatch) {
      return;
    }

    moveToVirtualTime(currentMatch.segment.virtualEndSeconds);
  }

  if (!plan) {
    return (
      <section className="virtual-player is-empty" aria-label="Virtual player">
        <div className="virtual-player-empty">Select a recorded span to load playback.</div>
      </section>
    );
  }

  return (
    <section className="virtual-player" aria-label="Virtual player">
      <div className="virtual-player-stage">
        {currentMatch ? (
          <video
            className="virtual-player-video"
            controls
            onEnded={handleSegmentEnded}
            onLoadedMetadata={syncVideoToCurrentMatch}
            onTimeUpdate={updateVirtualTimeFromVideo}
            playsInline
            ref={videoRef}
            src={currentMatch.segment.fileUrl}
          />
        ) : (
          <div className="virtual-player-empty">No playable recording is loaded.</div>
        )}
      </div>

      <div className="virtual-player-controls">
        <div className="speed-controls" aria-label="Playback speed">
          {PLAYBACK_RATES.map((rate) => (
            <button
              aria-pressed={playbackRate === rate}
              className={`speed-button${playbackRate === rate ? " is-selected" : ""}`}
              key={rate}
              onClick={() => setPlaybackRate(rate)}
              type="button"
            >
              {rate}x
            </button>
          ))}
        </div>

        <label className="playback-timeline-control">
          <span className="playback-timeline-row">
            <span>Playback timeline</span>
            <span>
              {formatElapsed(rangeValue)} / {formatElapsed(durationSeconds)}
            </span>
          </span>
          <input
            aria-label="Playback timeline"
            max={durationSeconds}
            min={0}
            onChange={(event) => moveToVirtualTime(Number(event.currentTarget.value))}
            step={0.1}
            type="range"
            value={rangeValue}
          />
        </label>
      </div>

      {notice ? (
        <div className="virtual-player-notice" role="status">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
