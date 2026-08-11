import type { PricePoint } from "./types";
import { trimNulls } from "./series";

/**
 * A momentum nudge, not a forecast — the latest quote against a short trailing
 * average of the quotes before it. No extrapolation, no ARIMA/ETS/forward
 * curve: those live in a separate, out-of-scope forecasting system. This is
 * just "is the market currently running above or below its recent level."
 */
export interface TrendSignal {
  direction: "up" | "down" | "flat";
  /** (latestValue - movingAverage) / movingAverage. */
  magnitudePct: number;
  latestValue: number;
  latestDate: string;
  movingAverage: number;
  windowDays: number;
  /** latestValue - movingAverage, same $/mt units as the price series. */
  nudgeUsdPerMt: number;
}

/** Below this magnitude the signal reads as noise, not a real move. */
const FLAT_THRESHOLD_PCT = 0.01;

/**
 * Computes the trend signal for a port×grade price series.
 *
 * The trailing average deliberately excludes the latest point itself — a
 * point compared against an average that contains it understates its own
 * move. Returns null when there's too little quoted history to say anything
 * (fewer than 3 real quotes, or fewer than 2 in the trailing window), or when
 * the average is 0 (a nudge would be undefined).
 */
export function computeTrendSignal(
  points: PricePoint[],
  windowDays = 7,
): TrendSignal | null {
  const quoted = trimNulls(points).filter((p) => p.value !== null);
  if (quoted.length < 3) return null;

  const latest = quoted[quoted.length - 1];
  const latestValue = latest.value as number;

  const window = quoted.slice(-1 - windowDays, -1);
  if (window.length < 2) return null;

  const movingAverage =
    window.reduce((sum, p) => sum + (p.value as number), 0) / window.length;
  if (movingAverage === 0) return null;

  const nudgeUsdPerMt = latestValue - movingAverage;
  const magnitudePct = nudgeUsdPerMt / movingAverage;
  const direction: TrendSignal["direction"] =
    Math.abs(magnitudePct) < FLAT_THRESHOLD_PCT
      ? "flat"
      : magnitudePct > 0
        ? "up"
        : "down";

  return {
    direction,
    magnitudePct,
    latestValue,
    latestDate: latest.date,
    movingAverage,
    windowDays,
    nudgeUsdPerMt,
  };
}
