import { formatLocalDate, parseXiaomiTimestamp } from "../shared/time.js";

const XIAOMI_CLIP_NAME = /^(?<channel>\d{2})_(?<start>\d{14})_(?<end>\d{14})\.mp4$/i;

export type ParsedXiaomiClip = {
  channel: string;
  startAtMs: number;
  endAtMs: number;
  durationSeconds: number;
};

export function parseXiaomiClipName(fileName: string): ParsedXiaomiClip | null {
  const match = XIAOMI_CLIP_NAME.exec(fileName);
  if (!match?.groups) {
    return null;
  }

  const startAtMs = parseXiaomiTimestamp(match.groups.start);
  const endAtMs = parseXiaomiTimestamp(match.groups.end);
  if (startAtMs === null || endAtMs === null || endAtMs <= startAtMs) {
    return null;
  }

  return {
    channel: match.groups.channel,
    startAtMs,
    endAtMs,
    durationSeconds: Math.round((endAtMs - startAtMs) / 1000),
  };
}

export { formatLocalDate };
