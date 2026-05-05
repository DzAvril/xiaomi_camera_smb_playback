import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";
import type { CameraStream, PlaybackPlan, RecordingDay, TimelineSpan } from "../../src/shared/types";
import App from "../../src/web/App";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn<(password: string) => Promise<void>>(),
  getPlaybackPlan: vi.fn<(cameraId: string, start: string, end: string) => Promise<PlaybackPlan>>(),
  getRecordedDays: vi.fn<(cameraId: string) => Promise<RecordingDay[]>>(),
  getTimeline: vi.fn<(cameraId: string, date: string) => Promise<TimelineSpan[]>>(async () => []),
  listCameras: vi.fn<() => Promise<CameraStream[]>>(),
  changePassword: vi.fn<(currentPassword: string, newPassword: string) => Promise<void>>(),
  refreshIndex: vi.fn(),
  updateCamera: vi.fn<
    (cameraId: string, update: { alias?: string; enabled?: boolean }) => Promise<Pick<CameraStream, "alias" | "enabled">>
  >(),
}));

vi.mock("../../src/web/api", () => ({
  api: {
    createSession: mocks.createSession,
    getPlaybackPlan: mocks.getPlaybackPlan,
    getRecordedDays: mocks.getRecordedDays,
    getTimeline: mocks.getTimeline,
    listCameras: mocks.listCameras,
    changePassword: mocks.changePassword,
    refreshIndex: mocks.refreshIndex,
    updateCamera: mocks.updateCamera,
  },
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-04T09:00:00+08:00"));
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue();
    mocks.getPlaybackPlan.mockResolvedValue(playbackPlan(shanghaiTimestamp("2026-05-04", "12:00:00")));
    mocks.getRecordedDays.mockResolvedValue([{ date: "2026-05-04", totalBytes: 134217728, totalSeconds: 600 }]);
    mocks.getTimeline.mockResolvedValue([]);
    mocks.changePassword.mockResolvedValue();
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
        recordedDates: ["2026-05-04"],
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
      },
    ]);
    mocks.refreshIndex.mockResolvedValue({});
    mocks.updateCamera.mockImplementation(async (_cameraId, update) => ({
      alias: update.alias ?? "前院主摄",
      enabled: update.enabled ?? true,
    }));
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

  async function expectPlaybackLoadedWithoutTimelineSlider() {
    expect(await screen.findByRole("button", { name: "1x" })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();
  }

  it("renders the selected camera and recording stats", async () => {
    render(<App />);

    expect(await screen.findAllByText("前院主摄")).not.toHaveLength(0);
    expect(screen.getByRole("heading", { name: "前院主摄" })).toBeInTheDocument();
    expect(screen.queryByText("/recordings/B888808A681C · channel 00")).not.toBeInTheDocument();
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
          recordedDates: ["2026-05-04"],
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

    expect(cameraRow.querySelector(".camera-row-meta")).not.toBeInTheDocument();
    expect(within(cameraRow).queryByText("B888808A681C · 00")).not.toBeInTheDocument();
    expect(within(cameraRow).getByText("1 day")).toBeInTheDocument();
    expect(within(cameraRow).getByText("10 min")).toBeInTheDocument();
    expect(within(cameraRow).getByText("128 MB")).toBeInTheDocument();
  });

  it("counts sidebar recording days as unique calendar dates across cameras", async () => {
    mocks.listCameras.mockResolvedValue([
      {
        id: "front-main",
        rootId: "B888808A681C",
        rootPath: "/recordings/B888808A681C",
        channel: "00",
        alias: "前院主摄",
        enabled: true,
        clipCount: 2,
        recordedDays: 2,
        recordedDates: ["2026-05-04", "2026-05-05"],
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-05T03:10:00.000Z").getTime(),
      },
      {
        id: "side-main",
        rootId: "B888808A681D",
        rootPath: "/recordings/B888808A681D",
        channel: "01",
        alias: "侧院主摄",
        enabled: true,
        clipCount: 2,
        recordedDays: 2,
        recordedDates: ["2026-05-05", "2026-05-06"],
        totalSeconds: 1200,
        totalBytes: 268435456,
        latestEndAtMs: new Date("2026-05-06T03:10:00.000Z").getTime(),
      },
    ] as CameraStream[]);

    render(<App />);

    const recordingDays = await screen.findByText("Recording days");
    expect(within(recordingDays.closest("div")!).getByText("3 days")).toBeInTheDocument();
  });

  it("marks recorded days in the playback calendar for the selected camera", async () => {
    render(<App />);

    await waitFor(() => expect(mocks.getRecordedDays).toHaveBeenCalledWith("front-main"));
    await userEvent.click(await screen.findByRole("button", { name: "Playback date 2026-05-04" }));

    expect(screen.getByRole("button", { name: "2026-05-04 has recordings" })).toHaveClass("has-recordings");
  });

  it("shows every mounted stream in settings and saves camera configuration globally", async () => {
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
        recordedDates: ["2026-05-04"],
        totalSeconds: 600,
        totalBytes: 134217728,
        latestEndAtMs: new Date("2026-05-04T03:10:00.000Z").getTime(),
      },
      {
        id: "side-hidden",
        rootId: "B88880A344EB",
        rootPath: "/recordings/B88880A344EB",
        channel: "00",
        alias: "侧院隐藏",
        enabled: false,
        clipCount: 0,
        recordedDays: 0,
        recordedDates: [],
        totalSeconds: 0,
        totalBytes: 0,
        latestEndAtMs: null,
      },
    ]);
    mocks.updateCamera
      .mockResolvedValueOnce({ alias: "车库入口", enabled: false })
      .mockResolvedValueOnce({ alias: "侧院", enabled: false });

    render(<App />);

    expect(await screen.findByRole("button", { name: /前院主摄/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /侧院隐藏/ })).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText("Camera list")).getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("/recordings/B88880A344EB · channel 00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save camera" })).not.toBeInTheDocument();

    const frontCard = screen.getByLabelText("Camera setting 前院主摄");
    const aliasInput = within(frontCard).getByLabelText("Alias");
    await userEvent.clear(aliasInput);
    await userEvent.type(aliasInput, "车库入口");
    await userEvent.click(within(frontCard).getByLabelText("Show in playback"));

    const sideCard = screen.getByLabelText("Camera setting 侧院隐藏");
    const sideAliasInput = within(sideCard).getByLabelText("Alias");
    await userEvent.clear(sideAliasInput);
    await userEvent.type(sideAliasInput, "侧院");

    await userEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => expect(mocks.updateCamera).toHaveBeenCalledTimes(2));
    expect(mocks.updateCamera).toHaveBeenNthCalledWith(1, "front-main", { alias: "车库入口", enabled: false });
    expect(mocks.updateCamera).toHaveBeenNthCalledWith(2, "side-hidden", { alias: "侧院", enabled: false });
    expect(await screen.findByText("Saved 2 cameras")).toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText("Camera list")).getByRole("button", { name: "Playback" }));
    expect(screen.queryByRole("button", { name: /车库入口/ })).not.toBeInTheDocument();
  });

  it("changes the app password from settings", async () => {
    render(<App />);

    await screen.findAllByText("前院主摄");
    await userEvent.click(within(screen.getByLabelText("Camera list")).getByRole("button", { name: "Settings" }));

    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-123");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith("old-password", "new-password-123"));
    expect(await screen.findByText("Password updated")).toBeInTheDocument();
  });

  it("keeps the settings entry in the sidebar navigation", async () => {
    const { container } = render(<App />);

    await screen.findAllByText("前院主摄");

    const sidebar = screen.getByLabelText("Camera list");
    expect(within(sidebar).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(container.querySelector(".playback-header .view-switch")).not.toBeInTheDocument();
  });

  it("shows the Docker image version in the sidebar", async () => {
    render(<App />);

    const sidebar = screen.getByLabelText("Camera list");
    expect(await within(sidebar).findByText("Image version")).toBeInTheDocument();
    expect(within(sidebar).getByText(`v${packageJson.version}`)).toBeInTheDocument();
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
          recordedDates: ["2026-05-04"],
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
    await expectPlaybackLoadedWithoutTimelineSlider();

    await userEvent.click(screen.getByRole("button", { name: "Playback date 2026-05-04" }));
    await userEvent.click(screen.getByRole("button", { name: "2026-05-05" }));

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
    const videoPlaceholderRule = styles.match(/\.video-placeholder\s*\{[^}]+\}/)?.[0] ?? "";
    const dayTimelineTrackRule = styles.match(/\.day-timeline-track\s*\{[^}]+\}/)?.[0] ?? "";
    const dayTimelineSpanRule = styles.match(/\.day-timeline-span\s*\{[^}]+\}/)?.[0] ?? "";
    const dateControlRule = styles.match(/\.date-control\s*\{[^}]+\}/)?.[0] ?? "";
    const dateControlSpanRule = styles.match(/\.date-control span\s*\{[^}]+\}/)?.[0] ?? "";
    const virtualPlayerRule = styles.match(/\.virtual-player\s*\{[^}]+\}/)?.[0] ?? "";
    const virtualPlayerStageRule = styles.match(/\.virtual-player-stage\s*\{[^}]+\}/)?.[0] ?? "";

    expect(playbackPanelRule).toContain("display: flex");
    expect(playbackPanelRule).toContain("height: 100vh");
    expect(playbackPanelRule).not.toContain("grid-template-rows");
    expect(videoPlaceholderRule).toContain("56vh");
    expect(virtualPlayerRule).toContain("flex: 0 0 clamp(340px, 56vh, 760px)");
    expect(virtualPlayerRule).toContain("grid-template-rows: minmax(0, 1fr) auto auto");
    expect(virtualPlayerStageRule).toContain("min-height: 0");
    expect(dayTimelineTrackRule).toContain("linear-gradient");
    expect(dayTimelineSpanRule).toContain("box-shadow");
    expect(dateControlRule).toContain("white-space: nowrap");
    expect(dateControlSpanRule).toContain("white-space: nowrap");
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
    await expectPlaybackLoadedWithoutTimelineSlider();
  });

  it("keeps the current player mounted while a new timeline selection is loading", async () => {
    let resolveNextPlayback: (plan: PlaybackPlan) => void = () => {};
    const pendingNextPlayback = new Promise<PlaybackPlan>((resolve) => {
      resolveNextPlayback = resolve;
    });
    mocks.getTimeline.mockImplementationOnce(async (_cameraId, timelineDate) => [
      shanghaiSpan(timelineDate, "12:00:00", "13:00:00"),
      shanghaiSpan(timelineDate, "14:00:00", "15:00:00"),
    ]);
    mocks.getPlaybackPlan
      .mockResolvedValueOnce(playbackPlan(shanghaiTimestamp("2026-05-04", "12:00:00")))
      .mockReturnValueOnce(pendingNextPlayback);

    const { container } = render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" }));
    await expectPlaybackLoadedWithoutTimelineSlider();

    const currentVideo = container.querySelector("video");
    expect(currentVideo).toBeInstanceOf(HTMLVideoElement);

    await userEvent.click(screen.getByRole("button", { name: "Recorded span 14:00 - 15:00" }));
    await waitFor(() => expect(mocks.getPlaybackPlan).toHaveBeenCalledTimes(2));

    expect(screen.queryByLabelText("Video player placeholder")).not.toBeInTheDocument();
    expect(container.querySelector("video")).toBe(currentVideo);

    await act(async () => {
      resolveNextPlayback(playbackPlan(shanghaiTimestamp("2026-05-04", "14:00:00")));
      await pendingNextPlayback;
    });
  });

  it("requests playback for a custom local time range", async () => {
    mocks.getPlaybackPlan.mockResolvedValueOnce(playbackPlan(shanghaiTimestamp("2026-05-04", "10:05:00")));

    render(<App />);

    await screen.findAllByText("前院主摄");
    await userEvent.click(screen.getByRole("button", { name: "Range" }));
    await userEvent.clear(screen.getByLabelText("Range start"));
    await userEvent.type(screen.getByLabelText("Range start"), "2026-05-04T10:05:00");
    await userEvent.clear(screen.getByLabelText("Range end"));
    await userEvent.type(screen.getByLabelText("Range end"), "2026-05-04T10:45:00");
    await userEvent.click(screen.getByRole("button", { name: "Play range" }));

    await waitFor(() =>
      expect(mocks.getPlaybackPlan).toHaveBeenCalledWith(
        "front-main",
        "2026-05-04T10:05:00",
        "2026-05-04T10:45:00",
      ),
    );
    expect(screen.getByLabelText("Selected time 10:05")).toBeInTheDocument();
  });

  it("moves the day timeline playhead as video playback advances", async () => {
    mocks.getTimeline.mockImplementationOnce(async (_cameraId, timelineDate) => [
      shanghaiSpan(timelineDate, "12:00:00", "13:00:00"),
    ]);

    const { container } = render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Recorded span 12:00 - 13:00" }));
    await expectPlaybackLoadedWithoutTimelineSlider();

    const video = container.querySelector("video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
    fireEvent.timeUpdate(video!, { target: { currentTime: 300 } });

    expect(await screen.findByLabelText("Selected time 12:05")).toBeInTheDocument();
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
        recordedDates: ["2026-05-04"],
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
        recordedDates: ["2026-05-04"],
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
    await expectPlaybackLoadedWithoutTimelineSlider();

    await userEvent.click(await screen.findByRole("button", { name: /侧院主摄/ }));

    expect(screen.queryByRole("slider", { name: "Playback timeline" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();
  });
});
