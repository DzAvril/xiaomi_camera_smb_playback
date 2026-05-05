export const PLAYBACK_RATES = [0.5, 1, 2, 4] as const;

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export type CameraStream = {
  id: string;
  rootId: string;
  rootPath: string;
  channel: string;
  alias: string;
  enabled: boolean;
  clipCount: number;
  recordedDays: number;
  recordedDates: string[];
  totalSeconds: number;
  totalBytes: number;
  latestEndAtMs: number | null;
};

export type ClipRecord = {
  id: string;
  cameraId: string;
  rootPath: string;
  relativePath: string;
  channel: string;
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
  sizeBytes: number;
  mtimeMs: number;
};

export type TimelineSpan = {
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
  clipIds: string[];
};

export type RecordingDay = {
  date: string;
  totalBytes: number;
  totalSeconds: number;
};

export type PlaybackSegment = {
  clipId: string;
  fileUrl: string;
  wallStartAtMs: number;
  wallEndAtMs: number;
  clipOffsetSeconds: number;
  playableSeconds: number;
  virtualStartSeconds: number;
  virtualEndSeconds: number;
};

export type PlaybackGap = {
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
  virtualStartSeconds: number;
  virtualEndSeconds: number;
};

export type PlaybackPlan = {
  cameraId: string;
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
  playableSeconds: number;
  segments: PlaybackSegment[];
  gaps: PlaybackGap[];
};

export function isPlaybackRate(value: unknown): value is PlaybackRate {
  return PLAYBACK_RATES.includes(value as PlaybackRate);
}
