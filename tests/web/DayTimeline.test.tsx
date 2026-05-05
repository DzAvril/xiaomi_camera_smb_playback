import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineSpan } from "../../src/shared/types";
import { DayTimeline } from "../../src/web/components/DayTimeline";

const originalTimezone = process.env.TZ;

function shanghaiTimestamp(date: string, time: string): number {
  return new Date(`${date}T${time}+08:00`).getTime();
}

function renderTimeline(date: string, spans: TimelineSpan[], selectedAtMs: number | null, onSelectTime = vi.fn()) {
  render(<DayTimeline date={date} spans={spans} selectedAtMs={selectedAtMs} onSelectTime={onSelectTime} />);
  return onSelectTime;
}

describe("DayTimeline", () => {
  afterEach(() => {
    process.env.TZ = originalTimezone;
    cleanup();
  });

  it("renders recorded spans as selectable controls and marks the selected time", async () => {
    const date = "2026-05-04";
    const span: TimelineSpan = {
      startAtMs: shanghaiTimestamp(date, "12:00:00"),
      endAtMs: shanghaiTimestamp(date, "13:00:00"),
      durationSeconds: 3_600,
      clipIds: ["clip-1"],
    };
    const onSelectTime = vi.fn();

    renderTimeline(date, [span], shanghaiTimestamp(date, "12:30:00"), onSelectTime);

    const spanButton = screen.getByRole("button", { name: "Recorded span 12:00 - 13:00" });
    expect(spanButton).toHaveAttribute("title", "12:00 - 13:00");
    expect(within(spanButton).getByText("12:00 - 13:00")).toHaveClass("visually-hidden");
    expect(spanButton).toHaveStyle({ left: "50%", width: "4.166667%" });
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(screen.getByText("06:00")).toBeInTheDocument();
    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.getByText("24:00")).toBeInTheDocument();

    await userEvent.click(spanButton);

    expect(onSelectTime).toHaveBeenCalledWith(span.startAtMs);
    expect(screen.getByLabelText("Selected time 12:30")).toHaveStyle({ left: "52.083333%" });
  });

  it("renders Shanghai day positions and labels when the browser timezone differs", () => {
    process.env.TZ = "UTC";
    const date = "2026-05-04";
    const span: TimelineSpan = {
      startAtMs: shanghaiTimestamp(date, "12:00:00"),
      endAtMs: shanghaiTimestamp(date, "13:00:00"),
      durationSeconds: 3_600,
      clipIds: ["clip-1"],
    };

    renderTimeline(date, [span], shanghaiTimestamp(date, "12:30:00"));

    expect(screen.getByRole("button", { name: "Recorded span 12:00 - 13:00" })).toHaveStyle({
      left: "50%",
      width: "4.166667%",
    });
    expect(screen.getByLabelText("Selected time 12:30")).toHaveStyle({ left: "52.083333%" });
  });

  it("clamps spans that cross the Shanghai day boundaries", () => {
    process.env.TZ = "UTC";
    const span: TimelineSpan = {
      startAtMs: shanghaiTimestamp("2026-05-03", "23:30:00"),
      endAtMs: shanghaiTimestamp("2026-05-05", "00:30:00"),
      durationSeconds: 90_000,
      clipIds: ["clip-1"],
    };

    renderTimeline("2026-05-04", [span], null);

    expect(screen.getByRole("button", { name: "Recorded span 00:00 - 24:00" })).toHaveStyle({
      left: "0%",
      width: "100%",
    });
  });

  it("shows the precise hovered time and selects the clicked time from the track position", () => {
    const date = "2026-05-04";
    const onSelectTime = renderTimeline(date, [], null);
    const track = screen.getByLabelText("Recorded spans");
    track.getBoundingClientRect = () =>
      ({
        left: 20,
        right: 220,
        top: 0,
        bottom: 42,
        width: 200,
        height: 42,
        x: 20,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(track, { clientX: 120 });
    expect(screen.getByLabelText("Hovered time 12:00:00")).toHaveStyle({ left: "50%" });

    fireEvent.click(track, { clientX: 170 });

    expect(onSelectTime).toHaveBeenCalledWith(shanghaiTimestamp(date, "18:00:00"));
  });

  it("maps clicks on visually widened short spans back into the real recorded interval", () => {
    const date = "2026-05-04";
    const shortSpan: TimelineSpan = {
      startAtMs: shanghaiTimestamp(date, "12:00:00"),
      endAtMs: shanghaiTimestamp(date, "12:02:00"),
      durationSeconds: 120,
      clipIds: ["clip-1"],
    };
    const onSelectTime = renderTimeline(date, [shortSpan], null);
    const track = screen.getByLabelText("Recorded spans");
    const spanButton = screen.getByRole("button", { name: "Recorded span 12:00 - 12:02" });

    track.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 1_000,
        top: 0,
        bottom: 42,
        width: 1_000,
        height: 42,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    spanButton.getBoundingClientRect = () =>
      ({
        left: 100,
        right: 160,
        top: 0,
        bottom: 42,
        width: 60,
        height: 42,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.mouseMove(spanButton, { clientX: 155 });
    expect(screen.getByLabelText("Hovered time 12:01:50")).toHaveStyle({ left: "50.127315%" });

    fireEvent.click(spanButton, { clientX: 155 });

    expect(onSelectTime).toHaveBeenCalledWith(shanghaiTimestamp(date, "12:01:50"));
  });
});
