import { MonitorPlay } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CameraStream, TimelineSpan } from "../shared/types";
import { api } from "./api";
import { CameraSidebar } from "./components/CameraSidebar";
import { DayTimeline } from "./components/DayTimeline";
import { RangeControls } from "./components/RangeControls";

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function App() {
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInputValue);
  const [timeline, setTimeline] = useState<TimelineSpan[]>([]);
  const [selectedAtMs, setSelectedAtMs] = useState<number | null>(null);
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
    setSelectedCameraId(cameraId);
    setSelectedAtMs(null);
  }

  function changeDate(nextDate: string) {
    setDate(nextDate);
    setSelectedAtMs(null);
  }

  useEffect(() => {
    if (!selectedCamera) {
      setTimeline([]);
      setSelectedAtMs(null);
      setIsLoadingTimeline(false);
      return;
    }

    let cancelled = false;
    const cameraId = selectedCamera.id;

    async function loadTimeline() {
      setIsLoadingTimeline(true);
      setSelectedAtMs(null);
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

        <section className="video-placeholder" aria-label="Video player placeholder">
          <MonitorPlay aria-hidden="true" size={42} />
          <div>
            <strong>Video player</strong>
            <span>{selectedCamera ? "Playback controls will attach here in the next task." : "Select a camera to preview."}</span>
          </div>
        </section>

        <div className="day-timeline-region" aria-busy={isLoadingTimeline}>
          <DayTimeline date={date} spans={timeline} selectedAtMs={selectedAtMs} onSelectTime={setSelectedAtMs} />
        </div>
      </main>
    </div>
  );
}
