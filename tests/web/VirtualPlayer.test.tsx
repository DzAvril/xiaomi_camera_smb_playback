import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackPlan, PlaybackSegment } from "../../src/shared/types";
import { VirtualPlayer } from "../../src/web/player/VirtualPlayer";

function segment(
  clipId: string,
  virtualStartSeconds: number,
  virtualEndSeconds: number,
  clipOffsetSeconds: number,
): PlaybackSegment {
  const wallStartAtMs = Date.UTC(2026, 4, 4, 4, 0, 0) + virtualStartSeconds * 1000;

  return {
    clipId,
    fileUrl: `/api/clips/${clipId}/file`,
    wallStartAtMs,
    wallEndAtMs: Date.UTC(2026, 4, 4, 4, 0, 0) + virtualEndSeconds * 1000,
    clipOffsetSeconds,
    playableSeconds: virtualEndSeconds - virtualStartSeconds,
    virtualStartSeconds,
    virtualEndSeconds,
  };
}

function playbackPlan(segments: PlaybackSegment[], startAtMs = Date.UTC(2026, 4, 4, 4, 0, 0)): PlaybackPlan {
  return {
    cameraId: "front-main",
    startAtMs,
    endAtMs: startAtMs + 30 * 60 * 1000,
    durationSeconds: 1800,
    playableSeconds: segments.reduce((sum, item) => sum + item.playableSeconds, 0),
    segments,
    gaps: [],
  };
}

describe("VirtualPlayer", () => {
  let playSpy: ReturnType<typeof vi.spyOn>;
  let loadSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    loadSpy = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("seeks to the selected clip offset and starts playback after metadata loads", () => {
    render(<VirtualPlayer plan={playbackPlan([segment("clip-a", 0, 600, 305)])} />);

    const video = document.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);

    fireEvent.loadedMetadata(video!);

    expect(video!.currentTime).toBe(305);
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it("moves backward and forward by 10 seconds", async () => {
    render(<VirtualPlayer plan={playbackPlan([segment("clip-a", 0, 600, 0)])} />);

    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);

    await userEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    expect(video.currentTime).toBe(10);
    expect(screen.getByText("12:00:10")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    expect(video.currentTime).toBe(0);
    expect(screen.getByText("12:00:00")).toBeInTheDocument();
  });

  it("preloads the next clip near the current clip end and clears it when playback exits", () => {
    const plan = playbackPlan([segment("clip-a", 0, 600, 0), segment("clip-b", 600, 1200, 0)]);
    const { rerender } = render(<VirtualPlayer plan={plan} />);
    const video = document.querySelector("video")!;
    fireEvent.loadedMetadata(video);

    video.currentTime = 585;
    fireEvent.timeUpdate(video);

    const preloader = screen.getByLabelText("Preloading next clip");
    expect(preloader).toBeInstanceOf(HTMLVideoElement);
    expect(preloader).toHaveAttribute("src", "/api/clips/clip-b/file");

    rerender(<VirtualPlayer plan={null} />);

    expect(screen.queryByLabelText("Preloading next clip")).not.toBeInTheDocument();
    expect(loadSpy).toHaveBeenCalled();
  });
});
