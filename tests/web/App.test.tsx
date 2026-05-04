import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../../src/web/App";

vi.mock("../../src/web/api", () => ({
  api: {
    listCameras: vi.fn(async () => [
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
    ]),
    getTimeline: vi.fn(async () => []),
    getPlaybackPlan: vi.fn(),
    refreshIndex: vi.fn(),
  },
}));

describe("App", () => {
  it("renders the selected camera and recording stats", async () => {
    render(<App />);

    expect(await screen.findAllByText("前院主摄")).not.toHaveLength(0);
    expect(screen.getByText("1 day")).toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("128 MB")).toBeInTheDocument();
  });
});
