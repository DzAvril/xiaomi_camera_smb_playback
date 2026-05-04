import { describe, expect, it } from "vitest";
import { isPlaybackRate } from "../../src/shared/types";

describe("isPlaybackRate", () => {
  it("accepts only the supported playback rates", () => {
    expect(isPlaybackRate(0.5)).toBe(true);
    expect(isPlaybackRate(1)).toBe(true);
    expect(isPlaybackRate(2)).toBe(true);
    expect(isPlaybackRate(4)).toBe(true);
    expect(isPlaybackRate(3)).toBe(false);
    expect(isPlaybackRate("1")).toBe(false);
  });
});
