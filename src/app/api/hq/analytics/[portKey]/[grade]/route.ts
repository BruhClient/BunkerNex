import { NextResponse } from "next/server";
import { GRADE_ORDER } from "@/lib/colors";
import { computeSeasonalForecast } from "@/lib/priceForecast";
import { getPortPrices } from "@/lib/prices";
import { getPortMarkets } from "@/lib/suppliers";
import {
  buildScorecards,
  getMarketQuoteHistory,
  getMarketTransactions,
  getPortFleet,
} from "@/lib/supplierAnalytics";
import type { SeasonalForecast } from "@/lib/priceForecast";
import type {
  SupplierFleet,
  SupplierQuotePoint,
  SupplierScorecard,
  SupplierTransaction,
} from "@/lib/supplierAnalytics";
import type { Grade, PortMarket } from "@/lib/types";

/**
 * Everything the HQ desk needs about one port × grade, in one call.
 *
 * Split by market rather than by port because the payload is dominated by the
 * quote history: ~29k rows across the file, of which one market is ~200-260.
 * Shipping a whole port's grades would multiply that for data the desk cannot
 * look at simultaneously — the workbench shows one fuel at a time.
 *
 * The two forecasts are computed HERE, from the full daily benchmark series,
 * and only their trimmed output crosses the wire. Sending seven years of daily
 * quotes so the client could fit its own would be the largest thing in the
 * response by an order of magnitude.
 */
export interface HqAnalyticsResponse {
  portKey: string;
  grade: Grade;
  /** Delivery capability per supplier at this port. */
  fleet: SupplierFleet[];
  /** Weekly quotes with the benchmark alongside. May be empty. */
  quoteHistory: SupplierQuotePoint[];
  /** Settled stems, most recent first. May be empty. */
  transactions: SupplierTransaction[];
  /** Per-supplier variance figures, best realised price first. */
  scorecards: SupplierScorecard[];
  /** Live offers, the same shape the port panel renders. Null with no market. */
  market: PortMarket | null;
  forecast10: SeasonalForecast | null;
  forecast30: SeasonalForecast | null;
}

function isGrade(value: string): value is Grade {
  return (GRADE_ORDER as readonly string[]).includes(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portKey: string; grade: string }> },
) {
  const { portKey, grade: rawGrade } = await params;
  const grade = decodeURIComponent(rawGrade);

  // A grade outside the known set is a bad URL, not an empty market. Answering
  // 200 with nothing would make a typo indistinguishable from a port that
  // genuinely does not sell the fuel.
  if (!isGrade(grade)) {
    return NextResponse.json(
      { error: `Unknown grade "${grade}".` },
      { status: 400 },
    );
  }

  const quoteHistory = getMarketQuoteHistory(portKey, grade);
  const transactions = getMarketTransactions(portKey, grade);

  const benchmark = getPortPrices(portKey)[grade] ?? [];
  const forecast10 = computeSeasonalForecast(benchmark, { horizonDays: 10 });
  const forecast30 = computeSeasonalForecast(benchmark, { horizonDays: 30 });

  const market =
    getPortMarkets(portKey).find((entry) => entry.grade === grade) ?? null;

  const payload: HqAnalyticsResponse = {
    portKey,
    grade,
    fleet: getPortFleet(portKey),
    quoteHistory,
    transactions,
    scorecards: buildScorecards(transactions),
    market,
    forecast10,
    forecast30,
  };

  return NextResponse.json(payload);
}
