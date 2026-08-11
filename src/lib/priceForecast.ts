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
  forecastDays: number = FORECAST_DAYS,
): PriceForecast | null {
  if (trend === null) return null;
  const quoted = trimNulls(points).filter((p) => p.value !== null);
  if (quoted.length === 0) return null;

  const driftUsdPerDay = trend.nudgeUsdPerMt / trend.windowDays;

  const actual = quoted.slice(-HISTORY_DAYS);
  const last = actual[actual.length - 1];
  const lastValue = last.value as number;

  const forecast: PricePoint[] = [{ date: last.date, value: lastValue }];
  for (let i = 1; i <= forecastDays; i++) {
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
      `trend nudge (${trend.direction}) forward ${forecastDays} days, not a ` +
      `market forecast.`,
  };
}

/* -------------------------------------------------------------------------
   Seasonal-trend forecast
   ------------------------------------------------------------------------- */

/**
 * An outside influence on price that the series itself cannot show —
 * a sanctions package, a refinery outage, a regulatory date.
 *
 * NOTHING IN THIS REPO PRODUCES THESE YET. The parameter exists so that the
 * news/geopolitics agent this model is meant to grow into has a defined seam to
 * deliver through, rather than the forecast being rewritten around it later.
 * Passing an empty array and passing nothing are the same thing.
 */
export interface ExternalSignal {
  /** What moved — "geopolitical", "supply", "demand", "regulatory". */
  kind: string;
  /** Signed $/mt this signal is judged to be worth by the end of the horizon. */
  impactUsdPerMt: number;
  /** Where it came from. Required: an unattributed adjustment is a fudge. */
  source: string;
}

export interface SeasonalForecastPoint {
  date: string;
  value: number;
  /** Band edges. Widen with the square root of the horizon — see below. */
  lower: number;
  upper: number;
}

export interface SeasonalForecast {
  actual: PricePoint[];
  forecast: SeasonalForecastPoint[];
  method: "seasonal-trend";
  horizonDays: number;
  /**
   * Median days between quotes in this series: 1 for the business-daily
   * columns, 7 for methanol. Read from the data, never assumed — see below.
   */
  cadenceDays: number;
  /**
   * Share of the detrended variance the month-of-year term removes, 0-1.
   * Zero when there was too little history to fit one at all, in which case
   * this is a pure trend projection and says so in `note`.
   */
  seasonalStrength: number;
  /** Signals folded in, for display. Empty unless a caller supplied them. */
  signals: ExternalSignal[];
  note: string;
}

/** Trailing quotes the robust trend is fitted over. */
const TREND_POINTS = 90;

/** Quotes needed before any projection is attempted. */
const MIN_POINTS = 24;

/**
 * Years of history needed before a month-of-year term is fitted.
 *
 * With less than two years a "seasonal" index is fitting one observation per
 * month, which is not seasonality — it is the trend read twice. Below this the
 * model drops the term entirely and reports `seasonalStrength: 0` rather than
 * quietly producing a shape it cannot support.
 */
const MIN_SEASONAL_YEARS = 2;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function monthOf(date: string): number {
  return Number(date.slice(5, 7)) - 1;
}

