import { HardDrive, MonitorPlay, Settings, Video } from "lucide-react";
import type { CameraStream } from "../../shared/types";

type CameraSidebarProps = {
  appVersion: string;
  cameras: CameraStream[];
  emptyLabel?: string;
  isSettingsSelected?: boolean;
  onOpenPlayback: () => void;
  onOpenSettings: () => void;
  selectedCameraId: string | null;
  onSelectCamera: (cameraId: string) => void;
};

function formatDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

function summarize(cameras: CameraStream[]) {
  const recordedDates = new Set<string>();

  for (const camera of cameras) {
    for (const date of camera.recordedDates) {
      recordedDates.add(date);
    }
  }

  const totals = cameras.reduce(
    (current, camera) => ({
      seconds: current.seconds + camera.totalSeconds,
      bytes: current.bytes + camera.totalBytes,
    }),
    { seconds: 0, bytes: 0 },
  );

  return { days: recordedDates.size, ...totals };
}

export function CameraSidebar({
  appVersion,
  cameras,
  emptyLabel = "No cameras indexed",
  isSettingsSelected = false,
  onOpenPlayback,
  onOpenSettings,
  selectedCameraId,
  onSelectCamera,
}: CameraSidebarProps) {
  const totals = summarize(cameras);

  return (
    <aside className="camera-sidebar" aria-label="Camera list">
      <nav className="sidebar-nav" aria-label="App sections">
        <button
          aria-pressed={!isSettingsSelected}
          className={`sidebar-nav-button${!isSettingsSelected ? " is-selected" : ""}`}
          onClick={onOpenPlayback}
          type="button"
        >
          <MonitorPlay aria-hidden="true" size={15} />
          Playback
        </button>
        <button
          aria-pressed={isSettingsSelected}
          className={`sidebar-nav-button${isSettingsSelected ? " is-selected" : ""}`}
          onClick={onOpenSettings}
          type="button"
        >
          <Settings aria-hidden="true" size={15} />
          Settings
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="section-label">Cameras</div>
        <div className="camera-list">
          {cameras.length === 0 ? (
            <div className="empty-state">{emptyLabel}</div>
          ) : (
            cameras.map((camera) => {
              const selected = camera.id === selectedCameraId;
              const hasRecordings = camera.clipCount > 0;

              return (
                <button
                  className={`camera-row${selected ? " is-selected" : ""}${!hasRecordings ? " has-no-recordings" : ""}`}
                  key={camera.id}
                  onClick={() => onSelectCamera(camera.id)}
                  type="button"
                >
                  <span className="camera-row-title">
                    <Video aria-hidden="true" size={15} />
                    <span>{camera.alias}</span>
                  </span>
                  <span className="camera-row-sub">
                    {hasRecordings ? `${camera.clipCount} clips · ${formatDuration(camera.totalSeconds)}` : "no recordings"}
                  </span>
                  <span className="camera-row-stats" aria-label={`${camera.alias} recording stats`}>
                    <span>{formatDays(camera.recordedDays)}</span>
                    <span>{formatDuration(camera.totalSeconds)}</span>
                    <span>{formatBytes(camera.totalBytes)}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="sidebar-section sidebar-stats">
        <div className="section-label">Stats</div>
        <dl className="stats-grid">
          <div>
            <dt>Recording days</dt>
            <dd>{formatDays(totals.days)}</dd>
          </div>
          <div>
            <dt>Total duration</dt>
            <dd>{formatDuration(totals.seconds)}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>
              <HardDrive aria-hidden="true" size={14} />
              {formatBytes(totals.bytes)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="sidebar-version" aria-label={`Image version v${appVersion}`}>
        <span>Image version</span>
        <strong>v{appVersion}</strong>
      </div>
    </aside>
  );
}

export const cameraFormatters = {
  formatBytes,
  formatDays,
  formatDuration,
};
