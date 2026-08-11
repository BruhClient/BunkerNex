import { computePriceForecast, type PriceForecast } from "./priceForecast";
import { computeTrendSignal, type TrendSignal } from "./priceTrend";
import type { SpotFuelGrade } from "./spotBunker";
import type { PricePoint } from "./types";

/**
 * One future port call on the vessel's remaining route, and what the
 * currently-nominated grade is projected to cost there — the forecast
 * horizon is matched to that call's own arrival date, not a fixed window.
 */
export interface RoutePriceOutlookEntry {
  portCode: string;
  portName: string | null;
  arrivalTimestamp: string;
  daysFromNow: number;
  grade: SpotFuelGrade;
  trend: TrendSignal | null;
  /** Null when there's too little price history at this port to project. */
  forecast: PriceForecast | null;
}

export interface FutureCall {
  portCode: string;
  arrivalTimestamp: string;
  daysFromNow: number;
}

/**
 * Forecasts the same nominated grade at every remaining port on the
 * vessel's route — not a different grade per port, which would mean
 * pulling in the fleet simulation's own grade-assignment logic. A port with
 * no price history for this grade still gets an entry (forecast: null)
 * rather than being dropped, so the gap stays visible.
 */
export function computeRoutePriceOutlook(params: {
  grade: SpotFuelGrade;
  futureCalls: FutureCall[];
  seriesFor: (portCode: string) => PricePoint[];
  nameFor: (portCode: string) => string | null;
}): RoutePriceOutlookEntry[] {
  const { grade, futureCalls, seriesFor, nameFor } = params;

  return futureCalls.map((call) => {
    const series = seriesFor(call.portCode);
    const trend = computeTrendSignal(series);
    const forecast = computePriceForecast(
      series,
      trend,
      Math.max(1, Math.ceil(call.daysFromNow)),
    );

    return {
      portCode: call.portCode,
      portName: nameFor(call.portCode),
      arrivalTimestamp: call.arrivalTimestamp,
      daysFromNow: call.daysFromNow,
      grade,
      trend,
      forecast,
    };
  });
}
