import { CalendarDays, ChevronLeft, ChevronRight, Play, RotateCw, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

type RangeControlsProps = {
  date: string;
  disabled?: boolean;
  isRefreshing?: boolean;
  onDateChange: (date: string) => void;
  onPlayRange?: () => void;
  onRefresh: () => void;
  rangeEnd?: string;
  rangeStart?: string;
  recordedDates?: string[];
  onRangeEndChange?: (value: string) => void;
  onRangeStartChange?: (value: string) => void;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function parseDateParts(date: string): { day: number; monthIndex: number; year: number } {
  const [yearText, monthText, dayText] = date.split("-");
  return {
    day: Number(dayText),
    monthIndex: Number(monthText) - 1,
    year: Number(yearText),
  };
}

function toDateValue(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function addMonths(month: string, amount: number): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + amount, 1));
  return monthKey(date.getUTCFullYear(), date.getUTCMonth());
}

function getCalendarDays(month: string): Array<{ date: string; day: number; inMonth: boolean }> {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstGridDate = new Date(Date.UTC(year, monthIndex, 1 - firstOfMonth.getUTCDay()));

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstGridDate);
    day.setUTCDate(firstGridDate.getUTCDate() + index);

    return {
      date: toDateValue(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()),
      day: day.getUTCDate(),
      inMonth: day.getUTCMonth() === monthIndex,
    };
  });
}

function formatMonthLabel(month: string): string {
  const [yearText, monthText] = month.split("-");
  return MONTH_FORMATTER.format(new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)));
}

export function RangeControls({
  date,
  disabled = false,
  isRefreshing = false,
  onDateChange,
  onPlayRange,
  onRefresh,
  rangeEnd,
  rangeStart,
  recordedDates = [],
  onRangeEndChange,
  onRangeStartChange,
}: RangeControlsProps) {
  const { monthIndex, year } = parseDateParts(date);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [isRangeOpen, setIsRangeOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthKey(year, monthIndex));
  const recordedDateSet = useMemo(() => new Set(recordedDates), [recordedDates]);
  const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
  const canPlayRange = rangeStart !== undefined && rangeEnd !== undefined && onRangeStartChange && onRangeEndChange && onPlayRange;

  useEffect(() => {
    setVisibleMonth(monthKey(year, monthIndex));
  }, [monthIndex, year]);

  function selectDate(nextDate: string) {
    onDateChange(nextDate);
    setIsCalendarOpen(false);
  }

  function submitRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onPlayRange?.();
    setIsRangeOpen(false);
  }

  return (
    <div className="range-controls" aria-label="Date and range controls">
      <div className="calendar-control">
        <button
          aria-expanded={isCalendarOpen}
          aria-label={`Playback date ${date}`}
          className="date-control"
          disabled={disabled}
          onClick={() => setIsCalendarOpen((open) => !open)}
          type="button"
        >
          <CalendarDays aria-hidden="true" size={16} />
          <span>{date}</span>
        </button>

        {isCalendarOpen ? (
          <div className="calendar-popover" role="dialog" aria-label="Playback calendar">
            <div className="calendar-header">
              <button
                aria-label="Previous month"
                className="calendar-nav-button"
                onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={15} />
              </button>
              <strong>{formatMonthLabel(visibleMonth)}</strong>
              <button
                aria-label="Next month"
                className="calendar-nav-button"
                onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                type="button"
              >
                <ChevronRight aria-hidden="true" size={15} />
              </button>
            </div>

            <div className="calendar-weekdays" aria-hidden="true">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div className="calendar-grid">
              {calendarDays.map((day) => {
                const hasRecordings = recordedDateSet.has(day.date);
                const selected = day.date === date;

                return (
                  <button
                    aria-label={hasRecordings ? `${day.date} has recordings` : day.date}
                    className={`calendar-day${day.inMonth ? "" : " is-outside-month"}${
                      selected ? " is-selected" : ""
                    }${hasRecordings ? " has-recordings" : ""}`}
                    key={day.date}
                    onClick={() => selectDate(day.date)}
                    type="button"
                  >
                    {day.day}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
      <button className="icon-button text-button" disabled={isRefreshing} onClick={onRefresh} type="button">
        <RotateCw aria-hidden="true" size={15} />
        {isRefreshing ? "Refreshing" : "Refresh"}
      </button>

      {canPlayRange ? (
        <div className="range-panel-control">
          <button
            aria-expanded={isRangeOpen}
            className="icon-button text-button range-toggle-button"
            disabled={disabled}
            onClick={() => setIsRangeOpen((open) => !open)}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" size={15} />
            Range
          </button>

          {isRangeOpen ? (
            <form className="custom-range-controls" onSubmit={submitRange}>
              <label className="datetime-field">
                <span>Start</span>
                <input
                  aria-label="Range start"
                  disabled={disabled}
                  onChange={(event) => onRangeStartChange(event.target.value)}
                  step="1"
                  type="datetime-local"
                  value={rangeStart}
                />
              </label>
              <label className="datetime-field">
                <span>End</span>
                <input
                  aria-label="Range end"
                  disabled={disabled}
                  onChange={(event) => onRangeEndChange(event.target.value)}
                  step="1"
                  type="datetime-local"
                  value={rangeEnd}
                />
              </label>
              <button className="icon-button text-button" disabled={disabled} type="submit">
                <Play aria-hidden="true" size={15} />
                Play range
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
