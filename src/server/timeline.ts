import type { ClipRecord, TimelineSpan } from "../shared/types";
import { endOfLocalDay, formatLocalDate, startOfLocalDay } from "../shared/time";

const CONTINUITY_THRESHOLD_MS = 1000;

export type RecordedDay = {
  date: string;
  totalSeconds: number;
  totalBytes: number;
};

export function buildDayTimeline(clips: ClipRecord[], dateText: string): TimelineSpan[] {
  const dayStart = startOfLocalDay(dateText);
  const dayEnd = endOfLocalDay(dateText);
  const sorted = clips
    .filter((clip) => clip.endAtMs > dayStart && clip.startAtMs < dayEnd)
    .sort((a, b) => a.startAtMs - b.startAtMs);

  const spans: TimelineSpan[] = [];

  for (const clip of sorted) {
    const startAtMs = Math.max(clip.startAtMs, dayStart);
    const endAtMs = Math.min(clip.endAtMs, dayEnd);
    const last = spans.at(-1);

    if (last && startAtMs - last.endAtMs <= CONTINUITY_THRESHOLD_MS) {
      last.endAtMs = Math.max(last.endAtMs, endAtMs);
      last.durationSeconds = (last.endAtMs - last.startAtMs) / 1000;
      last.clipIds.push(clip.id);
      continue;
    }

    spans.push({
      startAtMs,
      endAtMs,
      durationSeconds: (endAtMs - startAtMs) / 1000,
      clipIds: [clip.id],
    });
  }

  return spans;
}

export function listRecordedDays(clips: ClipRecord[]): RecordedDay[] {
  const byDate = new Map<string, RecordedDay>();

  for (const clip of clips) {
    const date = formatLocalDate(clip.startAtMs);
    const existing = byDate.get(date) ?? { date, totalSeconds: 0, totalBytes: 0 };
    existing.totalSeconds += clip.durationSeconds;
    existing.totalBytes += clip.sizeBytes;
    byDate.set(date, existing);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
