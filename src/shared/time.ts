const XIAOMI_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHANGHAI_OFFSET_HOURS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidYear(year: number): boolean {
  return year >= 1000 && year <= 9999;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = LOCAL_DATE.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!isValidYear(year) || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function shanghaiLocalTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  return Date.UTC(year, month - 1, day, hour - SHANGHAI_OFFSET_HOURS, minute, second);
}

export function parseXiaomiTimestamp(value: string): number | null {
  const match = XIAOMI_TIMESTAMP.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  const yearValue = Number(year);
  const monthValue = Number(month);
  const dayValue = Number(day);
  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  const secondValue = Number(second);

  if (
    !isValidYear(yearValue) ||
    monthValue < 1 ||
    monthValue > 12 ||
    dayValue < 1 ||
    dayValue > daysInMonth(yearValue, monthValue) ||
    hourValue < 0 ||
    hourValue > 23 ||
    minuteValue < 0 ||
    minuteValue > 59 ||
    secondValue < 0 ||
    secondValue > 59
  ) {
    return null;
  }

  return shanghaiLocalTimeToUtcMs(
    yearValue,
    monthValue,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  );
}

export function formatLocalDate(timestampMs: number): string {
  const date = new Date(timestampMs + SHANGHAI_OFFSET_HOURS * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfLocalDay(dateText: string): number {
  const parts = parseDateParts(dateText);
  if (!parts) {
    throw new Error(`Invalid local date: ${dateText}`);
  }

  return shanghaiLocalTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0);
}

export function endOfLocalDay(dateText: string): number {
  return startOfLocalDay(dateText) + MS_PER_DAY;
}
