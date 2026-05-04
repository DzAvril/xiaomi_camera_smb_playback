import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraStream, PlaybackPlan, TimelineSpan } from "../../src/shared/types";
import App from "../../src/web/App";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn<(password: string) => Promise<void>>(),
  getPlaybackPlan: vi.fn<(cameraId: string, start: string, end: string) => Promise<PlaybackPlan>>(),
  getTimeline: vi.fn<(cameraId: string, date: string) => Promise<TimelineSpan[]>>(async () => []),
  listCameras: vi.fn<() => Promise<CameraStream[]>>(),
  refreshIndex: vi.fn(),
}));

vi.mock("../../src/web/api", () => ({
  api: {
    createSession: mocks.createSession,
    getPlaybackPlan: mocks.getPlaybackPlan,
    getTimeline: mocks.getTimeline,
    listCameras: mocks.listCameras,
    refreshIndex: mocks.refreshIndex,
  },
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue();
    mocks.getPlaybackPlan.mockResolvedValue(playbackPlan(shanghaiTimestamp("2026-05-04", "12:00:00")));
    mocks.getTimeline.mockResolvedValue([]);
    mocks.listCameras.mockResolvedValue([
      {
        id: "front-main",
        rootId: "B888808A681C",
        rootPath: "/recordings/B888808A681C",
        channel: "00",
        alias: "前院主摄",
        enabled: true,
        clipCount: 1,
        recordedDays: 1,
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
      },
    ]);
    mocks.refreshIndex.mockResolvedValue({});
  });

  function shanghaiTimestamp(date: string, time: string): number {
    return new Date(`${date}T${time}+08:00`).getTime();
  }

  function shanghaiSpan(date: string, start: string, end: string): TimelineSpan {
    const startAtMs = shanghaiTimestamp(date, start);
    const endAtMs = shanghaiTimestamp(date, end);

    return {
      startAtMs,
      endAtMs,
      durationSeconds: (endAtMs - startAtMs) / 1000,
      clipIds: [`${date}-${start}`],
    };
  }

  function playbackPlan(startAtMs: number): PlaybackPlan {
    return {
      cameraId: "front-main",
      startAtMs,
      endAtMs: startAtMs + 30 * 60 * 1000,
      durationSeconds: 1800,
      playableSeconds: 600,
      segments: [
        {
          clipId: "clip-a",
          fileUrl: "/api/clips/clip-a/file?token=encoded%20value",
          wallStartAtMs: startAtMs,
          wallEndAtMs: startAtMs + 10 * 60 * 1000,
          clipOffsetSeconds: 0,
          playableSeconds: 600,
          virtualStartSeconds: 0,
          virtualEndSeconds: 600,
        },
      ],
      gaps: [
        {
          startAtMs: startAtMs + 10 * 60 * 1000,
          endAtMs: startAtMs + 30 * 60 * 1000,
          durationSeconds: 1200,
          virtualStartSeconds: 600,
          virtualEndSeconds: 1800,
        },
      ],
    };
  }

  it("renders the selected camera and recording stats", async () => {
    render(<App />);

    expect(await screen.findAllByText("前院主摄")).not.toHaveLength(0);
    expect(screen.getAllByText("1 day")).not.toHaveLength(0);
    expect(screen.getAllByText("10 min")).not.toHaveLength(0);
    expect(screen.getAllByText("128 MB")).not.toHaveLength(0);
  });

  it("prompts for the password after an unauthorized camera request and loads cameras after sign-in", async () => {
    mocks.listCameras
      .mockRejectedValueOnce(new Error("Unauthorized"))
      .mockResolvedValueOnce([
        {
          id: "front-main",
          rootId: "B888808A681C",
          rootPath: "/recordings/B888808A681C",
          channel: "00",
          alias: "前院主摄",
          enabled: true,
          clipCount: 1,
          recordedDays: 1,
          totalSeconds: 600,
          totalBytes: 134217728,
          latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
        },
      ]);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Password"), "secret-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mocks.createSession).toHaveBeenCalledWith("secret-password"));
    expect(await screen.findAllByText("前院主摄")).not.toHaveLength(0);
    expect(mocks.listCameras).toHaveBeenCalledTimes(2);
  });

  it("shows recorded days, duration, and storage on each camera row", async () => {
    render(<App />);

    const cameraRow = await screen.findByRole("button", { name: /前院主摄/ });

    expect(within(cameraRow).getByText("1 day")).toBeInTheDocument();
    expect(within(cameraRow).getByText("10 min")).toBeInTheDocument();
    expect(within(cameraRow).getByText("128 MB")).toBeInTheDocument();
  });

  it("keeps refresh available after camera loading fails", async () => {
    mocks.listCameras.mockRejectedValueOnce(new Error("load failed"));

    render(<App />);

    expect(await screen.findByText("load failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled();
  });

  it("clears timeline loading when refresh removes the selected camera during a request", async () => {
    let resolveTimeline: (spans: TimelineSpan[]) => void = () => {};
    const pendingTimeline = new Promise<TimelineSpan[]>((resolve) => {
      resolveTimeline = resolve;
    });
    mocks.getTimeline.mockReturnValueOnce(pendingTimeline);
    mocks.listCameras
      .mockResolvedValueOnce([
        {
          id: "front-main",
          rootId: "B888808A681C",
          rootPath: "/recordings/B888808A681C",
          channel: "00",
          alias: "前院主摄",
          enabled: true,
          clipCount: 1,
          recordedDays: 1,
          totalSeconds: 600,
          totalBytes: 134217728,
          latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
        },
      ])
      .mockResolvedValueOnce([]);

    render(<App />);

    await screen.findAllByText("前院主摄");
    const timelineRegion = screen.getByLabelText("Day timeline").parentElement;
    await waitFor(() => expect(timelineRegion).toHaveAttribute("aria-busy", "true"));

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText("No camera selected")).toBeInTheDocument();
    expect(timelineRegion).toHaveAttribute("aria-busy", "false");

    resolveTimeline([]);
  });

  it("clears stale timeline spans while a new date request is loading", async () => {
    let resolveTimeline: (spans: TimelineSpan[]) => void = () => {};
    const pendingTimeline = new Promise<TimelineSpan[]>((resolve) => {
      resolveTimeline = resolve;
    });
    mocks.getTimeline
      .mockImplementationOnce(async (_cameraId, timelineDate) => [shanghaiSpan(timelineDate, "12:00:00", "13:00:00")])
      .mockReturnValueOnce(pendingTimeline);

    render(<App />);

    const oldSpan = await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" });
    await userEvent.click(oldSpan);
    expect(screen.getByLabelText("Selected time 12:00")).toBeInTheDocument();
    expect(await screen.findByRole("slider", { name: "Playback timeline" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Playback date"), { target: { value: "2026-05-05" } });

    await waitFor(() => expect(mocks.getTimeline).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Recorded span 12:00 - 13:00" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();

    resolveTimeline([shanghaiSpan("2026-05-05", "14:00:00", "15:00:00")]);
    expect(await screen.findByRole("button", { name: "Recorded span 14:00 - 15:00" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();
  });

  it("keeps the playback panel layout independent of optional status banners", () => {
    const styles = readFileSync(path.join(process.cwd(), "src/web/styles.css"), "utf8");
    const playbackPanelRule = styles.match(/\.playback-panel\s*\{[^}]+\}/)?.[0] ?? "";

    expect(playbackPanelRule).toContain("display: flex");
    expect(playbackPanelRule).not.toContain("grid-template-rows");
  });

  it("does not render pending playback after refresh starts and then fails", async () => {
    let resolvePlayback: (plan: PlaybackPlan) => void = () => {};
    let rejectRefresh: (error: Error) => void = () => {};
    const pendingPlayback = new Promise<PlaybackPlan>((resolve) => {
      resolvePlayback = resolve;
    });
    const pendingRefresh = new Promise<unknown>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const spanStartAtMs = shanghaiTimestamp("2026-05-04", "12:00:00");

    mocks.getTimeline.mockImplementationOnce(async (_cameraId, timelineDate) => [
      shanghaiSpan(timelineDate, "12:00:00", "13:00:00"),
    ]);
    mocks.getPlaybackPlan.mockReturnValueOnce(pendingPlayback);
    mocks.refreshIndex.mockReturnValueOnce(pendingRefresh);

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" }));
    await waitFor(() => expect(mocks.getPlaybackPlan).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await act(async () => {
      resolvePlayback(playbackPlan(spanStartAtMs));
      await pendingPlayback;
    });

    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();

    await act(async () => {
      rejectRefresh(new Error("refresh failed"));
      try {
        await pendingRefresh;
      } catch {
        // The app reports the refresh error through UI state.
      }
    });

    expect(await screen.findByText("refresh failed")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();
  });

  it("requests a 30-minute playback plan when a timeline span is selected", async () => {
    mocks.getTimeline.mockImplementationOnce(async (_cameraId, timelineDate) => [
      shanghaiSpan(timelineDate, "12:00:00", "13:00:00"),
    ]);

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" }));

    await waitFor(() =>
      expect(mocks.getPlaybackPlan).toHaveBeenCalledWith(
        "front-main",
        "2026-05-04T04:00:00.000Z",
        "2026-05-04T04:30:00.000Z",
      ),
    );
    expect(await screen.findByRole("slider", { name: "Playback timeline" })).toBeInTheDocument();
  });

  it("clears a loaded playback plan when the selected camera changes", async () => {
    mocks.listCameras.mockResolvedValue([
      {
        id: "front-main",
        rootId: "B888808A681C",
        rootPath: "/recordings/B888808A681C",
        channel: "00",
        alias: "前院主摄",
        enabled: true,
        clipCount: 1,
        recordedDays: 1,
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
      },
      {
        id: "side-main",
        rootId: "B888808A681D",
        rootPath: "/recordings/B888808A681D",
        channel: "01",
        alias: "侧院主摄",
        enabled: true,
        clipCount: 1,
        recordedDays: 1,
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-04T04:10:00.000Z").getTime(),
      },
    ]);
    mocks.getTimeline.mockImplementation(async (_cameraId, timelineDate) => [
      shanghaiSpan(timelineDate, "12:00:00", "13:00:00"),
    ]);

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" }));
    expect(await screen.findByRole("slider", { name: "Playback timeline" })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /侧院主摄/ }));

    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();
  });
});
