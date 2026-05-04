import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineSpan } from "../../src/shared/types";
import App from "../../src/web/App";

const mocks = vi.hoisted(() => ({
  getPlaybackPlan: vi.fn(),
  getTimeline: vi.fn<(cameraId: string, date: string) => Promise<TimelineSpan[]>>(async () => []),
  listCameras: vi.fn(),
  refreshIndex: vi.fn(),
}));

vi.mock("../../src/web/api", () => ({
  api: {
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

  function shanghaiSpan(date: string, start: string, end: string): TimelineSpan {
    const startAtMs = new Date(`${date}T${start}+08:00`).getTime();
    const endAtMs = new Date(`${date}T${end}+08:00`).getTime();

    return {
      startAtMs,
      endAtMs,
      durationSeconds: (endAtMs - startAtMs) / 1000,
      clipIds: [`${date}-${start}`],
    };
  }

  it("renders the selected camera and recording stats", async () => {
    render(<App />);

    expect(await screen.findAllByText("前院主摄")).not.toHaveLength(0);
    expect(screen.getAllByText("1 day")).not.toHaveLength(0);
    expect(screen.getAllByText("10 min")).not.toHaveLength(0);
    expect(screen.getAllByText("128 MB")).not.toHaveLength(0);
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

    fireEvent.change(screen.getByLabelText("Playback date"), { target: { value: "2026-05-05" } });

    await waitFor(() => expect(mocks.getTimeline).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Recorded span 12:00 - 13:00" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Selected time 12:00")).not.toBeInTheDocument();

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
});
