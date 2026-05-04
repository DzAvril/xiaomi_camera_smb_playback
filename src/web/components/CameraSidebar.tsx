import { HardDrive, Video } from "lucide-react";
import type { CameraStream } from "../../shared/types";

type CameraSidebarProps = {
  cameras: CameraStream[];
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
  return cameras.reduce(
    (totals, camera) => ({
      days: totals.days + camera.recordedDays,
      seconds: totals.seconds + camera.totalSeconds,
      bytes: totals.bytes + camera.totalBytes,
    }),
    { days: 0, seconds: 0, bytes: 0 },
  );
}

export function CameraSidebar({ cameras, selectedCameraId, onSelectCamera }: CameraSidebarProps) {
  const totals = summarize(cameras);

  return (
    <aside className="camera-sidebar" aria-label="Camera list">
      <div className="sidebar-section">
        <div className="section-label">Cameras</div>
        <div className="camera-list">
          {cameras.length === 0 ? (
            <div className="empty-state">No cameras indexed</div>
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
                  <span className="camera-row-meta">
                    {camera.rootId} · {camera.channel}
                  </span>
                  <span className="camera-row-sub">
                    {hasRecordings ? `${camera.clipCount} clips · ${formatDuration(camera.totalSeconds)}` : "no recordings"}
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
    </aside>
  );
}

export const cameraFormatters = {
  formatBytes,
  formatDays,
  formatDuration,
};
