import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { type MouseEvent, type PointerEvent, type WheelEvent, useEffect, useRef, useState } from "react";
import type { TimelineSpan } from "../../shared/types";

const DAY_MS = 86_400_000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
const ZOOM_STEP = 2;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type DayTimelineProps = {
  date: string;
  label?: string;
  spans: TimelineSpan[];
  selectedAtMs: number | null;
  timelineEndAtMs?: number;
  timelineStartAtMs?: number;
  onSelectTime(timestampMs: number): void;
};

type PointerPosition = {
  clientX: number;
  clientY: number;
};

type PinchGesture = {
  centerX: number;
  distance: number;
};

type PinchState = {
  centerTimestampMs: number;
  startDistance: number;
  startZoom: number;
};

type MouseDragState = {
  didPan: boolean;
  startClientX: number;
  startViewStartMs: number;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function clampZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM);
}

function getVisibleDurationMs(zoom: number, timelineDurationMs: number): number {
  return timelineDurationMs / zoom;
}

function clampViewStartMs(value: number, zoom: number, timelineDurationMs: number): number {
  return clamp(value, 0, timelineDurationMs - getVisibleDurationMs(zoom, timelineDurationMs));
}

function getShanghaiDayStart(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    return Number.NaN;
  }

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day)) - SHANGHAI_OFFSET_MS;
}

function getShanghaiParts(timestampMs: number): { day: string; hour: string; minute: string; month: string; second: string } {
  const value = new Date(timestampMs + SHANGHAI_OFFSET_MS);

  return {
    day: String(value.getUTCDate()).padStart(2, "0"),
    hour: String(value.getUTCHours()).padStart(2, "0"),
    minute: String(value.getUTCMinutes()).padStart(2, "0"),
    month: String(value.getUTCMonth() + 1).padStart(2, "0"),
    second: String(value.getUTCSeconds()).padStart(2, "0"),
  };
}

function getShanghaiDateKey(timestampMs: number): string {
  const value = new Date(timestampMs + SHANGHAI_OFFSET_MS);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(
    value.getUTCDate(),
  ).padStart(2, "0")}`;
}

function formatTime(timestampMs: number, timelineEndMs: number, includeDate: boolean): string {
  if (!includeDate && timestampMs >= timelineEndMs) {
    return "24:00";
  }

  const value = getShanghaiParts(timestampMs);
  const time = `${value.hour}:${value.minute}`;
  return includeDate ? `${value.month}-${value.day} ${time}` : time;
}

function formatPreciseTime(timestampMs: number, timelineEndMs: number, includeDate: boolean): string {
  if (!includeDate && timestampMs >= timelineEndMs) {
    return "24:00:00";
  }

  const value = getShanghaiParts(timestampMs);
  const time = `${value.hour}:${value.minute}:${value.second}`;
  return includeDate ? `${value.month}-${value.day} ${time}` : time;
}

function toVisiblePercent(timestampMs: number, visibleStartMs: number, visibleDurationMs: number): number {
  return clampPercent(((timestampMs - visibleStartMs) / visibleDurationMs) * 100);
}

function formatPercent(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function formatZoomLevel(zoom: number): string {
  const rounded = Math.round(zoom * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}x`;
}

function getSpanPosition(
  span: TimelineSpan,
  visibleStartMs: number,
  visibleDurationMs: number,
): { left: number; renderedEndAtMs: number; renderedStartAtMs: number; width: number } | null {
  const visibleEndMs = visibleStartMs + visibleDurationMs;
  const renderedStartAtMs = Math.max(span.startAtMs, visibleStartMs);
  const renderedEndAtMs = Math.min(span.endAtMs, visibleEndMs);

  if (renderedEndAtMs <= renderedStartAtMs) {
    return null;
  }

  const left = toVisiblePercent(renderedStartAtMs, visibleStartMs, visibleDurationMs);
  const right = toVisiblePercent(renderedEndAtMs, visibleStartMs, visibleDurationMs);

  return {
    left,
    renderedEndAtMs,
    renderedStartAtMs,
    width: Math.max(0.35, right - left),
  };
}

function getSpanLabel(startAtMs: number, endAtMs: number, timelineEndMs: number, includeDate: boolean): string {
  return `${formatTime(startAtMs, timelineEndMs, includeDate)} - ${formatTime(endAtMs, timelineEndMs, includeDate)}`;
}

