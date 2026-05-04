import { MonitorPlay } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CameraStream, PlaybackPlan, TimelineSpan } from "../shared/types";
import { api } from "./api";
import { CameraSidebar } from "./components/CameraSidebar";
import { DayTimeline } from "./components/DayTimeline";
import { RangeControls } from "./components/RangeControls";
import { VirtualPlayer } from "./player/VirtualPlayer";

const PLAYBACK_WINDOW_MS = 30 * 60 * 1000;

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function App() {
  const playbackRequestId = useRef(0);
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInputValue);
  const [timeline, setTimeline] = useState<TimelineSpan[]>([]);
  const [selectedAtMs, setSelectedAtMs] = useState<number | null>(null);
  const [playbackPlan, setPlaybackPlan] = useState<PlaybackPlan | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isLoadingCameras, setIsLoadingCameras] = useState(true);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCameras() {
      setIsLoadingCameras(true);
      setError(null);

      try {
        const nextCameras = await api.listCameras();
        if (cancelled) {
          return;
        }

        setCameras(nextCameras);
        setSelectedCameraId((current) => current ?? nextCameras[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load cameras");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCameras(false);
        }
      }
    }

    void loadCameras();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId],
  );

  function selectCamera(cameraId: string) {
    playbackRequestId.current += 1;
    setSelectedCameraId(cameraId);
    setSelectedAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
  }

  function changeDate(nextDate: string) {
    playbackRequestId.current += 1;
    setDate(nextDate);
    setSelectedAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
  }

  useEffect(() => {
    if (!selectedCamera) {
      playbackRequestId.current += 1;
      setTimeline([]);
      setSelectedAtMs(null);
      setPlaybackPlan(null);
      setPlaybackError(null);
      setIsLoadingPlayback(false);
      setIsLoadingTimeline(false);
      return;
    }

    let cancelled = false;
    const cameraId = selectedCamera.id;

    async function loadTimeline() {
      playbackRequestId.current += 1;
      setIsLoadingTimeline(true);
      setTimeline([]);
      setSelectedAtMs(null);
      setPlaybackPlan(null);
      setPlaybackError(null);
      setIsLoadingPlayback(false);
      setError(null);

      try {
        const nextTimeline = await api.getTimeline(cameraId, date);
        if (!cancelled) {
          setTimeline(nextTimeline);
          if (nextTimeline.length === 0) {
            setSelectedAtMs(null);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setTimeline([]);
          setError(loadError instanceof Error ? loadError.message : "Failed to load timeline");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTimeline(false);
        }
      }
    }

    void loadTimeline();

    return () => {
      cancelled = true;
    };
  }, [date, selectedCamera]);

  async function selectTime(timestampMs: number) {
    if (!selectedCamera) {
      return;
    }

    const requestId = playbackRequestId.current + 1;
    playbackRequestId.current = requestId;
    const cameraId = selectedCamera.id;
    const start = new Date(timestampMs).toISOString();
    const end = new Date(timestampMs + PLAYBACK_WINDOW_MS).toISOString();

    setSelectedAtMs(timestampMs);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(true);

    try {
      const nextPlan = await api.getPlaybackPlan(cameraId, start, end);
      if (playbackRequestId.current === requestId) {
        setPlaybackPlan(nextPlan);
      }
    } catch (loadError) {
      if (playbackRequestId.current === requestId) {
        setPlaybackError(loadError instanceof Error ? loadError.message : "Failed to load playback plan");
      }
    } finally {
      if (playbackRequestId.current === requestId) {
        setIsLoadingPlayback(false);
      }
    }
  }

  async function refreshIndex() {
    setIsRefreshing(true);
    setError(null);

    try {
      await api.refreshIndex();
      const nextCameras = await api.listCameras();
      setCameras(nextCameras);
      setSelectedCameraId((current) => {
        if (current && nextCameras.some((camera) => camera.id === current)) {
          return current;
        }

        return nextCameras[0]?.id ?? null;
      });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh index");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="app-shell">
      <CameraSidebar cameras={cameras} onSelectCamera={selectCamera} selectedCameraId={selectedCameraId} />

      <main className="playback-panel">
        <header className="playback-header">
          <div>
            <p className="eyebrow">Playback</p>
            <h1>{selectedCamera?.alias ?? (isLoadingCameras ? "Loading cameras" : "No camera selected")}</h1>
            {selectedCamera ? (
              <p className="camera-context">
                {selectedCamera.rootPath} · channel {selectedCamera.channel}
              </p>
            ) : (
              <p className="camera-context">Index cameras to begin reviewing recordings.</p>
            )}
          </div>

          <RangeControls
            date={date}
            disabled={!selectedCamera}
            isRefreshing={isRefreshing}
            onDateChange={changeDate}
            onRefresh={refreshIndex}
          />
        </header>

        {error ? <div className="status-banner">{error}</div> : null}
        {playbackError ? <div className="status-banner">{playbackError}</div> : null}

        {playbackPlan ? (
          <VirtualPlayer plan={playbackPlan} />
        ) : (
          <section className="video-placeholder" aria-busy={isLoadingPlayback} aria-label="Video player placeholder">
            <MonitorPlay aria-hidden="true" size={42} />
            <div>
              <strong>Video player</strong>
              <span>
                {isLoadingPlayback
                  ? "Loading playback for the selected range."
                  : selectedCamera
                    ? selectedAtMs === null
                      ? "Select a recorded span on the timeline."
                      : "Select another recorded span to retry playback."
                    : "Select a camera to preview."}
              </span>
            </div>
          </section>
        )}

        <div className="day-timeline-region" aria-busy={isLoadingTimeline}>
          <DayTimeline date={date} spans={timeline} selectedAtMs={selectedAtMs} onSelectTime={selectTime} />
        </div>
      </main>
    </div>
  );
}
