import { MonitorPlay } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CameraStream, TimelineSpan } from "../shared/types";
import { api } from "./api";
import { CameraSidebar } from "./components/CameraSidebar";
import { RangeControls } from "./components/RangeControls";

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimelineCount(count: number): string {
  return `${count} timeline ${count === 1 ? "span" : "spans"}`;
}

export default function App() {
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInputValue);
  const [timeline, setTimeline] = useState<TimelineSpan[]>([]);
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

  useEffect(() => {
    if (!selectedCamera) {
      setTimeline([]);
      return;
    }

    let cancelled = false;
    const cameraId = selectedCamera.id;

    async function loadTimeline() {
      setIsLoadingTimeline(true);
      setError(null);

      try {
        const nextTimeline = await api.getTimeline(cameraId, date);
        if (!cancelled) {
          setTimeline(nextTimeline);
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
      <CameraSidebar cameras={cameras} onSelectCamera={setSelectedCameraId} selectedCameraId={selectedCameraId} />

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
            onDateChange={setDate}
            onRefresh={refreshIndex}
          />
        </header>

        {error ? <div className="status-banner">{error}</div> : null}

        <section className="video-placeholder" aria-label="Video player placeholder">
          <MonitorPlay aria-hidden="true" size={42} />
          <div>
            <strong>Video player</strong>
            <span>{selectedCamera ? "Playback controls will attach here in the next task." : "Select a camera to preview."}</span>
          </div>
        </section>

        <section className="timeline-summary" aria-label="Timeline summary">
          <div>
            <p className="section-label">Day timeline</p>
            <strong>{isLoadingTimeline ? "Loading timeline" : formatTimelineCount(timeline.length)}</strong>
          </div>
          <div className="timeline-track" aria-hidden="true">
            {timeline.length === 0 ? (
              <span className="timeline-empty" />
            ) : (
              timeline.slice(0, 12).map((span) => {
                const dayStart = new Date(`${date}T00:00:00+08:00`).getTime();
                const left = ((span.startAtMs - dayStart) / 86_400_000) * 100;
                const width = (span.durationSeconds / 86_400) * 100;

                return (
                  <span
                    className="timeline-span"
                    key={`${span.startAtMs}-${span.endAtMs}`}
                    style={{ left: `${Math.max(0, Math.min(100, left))}%`, width: `${Math.max(0.5, width)}%` }}
                  />
                );
              })
            )}
          </div>
          <div className="timeline-labels">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </section>
      </main>
    </div>
  );
}
