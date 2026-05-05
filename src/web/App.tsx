import { LockKeyhole, MonitorPlay, Settings } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraStream, PlaybackPlan, RecordingDay, TimelineSpan } from "../shared/types";
import { api } from "./api";
import { CameraSidebar } from "./components/CameraSidebar";
import { DayTimeline } from "./components/DayTimeline";
import { RangeControls } from "./components/RangeControls";
import { SettingsPage } from "./components/SettingsPage";
import { VirtualPlayer } from "./player/VirtualPlayer";

const PLAYBACK_WINDOW_MS = 30 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCAL_DATETIME_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
type AuthStatus = "checking" | "authenticated" | "required";
type AppView = "playback" | "settings";

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

function firstVisibleCameraId(cameras: CameraStream[]): string | null {
  return cameras.find((camera) => camera.enabled)?.id ?? null;
}

function defaultRangeStart(date: string): string {
  return `${date}T00:00:00`;
}

function defaultRangeEnd(date: string): string {
  return `${date}T23:59:59`;
}

function parseShanghaiDateTimeInput(value: string): number | null {
  const match = LOCAL_DATETIME_INPUT.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "0"] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - SHANGHAI_OFFSET_MS;
}

function normalizeLocalDateTimeInput(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}

export default function App() {
  const playbackRequestId = useRef(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [view, setView] = useState<AppView>("playback");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [date, setDate] = useState(todayInputValue);
  const [rangeStart, setRangeStart] = useState(() => defaultRangeStart(todayInputValue()));
  const [rangeEnd, setRangeEnd] = useState(() => defaultRangeEnd(todayInputValue()));
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
        setSelectedCameraId((current) => current ?? firstVisibleCameraId(nextCameras));
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
      setSelectedCameraId(firstVisibleCameraId(nextCameras));
    } catch (signInError) {
      setLoginError(isUnauthorizedError(signInError) ? "Password is incorrect." : "Sign in failed.");
    } finally {
      setIsSigningIn(false);
    }
  }

  const visibleCameras = useMemo(() => cameras.filter((camera) => camera.enabled), [cameras]);
  const selectedCamera = useMemo(
    () => visibleCameras.find((camera) => camera.id === selectedCameraId) ?? null,
    [selectedCameraId, visibleCameras],
  );
  const recordedDates = useMemo(() => recordedDays.map((day) => day.date), [recordedDays]);
  const timelinePlayheadAtMs = playheadAtMs ?? selectedAtMs;
  const updatePlaybackWallTime = useCallback((timestampMs: number | null) => {
    setPlayheadAtMs(timestampMs);
  }, []);

  useEffect(() => {
    setSelectedCameraId((current) => {
      if (current && visibleCameras.some((camera) => camera.id === current)) {
        return current;
      }

      return firstVisibleCameraId(visibleCameras);
    });
  }, [visibleCameras]);

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
    setRangeStart(defaultRangeStart(nextDate));
    setRangeEnd(defaultRangeEnd(nextDate));
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

  async function loadPlaybackRange(start: string, end: string, selectedTimestampMs: number) {
    if (!selectedCamera) {
      return;
    }

    const requestId = playbackRequestId.current + 1;
    playbackRequestId.current = requestId;
    const cameraId = selectedCamera.id;

    setSelectedAtMs(selectedTimestampMs);
    setPlayheadAtMs(selectedTimestampMs);
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

  async function selectTime(timestampMs: number) {
    await loadPlaybackRange(
      new Date(timestampMs).toISOString(),
      new Date(timestampMs + PLAYBACK_WINDOW_MS).toISOString(),
      timestampMs,
    );
  }

  async function playCustomRange() {
    const startAtMs = parseShanghaiDateTimeInput(rangeStart);
    const endAtMs = parseShanghaiDateTimeInput(rangeEnd);
    if (startAtMs === null || endAtMs === null || endAtMs <= startAtMs) {
      setPlaybackError("Invalid custom playback range");
      return;
    }

    await loadPlaybackRange(normalizeLocalDateTimeInput(rangeStart), normalizeLocalDateTimeInput(rangeEnd), startAtMs);
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
        if (current && nextCameras.some((camera) => camera.enabled && camera.id === current)) {
          return current;
        }

        return firstVisibleCameraId(nextCameras);
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

  async function updateCameraSettings(cameraId: string, update: { alias: string; enabled: boolean }) {
    try {
      const updated = await api.updateCamera(cameraId, update);
      setCameras((current) => {
        const nextCameras = current.map((camera) => (camera.id === cameraId ? { ...camera, ...updated } : camera));
        setSelectedCameraId((currentCameraId) => {
          if (currentCameraId && nextCameras.some((camera) => camera.enabled && camera.id === currentCameraId)) {
            return currentCameraId;
          }

          return firstVisibleCameraId(nextCameras);
        });
        return nextCameras;
      });
    } catch (updateError) {
      if (isUnauthorizedError(updateError)) {
        requireSignIn();
      }

      throw updateError;
    }
  }

  async function changeAppPassword(currentPassword: string, newPassword: string) {
    await api.changePassword(currentPassword, newPassword);
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
      <CameraSidebar
        cameras={visibleCameras}
        emptyLabel={cameras.length === 0 ? "No cameras indexed" : "No cameras visible"}
        onSelectCamera={selectCamera}
        selectedCameraId={selectedCameraId}
      />

      <main className={`playback-panel${view === "settings" ? " is-settings-view" : ""}`}>
        <header className="playback-header">
          <div>
            <p className="eyebrow">{view === "settings" ? "Configuration" : "Playback"}</p>
            <h1>
              {view === "settings"
                ? "Settings"
                : selectedCamera?.alias ?? (isLoadingCameras ? "Loading cameras" : "No camera selected")}
            </h1>
            {view === "settings" ? (
              <p className="camera-context">{cameras.length} mounted streams indexed.</p>
            ) : selectedCamera ? (
              <p className="camera-context">
                {selectedCamera.rootPath} · channel {selectedCamera.channel}
              </p>
            ) : (
              <p className="camera-context">Index cameras to begin reviewing recordings.</p>
            )}
          </div>

          <div className="header-actions">
            <div className="view-switch" aria-label="View">
              <button
                aria-pressed={view === "playback"}
                className={`view-switch-button${view === "playback" ? " is-selected" : ""}`}
                onClick={() => setView("playback")}
                type="button"
              >
                <MonitorPlay aria-hidden="true" size={15} />
                Playback
              </button>
              <button
                aria-pressed={view === "settings"}
                className={`view-switch-button${view === "settings" ? " is-selected" : ""}`}
                onClick={() => setView("settings")}
                type="button"
              >
                <Settings aria-hidden="true" size={15} />
                Settings
              </button>
            </div>

            {view === "playback" ? (
              <RangeControls
                date={date}
                disabled={!selectedCamera}
                isRefreshing={isRefreshing}
                onDateChange={changeDate}
                onPlayRange={() => void playCustomRange()}
                onRefresh={refreshIndex}
                rangeEnd={rangeEnd}
                rangeStart={rangeStart}
                recordedDates={recordedDates}
                onRangeEndChange={setRangeEnd}
                onRangeStartChange={setRangeStart}
              />
            ) : null}
          </div>
        </header>

        {error ? <div className="status-banner">{error}</div> : null}
        {playbackError ? <div className="status-banner">{playbackError}</div> : null}

        {view === "settings" ? (
          <SettingsPage
            cameras={cameras}
            onChangePassword={changeAppPassword}
            onUpdateCamera={updateCameraSettings}
          />
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
