import { type MouseEvent, useRef, useState } from "react";
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

function formatPreciseTime(timestampMs: number, dayStartMs: number): string {
  const dayEndMs = dayStartMs + DAY_MS;

  if (timestampMs >= dayEndMs) {
    return "24:00:00";
  }

  const value = new Date(Math.max(dayStartMs, timestampMs) + SHANGHAI_OFFSET_MS);
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}:${String(
    value.getUTCSeconds(),
  ).padStart(2, "0")}`;
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

function getSpanTimestampFromClientX(
  element: HTMLElement,
  clientX: number,
  span: TimelineSpan,
  dayStartMs: number,
): { left: number; timestampMs: number } | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const durationMs = Math.max(0, span.endAtMs - span.startAtMs);
  const lastPlayableMs = Math.max(span.startAtMs, span.endAtMs - 1);
  const timestampMs = Math.max(span.startAtMs, Math.min(lastPlayableMs, Math.round(span.startAtMs + ratio * durationMs)));

  return {
    left: toPercent(timestampMs, dayStartMs),
    timestampMs,
  };
}

function formatTimelineCount(count: number): string {
  return `${count} timeline ${count === 1 ? "span" : "spans"}`;
}

export function DayTimeline({ date, spans, selectedAtMs, onSelectTime }: DayTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hoveredTime, setHoveredTime] = useState<{ left: number; timestampMs: number } | null>(null);
  const dayStartMs = getShanghaiDayStart(date);
  const selectedLeft = selectedAtMs === null ? null : toPercent(selectedAtMs, dayStartMs);

  function getTimestampFromClientX(clientX: number): { left: number; timestampMs: number } | null {
    const track = trackRef.current;
    if (!track) {
      return null;
    }

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return null;
    }

    const left = clampPercent(((clientX - rect.left) / rect.width) * 100);
    return {
      left,
      timestampMs: Math.round(dayStartMs + (left / 100) * DAY_MS),
    };
  }

  function updateHoveredTime(event: MouseEvent<HTMLElement>) {
    setHoveredTime(getTimestampFromClientX(event.clientX));
  }

  function updateHoveredSpanTime(event: MouseEvent<HTMLElement>, span: TimelineSpan) {
    event.stopPropagation();
    setHoveredTime(getSpanTimestampFromClientX(event.currentTarget, event.clientX, span, dayStartMs));
  }

  function selectClientTime(event: MouseEvent<HTMLElement>, fallbackTimestampMs?: number) {
    const selected = getTimestampFromClientX(event.clientX);
    onSelectTime(selected?.timestampMs ?? fallbackTimestampMs ?? dayStartMs);
  }

  function selectSpanTime(event: MouseEvent<HTMLElement>, span: TimelineSpan) {
    event.stopPropagation();
    const selected = getSpanTimestampFromClientX(event.currentTarget, event.clientX, span, dayStartMs);
    onSelectTime(selected?.timestampMs ?? span.startAtMs);
  }

  return (
    <section className="day-timeline" aria-label="Day timeline">
      <div className="day-timeline-header">
        <p className="section-label">Day timeline</p>
        <strong>{formatTimelineCount(spans.length)}</strong>
      </div>

      <div
        className="day-timeline-track"
        aria-label="Recorded spans"
        onClick={selectClientTime}
        onMouseLeave={() => setHoveredTime(null)}
        onMouseMove={updateHoveredTime}
        ref={trackRef}
      >
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
                onClick={(event) => selectSpanTime(event, span)}
                onMouseMove={(event) => updateHoveredSpanTime(event, span)}
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

        {hoveredTime === null ? null : (
          <span
            aria-label={`Hovered time ${formatPreciseTime(hoveredTime.timestampMs, dayStartMs)}`}
            className="day-timeline-hover-label"
            style={{ left: `${formatPercent(hoveredTime.left)}%` }}
          >
            {formatPreciseTime(hoveredTime.timestampMs, dayStartMs)}
          </span>
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
