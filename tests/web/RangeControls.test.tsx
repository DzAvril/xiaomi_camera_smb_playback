import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangeControls } from "../../src/web/components/RangeControls";

describe("RangeControls", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks recorded days in the calendar and selects a clicked day", async () => {
    const onDateChange = vi.fn();

    render(
      <RangeControls
        date="2026-05-04"
        onDateChange={onDateChange}
        onRefresh={vi.fn()}
        recordedDates={["2026-05-04", "2026-05-18"]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Playback date 2026-05-04" }));

    expect(screen.getByRole("button", { name: "2026-05-04 has recordings" })).toHaveClass("has-recordings");
    expect(screen.getByRole("button", { name: "2026-05-05" })).not.toHaveClass("has-recordings");

    await userEvent.click(screen.getByRole("button", { name: "2026-05-18 has recordings" }));

    expect(onDateChange).toHaveBeenCalledWith("2026-05-18");
  });

  it("keeps custom range fields hidden until the range panel is opened", async () => {
    render(
      <RangeControls
        date="2026-05-04"
        onDateChange={vi.fn()}
        onPlayRange={vi.fn()}
        onRefresh={vi.fn()}
        rangeEnd="2026-05-04T23:59:59"
        rangeStart="2026-05-04T00:00:00"
        onRangeEndChange={vi.fn()}
        onRangeStartChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Range start")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Range end")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Range" }));

    expect(screen.getByLabelText("Range start")).toBeInTheDocument();
    expect(screen.getByLabelText("Range end")).toBeInTheDocument();
  });
});
