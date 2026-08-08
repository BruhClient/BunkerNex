import type { PricePoint } from "./types";

/**
 * Pure series helpers, shared by the server-side loader and the client-side
 * chart. Kept out of lib/prices.ts because that module reaches for node:fs.
 */

/**
 * Most recent point that actually has a value. Never assumes the last row is
 * populated — several columns stop being quoted before the file ends.
 */
export function latestPoint(points: PricePoint[]): PricePoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== null) return points[i];
  }
  return null;
}

/** The quote before the latest one, for a day-on-day delta. */
export function previousPoint(points: PricePoint[]): PricePoint | null {
  let seen = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value !== null) {
      seen++;
      if (seen === 2) return points[i];
    }
  }
  return null;
}

/**
 * Drop leading and trailing nulls so a series begins at its first real quote.
 *
 * Most non-Singapore columns are blank for the first year or more of the file.
 * Without trimming, the chart's connectNulls would draw a straight line back
 * through history that was never quoted.
 */
export function trimNulls(points: PricePoint[]): PricePoint[] {
  let start = 0;
  let end = points.length - 1;
  while (start < points.length && points[start].value === null) start++;
  while (end >= start && points[end].value === null) end--;
  return start > end ? [] : points.slice(start, end + 1);
}

export type Range = "1M" | "3M" | "6M" | "1Y" | "ALL";

export const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "ALL"];

const RANGE_MONTHS: Record<Exclude<Range, "ALL">, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
};

/** Cut-off date for a range, measured back from the newest quote in view. */
export function rangeStart(range: Range, newest: string): string | null {
  if (range === "ALL") return null;
  const d = new Date(`${newest}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() - RANGE_MONTHS[range]);
  return d.toISOString().slice(0, 10);
}

/**
 * Stride-reduce to at most `max` rows, always keeping the newest row so the
 * chart's right edge matches the price tiles.
 */
export function downsample<T>(rows: T[], max = 420): T[] {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += step) out.push(rows[i]);
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}
