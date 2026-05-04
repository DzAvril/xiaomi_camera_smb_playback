import type { TimelineSpan } from "../../shared/types";

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const TICK_LABELS = ["00:00", "06:00", "12:00", "18:00", "24:00"] as const;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type DayTimelineProps = {
  date: string;
  spans: TimelineSpan[];
  selectedAtMs: number | null;
  onSelectTime(timestampMs: number): void;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function getShanghaiDayStart(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    return Number.NaN;
  }

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) - SHANGHAI_OFFSET_MS;
}

function formatTime(timestampMs: number, dayStartMs: number): string {
  const dayEndMs = dayStartMs + DAY_MS;

  if (timestampMs >= dayEndMs) {
    return "24:00";
  }

  const value = new Date(Math.max(dayStartMs, timestampMs) + SHANGHAI_OFFSET_MS);
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}

function toPercent(timestampMs: number, dayStartMs: number): number {
  return clampPercent(((timestampMs - dayStartMs) / DAY_MS) * 100);
}

function formatPercent(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function getSpanPosition(span: TimelineSpan, dayStartMs: number): { left: number; width: number } {
  const left = toPercent(span.startAtMs, dayStartMs);
  const right = toPercent(span.endAtMs, dayStartMs);

  return {
    left,
    width: Math.max(0.35, right - left),
  };
}

function getSpanLabel(span: TimelineSpan, dayStartMs: number): string {
  return `${formatTime(span.startAtMs, dayStartMs)} - ${formatTime(span.endAtMs, dayStartMs)}`;
}

function formatTimelineCount(count: number): string {
  return `${count} timeline ${count === 1 ? "span" : "spans"}`;
}

export function DayTimeline({ date, spans, selectedAtMs, onSelectTime }: DayTimelineProps) {
  const dayStartMs = getShanghaiDayStart(date);
  const selectedLeft = selectedAtMs === null ? null : toPercent(selectedAtMs, dayStartMs);

  return (
    <section className="day-timeline" aria-label="Day timeline">
      <div className="day-timeline-header">
        <p className="section-label">Day timeline</p>
        <strong>{formatTimelineCount(spans.length)}</strong>
      </div>

      <div className="day-timeline-track" aria-label="Recorded spans">
        {spans.length === 0 ? (
          <span className="day-timeline-empty" aria-hidden="true" />
        ) : (
          spans.map((span) => {
            const label = getSpanLabel(span, dayStartMs);
            const { left, width } = getSpanPosition(span, dayStartMs);

            return (
              <button
                aria-label={`Recorded span ${label}`}
                className="day-timeline-span"
                key={`${span.startAtMs}-${span.endAtMs}`}
                onClick={() => onSelectTime(span.startAtMs)}
                style={{ left: `${formatPercent(left)}%`, width: `${formatPercent(width)}%` }}
                title={label}
                type="button"
              >
                <span className="visually-hidden">{label}</span>
              </button>
            );
          })
        )}

        {selectedAtMs === null || selectedLeft === null ? null : (
          <span
            aria-label={`Selected time ${formatTime(selectedAtMs, dayStartMs)}`}
            className="day-timeline-playhead"
            style={{ left: `${formatPercent(selectedLeft)}%` }}
          />
        )}
      </div>

      <div className="day-timeline-labels" aria-hidden="true">
        {TICK_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </section>
  );
}
