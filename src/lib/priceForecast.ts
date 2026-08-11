import type { TrendSignal } from "./priceTrend";
import type { PricePoint } from "./types";
import { trimNulls } from "./series";

/**
 * A straight-line projection of the same TrendSignal (priceTrend.ts) already
 * computed for this port/grade — not a second, independently-derived model.
 * priceTrend.ts's own doc comment is explicit that no ARIMA/ETS/forward-curve
 * model exists in this repo; this just extends that one nudge forward in a
 * straight line. Deriving the slope any other way (e.g. comparing two
 * trailing-average blocks) risks disagreeing in sign with trend.direction,
 * which is shown right next to this chart via the winner card's trend line —
 * two contradictory trend signals in the same panel would read as a bug.
 */
export interface PriceForecast {
  /** Trailing history, most recent HISTORY_DAYS quoted points. */
  actual: PricePoint[];
  /**
   * Projected points, starting with the last actual point repeated (so a
   * chart's two lines join cleanly) then one point per day out to
   * FORECAST_DAYS.
   */
  forecast: PricePoint[];
  method: "trend-nudge-drift";
  note: string;
}

const FORECAST_DAYS = 14;
const HISTORY_DAYS = 90;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Extends trend.nudgeUsdPerMt (over trend.windowDays) forward as a constant
 * daily drift. Returns null when computeTrendSignal itself returned null —
 * there is nothing to extend without a trend signal.
 */
export function computePriceForecast(
  points: PricePoint[],
  trend: TrendSignal | null,
): PriceForecast | null {
  if (trend === null) return null;
  const quoted = trimNulls(points).filter((p) => p.value !== null);
  if (quoted.length === 0) return null;

  const driftUsdPerDay = trend.nudgeUsdPerMt / trend.windowDays;

  const actual = quoted.slice(-HISTORY_DAYS);
  const last = actual[actual.length - 1];
  const lastValue = last.value as number;

  const forecast: PricePoint[] = [{ date: last.date, value: lastValue }];
  for (let i = 1; i <= FORECAST_DAYS; i++) {
    forecast.push({
      date: addDays(last.date, i),
      value: Math.max(0, lastValue + driftUsdPerDay * i),
    });
  }

  return {
    actual,
    forecast,
    method: "trend-nudge-drift",
    note:
      `Illustrative projection only — extends the ${trend.windowDays}-day ` +
      `trend nudge (${trend.direction}) forward ${FORECAST_DAYS} days, not a ` +
      `market forecast.`,
  };
}