/** Days in `date`'s own calendar month, for that specific year (handles leap Feb). */
function daysInMonthOf(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Continuous 0-12 position of `date`, with each month's factor anchored at
 * that month's own midpoint (m + 0.5) rather than day-of-year 1-366 — so a
 * leap February doesn't shift every later month's anchor for the year.
 */
function monthPosition(date: string): number {
  const month = Number(date.slice(5, 7)) - 1;
  const dayOfMonth = Number(date.slice(8, 10));
  return month + (dayOfMonth - 0.5) / daysInMonthOf(date);
}

/**
 * The 12 discrete month-of-year factors read back as a smooth, periodic
 * curve rather than a calendar-month step function. A 10-30 day forecast
 * horizon usually sits inside one calendar month, where a raw lookup by
 * month returns the identical factor every day and contributes zero
 * curvature — this is what made the projection a straight line. The two
 * nearest month MIDPOINTS are cosine-eased together (zero derivative at
 * each anchor, so there is no visible kink where two months meet), and
 * Dec/Jan wrap through modular arithmetic, not a special case.
 */
function interpolatedFactor(date: string, factors: number[]): number {
  const p = monthPosition(date) - 0.5;
  const lower = Math.floor(p);
  const t = p - lower;
  const m0 = ((lower % 12) + 12) % 12;
  const m1 = (((lower + 1) % 12) + 12) % 12;
  const blend = (1 - Math.cos(t * Math.PI)) / 2;
  return factors[m0] + (factors[m1] - factors[m0]) * blend;
}

/**
 * Theil-Sen: the median of all pairwise slopes.
 *
 * Chosen over least squares because a bunker series is full of step moves — a
 * sanctions headline, an OPEC decision — and one of those inside the window
 * drags an OLS line to an intercept the market never traded at. The median
 * slope ignores them.
 */
function robustSlopePerDay(points: PricePoint[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const xi = dayNumber(points[i].date);
    const yi = points[i].value as number;
    for (let j = i + 1; j < points.length; j++) {
      const dx = dayNumber(points[j].date) - xi;
      if (dx === 0) continue;
      slopes.push(((points[j].value as number) - yi) / dx);
    }
  }
  return median(slopes);
}

/**
 * Multiplicative month-of-year factors and how much they actually explain,
 * or null when history is too short to fit them.
 *
 * Multiplicative rather than additive because the level of this dataset moves
 * by a factor of two or more across its span — a $40/mt August premium fitted
 * against $300 oil is not a $40 premium against $800 oil, and adding it back
 * would overstate the swing at the top of the range and understate it at the
 * bottom. Ratios survive the re-basing; differences do not.
 */
function monthFactors(
  quoted: PricePoint[],
): { factors: number[]; strength: number } | null {
  const firstDay = dayNumber(quoted[0].date);
  const spanDays = dayNumber(quoted[quoted.length - 1].date) - firstDay;
  if (spanDays < MIN_SEASONAL_YEARS * 365) return null;

  // The centring window has to be one CALENDAR year wide, so it is measured in
  // points-per-year off the dates rather than assumed. A business-daily column
  // carries ~252 points a year, not 365 — sizing the window at 365 points
  // smooths across roughly 17 months and flattens the very shape being fitted.
  const pointsPerYear = Math.max(3, Math.round(quoted.length / (spanDays / 365)));
  const half = Math.max(1, Math.floor(pointsPerYear / 2));
  if (quoted.length < pointsPerYear + 2) return null;

  // Prefix sums: the centred mean is taken at every interior point, and
  // recomputing a ~252-wide window per point would be quadratic on a 1,900-point
  // series for no reason.
  const prefix = new Array<number>(quoted.length + 1).fill(0);
  for (let i = 0; i < quoted.length; i++) {
    prefix[i + 1] = prefix[i] + (quoted[i].value as number);
  }

  const ratios: Array<{ month: number; ratio: number }> = [];
  for (let i = half; i < quoted.length - half; i++) {
    const centred = (prefix[i + half + 1] - prefix[i - half]) / (half * 2 + 1);
    if (centred <= 0) continue;
    ratios.push({
      month: monthOf(quoted[i].date),
      ratio: (quoted[i].value as number) / centred,
    });
  }
  if (ratios.length < 24) return null;

  const sums = new Array<number>(12).fill(0);
  const counts = new Array<number>(12).fill(0);
  for (const r of ratios) {
    sums[r.month] += r.ratio;
    counts[r.month] += 1;
  }

  // A month with no observation cannot be fitted; fall back to neutral rather
  // than to whatever the neighbouring month happened to do.
  const raw = sums.map((sum, m) => (counts[m] > 0 ? sum / counts[m] : 1));

  // Re-centre so the twelve factors average to exactly 1. Without this the
  // seasonal term silently carries a level shift on top of the trend.
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  if (!(mean > 0)) return null;
  const factors = raw.map((f) => f / mean);

  // How much of the detrended scatter the month term removes — an R² of the
  // seasonal fit against the series it was fitted on. Measured here rather than
  // over the trailing trend window, because that window spans about four months
  // and cannot see an annual shape at all.
  let total = 0;
  let residual = 0;
  for (const r of ratios) {
    total += (r.ratio - 1) ** 2;
    residual += (r.ratio / factors[r.month] - 1) ** 2;
  }
  const strength =
    total > 0 ? Math.max(0, Math.min(1, 1 - residual / total)) : 0;

  return { factors, strength };
}

/**
 * A seasonal-trend projection: robust trend, month-of-year shape, widening band.
 *
 * Deliberately a SECOND model rather than a replacement for
 * computePriceForecast above. That one is wired into the spot-match narrative
 * and the route outlook, where it is deliberately the same nudge the winner
 * card shows; changing it would put two disagreeing trend figures in one panel.
 * This one answers a different question for the HQ desk — where does the curve
 * go over the next 10 to 30 days — and is free to use more of the history.
 *
 * CADENCE IS READ FROM THE SERIES. computeTrendSignal's `windowDays` counts
 * POINTS, which silently means seven weeks on the weekly methanol columns
 * rather than seven days. Everything here works in real days off the dates
 * themselves, so a weekly series forecasts a week at a time and a daily one a
 * day at a time.
 *
 * Returns null when there is too little quoted history to fit anything.
 */
export function computeSeasonalForecast(
  points: PricePoint[],
  options: { horizonDays?: number; signals?: ExternalSignal[] } = {},
): SeasonalForecast | null {
  const horizonDays = options.horizonDays ?? 10;
  const signals = options.signals ?? [];

  const quoted = trimNulls(points).filter((p) => p.value !== null);
  if (quoted.length < MIN_POINTS) return null;

  const gaps: number[] = [];
  for (let i = 1; i < quoted.length; i++) {
    gaps.push(dayNumber(quoted[i].date) - dayNumber(quoted[i - 1].date));
  }
  const cadenceDays = Math.max(1, median(gaps));

  const trendWindow = quoted.slice(-TREND_POINTS);
  const slopePerDay = robustSlopePerDay(trendWindow);

  const seasonal = monthFactors(quoted);
  const last = quoted[quoted.length - 1];
  const lastValue = last.value as number;
  const lastDay = dayNumber(last.date);

  // Divide by the anchor date's own interpolated factor so the projection
  // leaves the last actual point at exactly its traded value — a forecast
  // that opens with a jump reads as a bug however defensible the seasonal
  // term is. Deriving this from the same interpolatedFactor() call seasonalAt
  // itself makes is what keeps seasonalAt(last.date) exactly 1 (x / x).
  const anchorFactor = seasonal
    ? interpolatedFactor(last.date, seasonal.factors)
    : 1;

  const seasonalAt = (date: string): number =>
    seasonal ? interpolatedFactor(date, seasonal.factors) / anchorFactor : 1;

  // Fit residuals on the trailing window to size the band. Using the model's
  // own error rather than a fixed percentage means a quiet market gets a tight
  // band and a violent one a wide band, which is the honest behaviour.
  let squaredError = 0;
  for (const point of trendWindow) {
    const modelled =
      (lastValue + slopePerDay * (dayNumber(point.date) - lastDay)) *
      seasonalAt(point.date);
    squaredError += ((point.value as number) - modelled) ** 2;
  }
  const sigma = Math.sqrt(squaredError / trendWindow.length);
  const seasonalStrength = seasonal?.strength ?? 0;

  const signalTotal = signals.reduce((sum, s) => sum + s.impactUsdPerMt, 0);

  const forecast: SeasonalForecastPoint[] = [
    { date: last.date, value: lastValue, lower: lastValue, upper: lastValue },
  ];

  for (let h = 1; h <= horizonDays; h++) {
    const date = addDays(last.date, h);
    // Signals ramp in across the horizon rather than landing on day one: a
    // supply shock prices in over days, and a step at h=1 would dominate the
    // band it sits inside.
    const signalAdj = (signalTotal * h) / horizonDays;
    const value = Math.max(
      0,
      (lastValue + slopePerDay * h) * seasonalAt(date) + signalAdj,
    );
    // sqrt(h): errors accumulate like a random walk, not linearly. A linear
    // band is far too wide by day 30 and reads as having no view at all.
    const spread = sigma * Math.sqrt(h);
    forecast.push({
      date,
      value,
      lower: Math.max(0, value - spread),
      upper: value + spread,
    });
  }

  const seasonalNote = seasonal
    ? `, plus a smoothed month-of-year shape explaining ` +
      `${(seasonalStrength * 100).toFixed(0)}% of the detrended variance`
    : `, with no seasonal term (needs ${MIN_SEASONAL_YEARS} years of history)`;

  return {
    actual: quoted.slice(-HISTORY_DAYS),
    forecast,
    method: "seasonal-trend",
    horizonDays,
    cadenceDays,
    seasonalStrength,
    signals,
    note:
      `Modelled projection, not a market forecast — robust trend over the ` +
      `last ${trendWindow.length} quotes${seasonalNote}. Band is ±1σ ` +
      `of the fit, widening with √days.` +
      (signals.length > 0
        ? ` Includes ${signals.length} external signal(s) worth ` +
          `${signalTotal >= 0 ? "+" : ""}${signalTotal.toFixed(1)} $/mt.`
        : ""),
  };
}
