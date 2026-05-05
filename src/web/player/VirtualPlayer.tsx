import { RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PLAYBACK_RATES, type PlaybackPlan, type PlaybackRate } from "../../shared/types";
import { findNextSegmentAfter, findSegmentAtVirtualTime } from "./virtualPlayback";

type VirtualPlayerProps = {
  isLoading?: boolean;
  onWallTimeChange?: (timestampMs: number | null) => void;
  plan: PlaybackPlan | null;
  seekToWallTimeMs?: number | null;
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
const SEEK_STEP_SECONDS = 10;
const PRELOAD_NEXT_SEGMENT_THRESHOLD_SECONDS = 20;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
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

function seekVideo(video: HTMLVideoElement, clipTimeSeconds: number) {
  try {
    video.currentTime = clipTimeSeconds;
  } catch {
    // Some browsers defer seeking until enough metadata is available.
  }
}

function startVideo(video: HTMLVideoElement) {
  const playResult = video.play();
  if (playResult && typeof playResult.catch === "function") {
    playResult.catch(() => {
      // Safari can reject programmatic playback if it loses the user gesture.
    });
  }
}

function PreloadVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;

    return () => {
      if (!video) {
        return;
      }

      video.removeAttribute("src");
      video.load();
    };
  }, []);

  return (
    <video
      aria-label="Preloading next clip"
      className="clip-preloader"
      muted
      playsInline
      preload="auto"
      ref={videoRef}
      src={src}
    />
  );
}

export function VirtualPlayer({ isLoading = false, onWallTimeChange, plan, seekToWallTimeMs = null }: VirtualPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shouldAutoplayRef = useRef(false);
  const [virtualSeconds, setVirtualSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);

  const currentMatch = useMemo(() => findSegmentAtVirtualTime(plan, virtualSeconds), [plan, virtualSeconds]);
  const preloadUrl = useMemo(() => {
    if (!plan || !currentMatch) {
      return null;
    }

    const remainingSeconds = currentMatch.segment.virtualEndSeconds - virtualSeconds;
    if (remainingSeconds > PRELOAD_NEXT_SEGMENT_THRESHOLD_SECONDS) {
      return null;
    }

    const next = findNextSegmentAfter(plan, currentMatch.segment.virtualEndSeconds);
    if (!next || next.segment.fileUrl === currentMatch.segment.fileUrl) {
      return null;
    }

    return next.segment.fileUrl;
  }, [currentMatch, plan, virtualSeconds]);

  useEffect(() => {
    setPlaybackRate(1);

    if (!plan) {
      setNotice(null);
      setVirtualSeconds(0);
      shouldAutoplayRef.current = false;
      onWallTimeChange?.(null);
      return;
    }

    const resolved = resolveVirtualTime(plan, 0);
    setNotice(resolved.notice);
    setVirtualSeconds(resolved.virtualSeconds);
    shouldAutoplayRef.current = true;
    onWallTimeChange?.(plan.startAtMs + resolved.virtualSeconds * 1000);
  }, [onWallTimeChange, plan]);

  useEffect(() => {
    if (!plan) {
      return;
    }

    onWallTimeChange?.(plan.startAtMs + virtualSeconds * 1000);
  }, [onWallTimeChange, plan, virtualSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentMatch) {
      return;
    }

    video.playbackRate = playbackRate;

    if (Math.abs(video.currentTime - currentMatch.clipTimeSeconds) > 0.05) {
      seekVideo(video, currentMatch.clipTimeSeconds);
    }
  }, [
    currentMatch?.clipTimeSeconds,
    currentMatch?.segment.clipId,
    currentMatch?.segment.fileUrl,
    currentMatch?.segment.virtualStartSeconds,
    playbackRate,
  ]);

  useEffect(() => {
    if (!plan || seekToWallTimeMs === null) {
      return;
    }

    const requestedSeconds = (seekToWallTimeMs - plan.startAtMs) / 1000;
    if (requestedSeconds < 0 || requestedSeconds > plan.durationSeconds) {
      return;
    }

    shouldAutoplayRef.current = true;
    moveToVirtualTime(requestedSeconds);
  }, [plan, seekToWallTimeMs]);

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
    seekVideo(video, currentMatch.clipTimeSeconds);

    if (shouldAutoplayRef.current) {
      startVideo(video);
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

  function seekBySeconds(amountSeconds: number) {
    moveToVirtualTime(virtualSeconds + amountSeconds);
  }

  if (!plan) {
    return (
      <section className="virtual-player is-empty" aria-label="Virtual player">
        <div className="virtual-player-empty">Select a recorded span to load playback.</div>
      </section>
    );
  }

  return (
    <section className="virtual-player" aria-busy={isLoading} aria-label="Virtual player">
      <div className="virtual-player-stage">
        {currentMatch ? (
          <video
            autoPlay
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

        {currentMatch ? (
          <div className="virtual-player-controls">
            <div className="seek-controls" aria-label="Seek controls">
              <button
                aria-label="Back 10 seconds"
                className="icon-button seek-button"
                onClick={() => seekBySeconds(-SEEK_STEP_SECONDS)}
                type="button"
              >
                <RotateCcw aria-hidden="true" size={15} />
                10s
              </button>
              <button
                aria-label="Forward 10 seconds"
                className="icon-button seek-button"
                onClick={() => seekBySeconds(SEEK_STEP_SECONDS)}
                type="button"
              >
                <RotateCw aria-hidden="true" size={15} />
                10s
              </button>
            </div>

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

            <span className="wall-time-readout" aria-live="polite">
              {formatWallTime(plan, virtualSeconds)}
            </span>
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="virtual-player-notice" role="status">
          {notice}
        </div>
      ) : null}

      {preloadUrl ? <PreloadVideo key={preloadUrl} src={preloadUrl} /> : null}
    </section>
  );
}
