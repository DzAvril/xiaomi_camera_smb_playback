import { LockKeyhole, MonitorPlay } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraStream, PlaybackPlan, RecordingDay, TimelineSpan } from "../shared/types";
import { api } from "./api";
import { CameraSidebar } from "./components/CameraSidebar";
import { DayTimeline } from "./components/DayTimeline";
import { RangeControls } from "./components/RangeControls";
import { VirtualPlayer } from "./player/VirtualPlayer";

const PLAYBACK_WINDOW_MS = 30 * 60 * 1000;
type AuthStatus = "checking" | "authenticated" | "required";

function todayInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isUnauthorizedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Unauthorized";
}

export default function App() {
  const playbackRequestId = useRef(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInputValue);
  const [timeline, setTimeline] = useState<TimelineSpan[]>([]);
  const [recordedDays, setRecordedDays] = useState<RecordingDay[]>([]);
  const [selectedAtMs, setSelectedAtMs] = useState<number | null>(null);
  const [playheadAtMs, setPlayheadAtMs] = useState<number | null>(null);
  const [playbackPlan, setPlaybackPlan] = useState<PlaybackPlan | null>(null);
  const [isLoadingPlayback, setIsLoadingPlayback] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isLoadingCameras, setIsLoadingCameras] = useState(true);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetPlaybackState() {
    playbackRequestId.current += 1;
    setSelectedAtMs(null);
    setPlayheadAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
  }

  function requireSignIn() {
    resetPlaybackState();
    setAuthStatus("required");
    setCameras([]);
    setSelectedCameraId(null);
    setTimeline([]);
    setRecordedDays([]);
    setIsLoadingTimeline(false);
    setIsRefreshing(false);
    setError(null);
  }

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

        setAuthStatus("authenticated");
        setCameras(nextCameras);
        setSelectedCameraId((current) => current ?? nextCameras[0]?.id ?? null);
      } catch (loadError) {
        if (!cancelled) {
          if (isUnauthorizedError(loadError)) {
            requireSignIn();
          } else {
            setError(loadError instanceof Error ? loadError.message : "Failed to load cameras");
          }
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

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPassword = password.trim();

    if (!nextPassword) {
      setLoginError("Enter the app password.");
      return;
    }

    setIsSigningIn(true);
    setLoginError(null);

    try {
      await api.createSession(nextPassword);
      const nextCameras = await api.listCameras();
      setAuthStatus("authenticated");
      setPassword("");
      setCameras(nextCameras);
      setSelectedCameraId(nextCameras[0]?.id ?? null);
    } catch (signInError) {
      setLoginError(isUnauthorizedError(signInError) ? "Password is incorrect." : "Sign in failed.");
    } finally {
      setIsSigningIn(false);
    }
  }

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId],
  );
  const recordedDates = useMemo(() => recordedDays.map((day) => day.date), [recordedDays]);
  const timelinePlayheadAtMs = playheadAtMs ?? selectedAtMs;
  const updatePlaybackWallTime = useCallback((timestampMs: number | null) => {
    setPlayheadAtMs(timestampMs);
  }, []);

  function selectCamera(cameraId: string) {
    playbackRequestId.current += 1;
    setSelectedCameraId(cameraId);
    setSelectedAtMs(null);
    setPlayheadAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
  }

  function changeDate(nextDate: string) {
    playbackRequestId.current += 1;
    setDate(nextDate);
    setSelectedAtMs(null);
    setPlayheadAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
  }

  useEffect(() => {
    if (!selectedCamera) {
      playbackRequestId.current += 1;
      setTimeline([]);
      setRecordedDays([]);
      setSelectedAtMs(null);
      setPlayheadAtMs(null);
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
      setPlayheadAtMs(null);
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
          if (isUnauthorizedError(loadError)) {
            requireSignIn();
          } else {
            setTimeline([]);
            setError(loadError instanceof Error ? loadError.message : "Failed to load timeline");
          }
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

  useEffect(() => {
    if (!selectedCamera) {
      setRecordedDays([]);
      return;
    }

    let cancelled = false;
    const cameraId = selectedCamera.id;

    async function loadRecordedDays() {
      try {
        const nextRecordedDays = await api.getRecordedDays(cameraId);
        if (!cancelled) {
          setRecordedDays(nextRecordedDays);
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setRecordedDays([]);
        if (isUnauthorizedError(loadError)) {
          requireSignIn();
        } else {
          setError(loadError instanceof Error ? loadError.message : "Failed to load recorded days");
        }
      }
    }

    void loadRecordedDays();

    return () => {
      cancelled = true;
    };
  }, [selectedCamera]);

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
    setPlayheadAtMs(timestampMs);
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
        if (isUnauthorizedError(loadError)) {
          requireSignIn();
        } else {
          setPlaybackError(loadError instanceof Error ? loadError.message : "Failed to load playback plan");
        }
      }
    } finally {
      if (playbackRequestId.current === requestId) {
        setIsLoadingPlayback(false);
      }
    }
  }

  async function refreshIndex() {
    playbackRequestId.current += 1;
    setSelectedAtMs(null);
    setPlayheadAtMs(null);
    setPlaybackPlan(null);
    setPlaybackError(null);
    setIsLoadingPlayback(false);
    setIsRefreshing(true);
    setError(null);

    try {
      await api.refreshIndex();
      const nextCameras = await api.listCameras();
      setAuthStatus("authenticated");
      setCameras(nextCameras);
      setSelectedCameraId((current) => {
        if (current && nextCameras.some((camera) => camera.id === current)) {
          return current;
        }

        return nextCameras[0]?.id ?? null;
      });
    } catch (refreshError) {
      if (isUnauthorizedError(refreshError)) {
        requireSignIn();
      } else {
        setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh index");
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  if (authStatus === "required") {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={signIn}>
          <div className="login-icon" aria-hidden="true">
            <LockKeyhole size={26} />
          </div>
          <div>
            <p className="eyebrow">Xiaomi Camera Playback</p>
            <h1>Sign in</h1>
            <p className="login-copy">Use the app password from the NAS deployment.</p>
          </div>

          <label className="password-control">
            <span>Password</span>
            <input
              aria-label="Password"
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          {loginError ? <div className="status-banner">{loginError}</div> : null}

          <button className="icon-button login-button" disabled={isSigningIn} type="submit">
            {isSigningIn ? "Signing in" : "Sign in"}
          </button>
        </form>
      </main>
    );
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
            recordedDates={recordedDates}
          />
        </header>

        {error ? <div className="status-banner">{error}</div> : null}
        {playbackError ? <div className="status-banner">{playbackError}</div> : null}

        {playbackPlan ? (
          <VirtualPlayer onWallTimeChange={updatePlaybackWallTime} plan={playbackPlan} />
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
          <DayTimeline date={date} spans={timeline} selectedAtMs={timelinePlayheadAtMs} onSelectTime={selectTime} />
        </div>
      </main>
    </div>
  );
}
