import { CalendarDays, RotateCw } from "lucide-react";

type RangeControlsProps = {
  date: string;
  disabled?: boolean;
  isRefreshing?: boolean;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
};

export function RangeControls({ date, disabled = false, isRefreshing = false, onDateChange, onRefresh }: RangeControlsProps) {
  return (
    <div className="range-controls" aria-label="Date and range controls">
      <label className="date-control">
        <CalendarDays aria-hidden="true" size={16} />
        <input
          aria-label="Playback date"
          disabled={disabled}
          onChange={(event) => onDateChange(event.target.value)}
          type="date"
          value={date}
        />
      </label>
      <button className="icon-button text-button" disabled={disabled || isRefreshing} onClick={onRefresh} type="button">
        <RotateCw aria-hidden="true" size={15} />
        {isRefreshing ? "Refreshing" : "Refresh"}
      </button>
    </div>
  );
}
