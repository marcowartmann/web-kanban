// Geometry helpers for the product roadmap timeline: turn a set of
// "YYYY-MM-DD" date-ranged items into an axis (whole months, always
// including today) and per-item bar positions/widths as percentages
// of that axis. Pure functions, UTC-only arithmetic, no dependencies.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_WIDTH_PCT = 1.5;

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

export interface MonthTick {
  label: string;
  leftPct: number;
}

export interface AxisRange {
  startMs: number;
  endMs: number;
  months: MonthTick[];
  todayPct: number | null;
}

/** Parse a "YYYY-MM-DD" string as a UTC midnight timestamp. */
function parseUTCDate(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Truncate a Date to UTC midnight of its calendar day. */
function toUTCMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** First day (UTC midnight) of the month containing the given timestamp. */
function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** First day (UTC midnight) of the month after the one containing ms. */
function startOfNextMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Axis spanning all items padded to whole months, always including today's month. */
export function axisRange(
  items: { start_date: string; end_date: string }[],
  today: Date,
): AxisRange {
  const todayMs = toUTCMidnight(today);

  let minMs = todayMs;
  let maxMs = todayMs;
  for (const item of items) {
    const start = parseUTCDate(item.start_date);
    const end = parseUTCDate(item.end_date);
    if (start < minMs) minMs = start;
    if (start > maxMs) maxMs = start;
    if (end < minMs) minMs = end;
    if (end > maxMs) maxMs = end;
  }

  const startMs = startOfMonth(minMs);
  const endMs = startOfNextMonth(maxMs);
  const span = endMs - startMs;

  const months: MonthTick[] = [];
  for (let cursor = startMs; cursor < endMs; cursor = startOfNextMonth(cursor)) {
    months.push({
      label: MONTH_LABEL_FORMAT.format(new Date(cursor)),
      leftPct: ((cursor - startMs) / span) * 100,
    });
  }

  const todayPct = span > 0 ? ((todayMs - startMs) / span) * 100 : null;

  return { startMs, endMs, months, todayPct };
}

/** Bar position within the axis as percentages; width floors at 1.5%. */
export function barGeometry(
  item: { start_date: string; end_date: string },
  range: AxisRange,
): { leftPct: number; widthPct: number } {
  const span = range.endMs - range.startMs;
  // Right edge is exclusive: the end of the end_date day, i.e. start of the next day.
  const rawStart = parseUTCDate(item.start_date);
  const rawEnd = parseUTCDate(item.end_date) + MS_PER_DAY;

  const leftPct = clamp(((rawStart - range.startMs) / span) * 100, 0, 100);
  const rightPct = clamp(((rawEnd - range.startMs) / span) * 100, 0, 100);

  let widthPct = rightPct - leftPct;
  let clampedLeftPct = leftPct;
  if (widthPct < MIN_WIDTH_PCT) {
    widthPct = MIN_WIDTH_PCT;
    if (clampedLeftPct + widthPct > 100) clampedLeftPct = 100 - widthPct;
  }

  return { leftPct: clampedLeftPct, widthPct };
}