function getSpanTimestampFromClientX(
  element: HTMLElement,
  clientX: number,
  renderedStartAtMs: number,
  renderedEndAtMs: number,
  visibleStartMs: number,
  visibleDurationMs: number,
): { left: number; timestampMs: number } | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const durationMs = Math.max(0, renderedEndAtMs - renderedStartAtMs);
  const lastPlayableMs = Math.max(renderedStartAtMs, renderedEndAtMs - 1);
  const timestampMs = Math.max(renderedStartAtMs, Math.min(lastPlayableMs, Math.round(renderedStartAtMs + ratio * durationMs)));

  return {
    left: toVisiblePercent(timestampMs, visibleStartMs, visibleDurationMs),
    timestampMs,
  };
}

function formatTimelineCount(count: number): string {
  return `${count} timeline ${count === 1 ? "span" : "spans"}`;
}

function getPinchGesture(pointers: Map<number, PointerPosition>): PinchGesture | null {
  const [first, second] = Array.from(pointers.values());
  if (!first || !second) {
    return null;
  }

  return {
    centerX: (first.clientX + second.clientX) / 2,
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
  };
}

function isTouchSelectionPointer(event: PointerEvent<HTMLElement>): boolean {
  return event.pointerType !== "mouse";
}

export function DayTimeline({
  date,
  label = "Day timeline",
  spans,
  selectedAtMs,
  timelineEndAtMs,
  timelineStartAtMs,
  onSelectTime,
}: DayTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const activePointersRef = useRef(new Map<number, PointerPosition>());
  const dragPointerIdRef = useRef<number | null>(null);
  const mouseDragRef = useRef<MouseDragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const suppressClicksUntilRef = useRef(0);
  const [hoveredTime, setHoveredTime] = useState<{ left: number; timestampMs: number } | null>(null);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const dayStartMs = getShanghaiDayStart(date);
  const timelineStartMs = timelineStartAtMs ?? dayStartMs;
  const rawTimelineEndMs = timelineEndAtMs && timelineEndAtMs > timelineStartMs ? timelineEndAtMs : timelineStartMs + DAY_MS;
  const timelineEndMs = rawTimelineEndMs;
  const timelineDurationMs = Math.max(1, timelineEndMs - timelineStartMs);
  const includeDateInLabels = getShanghaiDateKey(timelineStartMs) !== getShanghaiDateKey(timelineEndMs - 1);
  const visibleDurationMs = getVisibleDurationMs(zoom, timelineDurationMs);
  const clampedViewStartMs = clampViewStartMs(viewStartMs, zoom, timelineDurationMs);
  const visibleStartMs = timelineStartMs + clampedViewStartMs;
  const visibleEndMs = visibleStartMs + visibleDurationMs;
  const selectedVisibleLeft =
    selectedAtMs === null || selectedAtMs < visibleStartMs || selectedAtMs > visibleEndMs
      ? null
      : toVisiblePercent(selectedAtMs, visibleStartMs, visibleDurationMs);
  const visibleTimeRangeLabel = `${formatTime(visibleStartMs, timelineEndMs, includeDateInLabels)} - ${formatTime(
    visibleEndMs,
    timelineEndMs,
    includeDateInLabels,
  )}`;
  const tickLabels = Array.from({ length: 5 }, (_, index) =>
    formatTime(visibleStartMs + (visibleDurationMs / 4) * index, timelineEndMs, includeDateInLabels),
  );

  useEffect(() => {
    setZoom(MIN_ZOOM);
    setViewStartMs(0);
  }, [timelineEndMs, timelineStartMs]);

  useEffect(() => {
    if (selectedAtMs === null || zoom <= MIN_ZOOM || !Number.isFinite(timelineStartMs)) {
      return;
    }

    const selectedOffsetMs = clamp(selectedAtMs - timelineStartMs, 0, timelineDurationMs);
    setViewStartMs(clampViewStartMs(selectedOffsetMs - visibleDurationMs / 2, zoom, timelineDurationMs));
  }, [selectedAtMs, timelineDurationMs, timelineStartMs, visibleDurationMs, zoom]);

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
      timestampMs: Math.round(visibleStartMs + (left / 100) * visibleDurationMs),
    };
  }

  function updateHoveredTime(event: MouseEvent<HTMLElement>) {
    setHoveredTime(getTimestampFromClientX(event.clientX));
  }

  function updateHoveredSpanTime(event: MouseEvent<HTMLElement>, span: TimelineSpan) {
    event.stopPropagation();
    const position = getSpanPosition(span, visibleStartMs, visibleDurationMs);
    if (!position) {
      setHoveredTime(null);
      return;
    }

    setHoveredTime(
      getSpanTimestampFromClientX(
        event.currentTarget,
        event.clientX,
        position.renderedStartAtMs,
        position.renderedEndAtMs,
        visibleStartMs,
        visibleDurationMs,
      ),
    );
  }

  function selectClientTime(event: MouseEvent<HTMLElement>, fallbackTimestampMs?: number) {
    if (Date.now() < suppressClicksUntilRef.current) {
      return;
    }

    const selected = getTimestampFromClientX(event.clientX);
    onSelectTime(selected?.timestampMs ?? fallbackTimestampMs ?? visibleStartMs);
  }

  function selectSpanTime(event: MouseEvent<HTMLElement>, span: TimelineSpan) {
    event.stopPropagation();
    if (Date.now() < suppressClicksUntilRef.current) {
      return;
    }

    const position = getSpanPosition(span, visibleStartMs, visibleDurationMs);
    if (!position) {
      return;
    }

    const selected = getSpanTimestampFromClientX(
      event.currentTarget,
      event.clientX,
      position.renderedStartAtMs,
      position.renderedEndAtMs,
      visibleStartMs,
      visibleDurationMs,
    );
    onSelectTime(selected?.timestampMs ?? span.startAtMs);
  }

  function getZoomCenterTimestamp(): number {
    return selectedAtMs ?? hoveredTime?.timestampMs ?? visibleStartMs + visibleDurationMs / 2;
  }

  function applyZoom(nextZoom: number, centerTimestampMs: number) {
    const clampedZoom = clampZoom(nextZoom);
    const nextVisibleDurationMs = getVisibleDurationMs(clampedZoom, timelineDurationMs);
    const centerOffsetMs = clamp(centerTimestampMs - timelineStartMs, 0, timelineDurationMs);

    setZoom(clampedZoom);
    setViewStartMs(clampViewStartMs(centerOffsetMs - nextVisibleDurationMs / 2, clampedZoom, timelineDurationMs));
  }

  function zoomIn() {
    applyZoom(zoom * ZOOM_STEP, getZoomCenterTimestamp());
  }

  function zoomOut() {
    applyZoom(zoom / ZOOM_STEP, getZoomCenterTimestamp());
  }

  function resetZoom() {
    setZoom(MIN_ZOOM);
    setViewStartMs(0);
  }

  function selectPointerTime(clientX: number) {
    const selected = getTimestampFromClientX(clientX);
    if (!selected) {
      return;
    }

    setHoveredTime(selected);
    onSelectTime(selected.timestampMs);
  }

  function updateActivePointer(event: PointerEvent<HTMLElement>) {
    activePointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!isTouchSelectionPointer(event)) {
      if (event.button !== 0 || zoom <= MIN_ZOOM) {
        return;
      }

      event.preventDefault();
      mouseDragRef.current = {
        didPan: false,
        startClientX: event.clientX,
        startViewStartMs: clampedViewStartMs,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    event.preventDefault();
    updateActivePointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (activePointersRef.current.size === 1) {
      dragPointerIdRef.current = event.pointerId;
      pinchRef.current = null;
      selectPointerTime(event.clientX);
      return;
    }

    const gesture = getPinchGesture(activePointersRef.current);
    if (!gesture || gesture.distance <= 0) {
      return;
    }

    dragPointerIdRef.current = null;
    pinchRef.current = {
      centerTimestampMs: getTimestampFromClientX(gesture.centerX)?.timestampMs ?? getZoomCenterTimestamp(),
      startDistance: gesture.distance,
      startZoom: zoom,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (!isTouchSelectionPointer(event)) {
      const drag = mouseDragRef.current;
      const track = trackRef.current;
      if (!drag || !track) {
        return;
      }

      event.preventDefault();
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const deltaX = event.clientX - drag.startClientX;
      if (Math.abs(deltaX) > 3) {
        drag.didPan = true;
        suppressClicksUntilRef.current = Date.now() + 250;
      }

      const msPerPixel = visibleDurationMs / rect.width;
      setViewStartMs(clampViewStartMs(drag.startViewStartMs - deltaX * msPerPixel, zoom, timelineDurationMs));
      return;
    }

    if (!activePointersRef.current.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    updateActivePointer(event);

    const gesture = getPinchGesture(activePointersRef.current);
    if (gesture && pinchRef.current && gesture.distance > 0 && activePointersRef.current.size >= 2) {
      applyZoom(pinchRef.current.startZoom * (gesture.distance / pinchRef.current.startDistance), pinchRef.current.centerTimestampMs);
      return;
    }

    if (dragPointerIdRef.current === event.pointerId) {
      selectPointerTime(event.clientX);
    }
  }

  function handlePointerEnd(event: PointerEvent<HTMLElement>) {
    if (!isTouchSelectionPointer(event)) {
      if (mouseDragRef.current?.didPan) {
        suppressClicksUntilRef.current = Date.now() + 500;
      }

      mouseDragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }

    activePointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    suppressClicksUntilRef.current = Date.now() + 500;

    if (dragPointerIdRef.current === event.pointerId) {
      dragPointerIdRef.current = null;
    }

    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    event.preventDefault();

    if (event.ctrlKey) {
      const centerTimestampMs = getTimestampFromClientX(event.clientX)?.timestampMs ?? getZoomCenterTimestamp();
      applyZoom(event.deltaY < 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, centerTimestampMs);
      return;
    }

    if (zoom <= MIN_ZOOM) {
      return;
    }

    const panPixels = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const msPerPixel = visibleDurationMs / rect.width;
    setViewStartMs((current) => clampViewStartMs(current + panPixels * msPerPixel, zoom, timelineDurationMs));
  }

  return (
    <section className="day-timeline" aria-label="Day timeline">
      <div className="day-timeline-header">
        <div className="day-timeline-title">
          <p className="section-label">{label}</p>
          <strong>{formatTimelineCount(spans.length)}</strong>
        </div>
        <div className="day-timeline-tools" aria-label="Timeline zoom controls">
          <span className="day-timeline-window" aria-label={`Visible time ${visibleTimeRangeLabel}`}>
            {visibleTimeRangeLabel}
          </span>
          <span className="day-timeline-zoom" aria-label={`Timeline zoom ${formatZoomLevel(zoom)}`}>
            {formatZoomLevel(zoom)}
          </span>
          <button
            aria-label="Zoom out day timeline"
            className="icon-button timeline-zoom-button"
            disabled={zoom <= MIN_ZOOM}
            onClick={zoomOut}
            type="button"
          >
            <ZoomOut aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="Zoom in day timeline"
            className="icon-button timeline-zoom-button"
            disabled={zoom >= MAX_ZOOM}
            onClick={zoomIn}
            type="button"
          >
            <ZoomIn aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="Reset day timeline zoom"
            className="icon-button timeline-zoom-button"
            disabled={zoom === MIN_ZOOM && clampedViewStartMs === 0}
            onClick={resetZoom}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
          </button>
        </div>
      </div>

      <div
        className="day-timeline-track"
        aria-label="Recorded spans"
        onClick={selectClientTime}
        onMouseLeave={() => setHoveredTime(null)}
        onMouseMove={updateHoveredTime}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onWheel={handleWheel}
        ref={trackRef}
      >
        {spans.length === 0 ? (
          <span className="day-timeline-empty" aria-hidden="true" />
        ) : (
          spans.map((span) => {
            const position = getSpanPosition(span, visibleStartMs, visibleDurationMs);

            if (!position) {
              return null;
            }

            const label = getSpanLabel(
              position.renderedStartAtMs,
              position.renderedEndAtMs,
              timelineEndMs,
              includeDateInLabels,
            );

            return (
              <button
                aria-label={`Recorded span ${label}`}
                className="day-timeline-span"
                key={`${span.startAtMs}-${span.endAtMs}`}
                onClick={(event) => selectSpanTime(event, span)}
                onMouseMove={(event) => updateHoveredSpanTime(event, span)}
                style={{ left: `${formatPercent(position.left)}%`, width: `${formatPercent(position.width)}%` }}
                title={label}
                type="button"
              >
                <span className="visually-hidden">{label}</span>
              </button>
            );
          })
        )}

        {selectedAtMs === null || selectedVisibleLeft === null ? null : (
          <span
            aria-label={`Selected time ${formatTime(selectedAtMs, timelineEndMs, includeDateInLabels)}`}
            className="day-timeline-playhead"
            style={{ left: `${formatPercent(selectedVisibleLeft)}%` }}
          />
        )}

        {hoveredTime === null ? null : (
          <span
            aria-label={`Hovered time ${formatPreciseTime(hoveredTime.timestampMs, timelineEndMs, includeDateInLabels)}`}
            className="day-timeline-hover-label"
            style={{ left: `${formatPercent(hoveredTime.left)}%` }}
          >
            {formatPreciseTime(hoveredTime.timestampMs, timelineEndMs, includeDateInLabels)}
          </span>
        )}
      </div>

      <div className="day-timeline-labels" aria-hidden="true">
        {tickLabels.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
    </section>
  );
}
