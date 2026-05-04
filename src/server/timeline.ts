import type { ClipRecord, TimelineSpan } from "../shared/types.js";
import { endOfLocalDay, formatLocalDate, startOfLocalDay } from "../shared/time.js";

const CONTINUITY_THRESHOLD_MS = 1000;

export type RecordedDay = {
  date: string;
  totalSeconds: number;
  /** File-inventory bytes for clips whose start time falls on this Shanghai date. */
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

function calculateRecordedCoverageSeconds(clips: ClipRecord[], dateText: string): number {
  const dayStart = startOfLocalDay(dateText);
  const dayEnd = endOfLocalDay(dateText);
  const intervals = clips
    .filter((clip) => clip.endAtMs > dayStart && clip.startAtMs < dayEnd)
    .map((clip) => ({
      startAtMs: Math.max(clip.startAtMs, dayStart),
      endAtMs: Math.min(clip.endAtMs, dayEnd),
    }))
    .sort((a, b) => a.startAtMs - b.startAtMs);

  let totalMs = 0;
  let currentStartAtMs: number | null = null;
  let currentEndAtMs: number | null = null;

  for (const interval of intervals) {
    if (currentStartAtMs === null || currentEndAtMs === null) {
      currentStartAtMs = interval.startAtMs;
      currentEndAtMs = interval.endAtMs;
      continue;
    }

    if (interval.startAtMs <= currentEndAtMs) {
      currentEndAtMs = Math.max(currentEndAtMs, interval.endAtMs);
      continue;
    }

    totalMs += currentEndAtMs - currentStartAtMs;
    currentStartAtMs = interval.startAtMs;
    currentEndAtMs = interval.endAtMs;
  }

  if (currentStartAtMs !== null && currentEndAtMs !== null) {
    totalMs += currentEndAtMs - currentStartAtMs;
  }

  return totalMs / 1000;
}

export function listRecordedDays(clips: ClipRecord[]): RecordedDay[] {
  const byDate = new Map<string, RecordedDay>();
  const coverageClipsByDate = new Map<string, ClipRecord[]>();

  for (const clip of clips) {
    const startDate = formatLocalDate(clip.startAtMs);
    const existing = byDate.get(startDate) ?? { date: startDate, totalSeconds: 0, totalBytes: 0 };
    existing.totalBytes += clip.sizeBytes;
    byDate.set(startDate, existing);

    let date = startDate;
    let dayStart = startOfLocalDay(date);

    while (dayStart < clip.endAtMs) {
      const dayEnd = endOfLocalDay(date);

      if (clip.endAtMs > dayStart && clip.startAtMs < dayEnd) {
        const dayClips = coverageClipsByDate.get(date) ?? [];
        dayClips.push(clip);
        coverageClipsByDate.set(date, dayClips);
        byDate.set(date, byDate.get(date) ?? { date, totalSeconds: 0, totalBytes: 0 });
      }

      date = formatLocalDate(dayEnd);
      dayStart = dayEnd;
    }
  }

  for (const [date, dateClips] of coverageClipsByDate) {
    const existing = byDate.get(date) ?? { date, totalSeconds: 0, totalBytes: 0 };
    existing.totalSeconds = calculateRecordedCoverageSeconds(dateClips, date);
    byDate.set(date, existing);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
