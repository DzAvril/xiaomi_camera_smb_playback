import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/web/App";

const mocks = vi.hoisted(() => ({
  getPlaybackPlan: vi.fn(),
  getTimeline: vi.fn(async () => []),
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

  it("keeps the playback panel layout independent of optional status banners", () => {
    const styles = readFileSync(path.join(process.cwd(), "src/web/styles.css"), "utf8");
    const playbackPanelRule = styles.match(/\.playback-panel\s*\{[^}]+\}/)?.[0] ?? "";

    expect(playbackPanelRule).toContain("display: flex");
    expect(playbackPanelRule).not.toContain("grid-template-rows");
  });
});
