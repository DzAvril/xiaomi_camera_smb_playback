import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TimelineSpan } from "../../src/shared/types";
import { DayTimeline } from "../../src/web/components/DayTimeline";

function localTimestamp(date: string, time: string): number {
  return new Date(`${date}T${time}`).getTime();
}

describe("DayTimeline", () => {
  it("renders recorded spans as selectable controls and marks the selected time", async () => {
    const date = "2026-05-04";
    const span: TimelineSpan = {
      startAtMs: localTimestamp(date, "12:00:00"),
      endAtMs: localTimestamp(date, "13:00:00"),
      durationSeconds: 3_600,
      clipIds: ["clip-1"],
    };
    const onSelectTime = vi.fn();

    render(<DayTimeline date={date} spans={[span]} selectedAtMs={localTimestamp(date, "12:30:00")} onSelectTime={onSelectTime} />);

    const spanButton = screen.getByRole("button", { name: "12:00 - 13:00" });
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
});
