import type { VesselGrade } from "./types";
import type { Co2eCostPoint } from "./emissions";

/**
 * Resolves a Co2eCostPoint series (daily, 2026-05-05→2026-08-05) to the
 * figure nearest a target wall-clock timestamp, clamped to the series' own
 * range when the timestamp falls outside it. Series is tiny (~67 rows), so a
 * linear scan is simpler than a binary search and just as fast in practice.
 *
 * Shared by /api/route-plan (the only remaining caller — the single-port
 * spot-match pipeline this module used to also carry was removed).
 */
export function resolveEmissionsCostUsdPerMt(
  series: Co2eCostPoint[],
  grade: VesselGrade,
  arrivalTimestamp: string | null,
): number | null {
  if (series.length === 0) return null;

  const targetDate = arrivalTimestamp?.split(" ")[0] ?? series[series.length - 1].date;

  if (targetDate <= series[0].date) return series[0].costUsdPerMt[grade];
  const last = series[series.length - 1];
  if (targetDate >= last.date) return last.costUsdPerMt[grade];

  let nearest = series[0];
  for (const point of series) {
    if (point.date <= targetDate) nearest = point;
    else break;
  }
  return nearest.costUsdPerMt[grade];
}
