import { describe, expect, it } from "vitest";
import { formatLocalDate, parseXiaomiClipName } from "../../src/server/parser";

describe("parseXiaomiClipName", () => {
  it("parses channel, start, end, and duration", () => {
    const parsed = parseXiaomiClipName("00_20260504110024_20260504111027.mp4");

    expect(parsed).toEqual({
      channel: "00",
      startAtMs: new Date(2026, 4, 4, 11, 0, 24).getTime(),
      endAtMs: new Date(2026, 4, 4, 11, 10, 27).getTime(),
      durationSeconds: 603,
    });
  });

  it("rejects malformed names", () => {
    expect(parseXiaomiClipName("20260504110024.mp4")).toBeNull();
    expect(parseXiaomiClipName("00_20260504110024_20260504111027.mov")).toBeNull();
  });

  it("rejects clips whose end is not after start", () => {
    expect(parseXiaomiClipName("00_20260504111027_20260504110024.mp4")).toBeNull();
  });
});

describe("formatLocalDate", () => {
  it("formats timestamps as YYYY-MM-DD in local time", () => {
    expect(formatLocalDate(new Date(2026, 4, 4, 23, 59, 59).getTime())).toBe("2026-05-04");
  });
});
