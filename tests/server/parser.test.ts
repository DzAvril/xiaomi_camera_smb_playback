import { describe, expect, it } from "vitest";
import { formatLocalDate, parseXiaomiClipName } from "../../src/server/parser";
import { endOfLocalDay, startOfLocalDay } from "../../src/shared/time";

function withHostTimeZone<T>(timeZone: string, run: () => T): T {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = timeZone;

  try {
    return run();
  } finally {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  }
}

describe("parseXiaomiClipName", () => {
  it("parses channel, start, end, and duration", () => {
    const parsed = parseXiaomiClipName("00_20260504110024_20260504111027.mp4");

    expect(parsed).toEqual({
      channel: "00",
      startAtMs: Date.UTC(2026, 4, 4, 3, 0, 24),
      endAtMs: Date.UTC(2026, 4, 4, 3, 10, 27),
      durationSeconds: 603,
    });
  });

  it("treats filename timestamps as Shanghai time under UTC host timezone", () => {
    withHostTimeZone("UTC", () => {
      expect(parseXiaomiClipName("00_20260504110024_20260504111027.mp4")?.startAtMs).toBe(
        Date.UTC(2026, 4, 4, 3, 0, 24),
      );
    });
  });

  it("rejects malformed names", () => {
    expect(parseXiaomiClipName("20260504110024.mp4")).toBeNull();
    expect(parseXiaomiClipName("00_20260504110024_20260504111027.mov")).toBeNull();
  });

  it("rejects invalid timestamp components", () => {
    expect(parseXiaomiClipName("00_20260231110024_20260231111027.mp4")).toBeNull();
    expect(parseXiaomiClipName("00_00000504110024_00000504111027.mp4")).toBeNull();
  });

  it("rejects clips whose end is not after start", () => {
    expect(parseXiaomiClipName("00_20260504111027_20260504110024.mp4")).toBeNull();
  });
});

describe("formatLocalDate", () => {
  it("formats timestamps as YYYY-MM-DD in Shanghai time", () => {
    expect(formatLocalDate(Date.UTC(2026, 4, 4, 15, 59, 59))).toBe("2026-05-04");
  });

  it("formats timestamps as Shanghai dates under UTC host timezone", () => {
    withHostTimeZone("UTC", () => {
      expect(formatLocalDate(Date.UTC(2026, 4, 3, 16, 30, 0))).toBe("2026-05-04");
    });
  });
});

describe("local day boundaries", () => {
  it("treats day boundaries as Shanghai time under UTC host timezone", () => {
    withHostTimeZone("UTC", () => {
      expect(startOfLocalDay("2026-05-04")).toBe(Date.UTC(2026, 4, 3, 16, 0, 0));
      expect(endOfLocalDay("2026-05-04")).toBe(Date.UTC(2026, 4, 4, 16, 0, 0));
    });
  });

  it("rejects malformed or normalized dates", () => {
    expect(() => startOfLocalDay("2026-02-31")).toThrow("Invalid local date");
    expect(() => startOfLocalDay("20260504")).toThrow("Invalid local date");
    expect(() => startOfLocalDay("2026-5-04")).toThrow("Invalid local date");
    expect(() => startOfLocalDay("0000-05-04")).toThrow("Invalid local date");
  });
});
