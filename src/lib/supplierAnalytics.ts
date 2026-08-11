import { num, readCsv, str } from "./csv";
import type { Grade, SupplierTier } from "./types";

/**
 * The evaluation side of a supplier: what it can deliver, how it has quoted
 * over the past year, and what it actually signed at.
 *
 * Imports node:fs through readCsv and must never be pulled into a client
 * bundle — the same rule that governs prices.ts, schedules.ts and suppliers.ts.
 * It is reached only from the /api/hq/analytics route.
 *
 * Three files sit behind this, all generated, all documented in data/README.md
 * under "The supplier-evaluation trio". None of the commercial figures are
 * sourced: no barge count, quote history, contracted price or negotiation
 * outcome exists in any source document. Only the benchmark column and the
 * vessel/quantity on 391 of the transactions are real. Anything presenting
 * these numbers must say so.
 *
 * Everything is indexed once into module-level Maps. supplier_quote_history.csv
 * is ~44k rows (~28k historical "simulated" + ~16k future-dated
 * "simulated-forecast", 30 per surviving supplier-market — see
 * gen-supplier-quote-history.mjs) and supplier_transactions.csv ~7.8k, so a
 * per-request linear scan would be the most expensive thing in the route by a
 * wide margin. buildHistoryAndForecastIndexes() splits the two Source_Basis
 * populations out of supplier_quote_history.csv in one pass.
 */

const FLEET_FILE = "contracts/supplier_fleet.csv";
const HISTORY_FILE = "contracts/supplier_quote_history.csv";
const TRANSACTIONS_FILE = "contracts/supplier_transactions.csv";

export interface SupplierFleet {
  supplier: string;
  portCode: string;
  tier: SupplierTier;
  /** Zero at a shore-supplied port. Not a gap — see below. */
  bargeCount: number;
  totalBargeCapacityMt: number;
  largestBargeMt: number;
  /**
   * Mode-agnostic throughput, populated even where bargeCount is 0. The
   * scatter plots against this rather than barge tonnage precisely so the 51
   * ex-wharf/pipeline-only rows are not silently pinned to the axis.
   */
  deliveryCapacityMtPerDay: number;
  avgBargeAgeYears: number;
  deliveryReliabilityPct: number;
}

/** One supplier's quote at one market on one week, with the benchmark beside it. */
export interface SupplierQuotePoint {
  date: string;
  supplier: string;
  quoteUsdPerMt: number;
  benchmarkUsdPerMt: number;
  diffUsdPerMt: number;
}

/** A settled stem: what was asked, what was signed, and what was expected. */
export interface SupplierTransaction {
  date: string;
  supplier: string;
  vessel: string;
  quantityMt: number;
  quotedUsdPerMt: number;
  contractedUsdPerMt: number;
  benchmarkUsdPerMt: number;
  /** Projected ten days ahead of this date, from data available then only. */
  forecastAtTimeUsdPerMt: number;
  negotiationRounds: number;
  outcome: string;
  /** Vessel and quantity came from the fleet movement series, not a draw. */
  fromFleetStem: boolean;
}

/** One supplier's forward-looking differential, on one future date. */
export interface SupplierForecastPoint {
  date: string;
  diffUsdPerMt: number;
}

let fleetCache: Map<string, SupplierFleet[]> | null = null;
let historyCache: Map<string, SupplierQuotePoint[]> | null = null;
let forecastCache: Map<string, Map<string, SupplierForecastPoint[]>> | null = null;
let transactionCache: Map<string, SupplierTransaction[]> | null = null;

/** Market key. Port and grade together — never one without the other. */
function marketKey(portKey: string, grade: string): string {
  return `${portKey}|${grade}`;
}

function buildFleetIndex(): Map<string, SupplierFleet[]> {
  const index = new Map<string, SupplierFleet[]>();

  for (const row of readCsv(FLEET_FILE).rows) {
    const supplier = str(row, "Supplier");
    const portCode = str(row, "Port_Code");
    const tier = num(row, "Tier");
    const capacity = num(row, "Delivery_Capacity_MT_Per_Day");

    // A fleet row with no throughput cannot be plotted and cannot be scored,
    // so it is dropped rather than surfaced as a supplier with zero capability.
    if (!supplier || !portCode || tier === null || capacity === null) continue;

    const list = index.get(portCode) ?? [];
    list.push({
      supplier,
      portCode,
      tier: tier as SupplierTier,
      bargeCount: num(row, "Barge_Count") ?? 0,
      totalBargeCapacityMt: num(row, "Total_Barge_Capacity_MT") ?? 0,
      largestBargeMt: num(row, "Largest_Barge_MT") ?? 0,
      deliveryCapacityMtPerDay: capacity,
      avgBargeAgeYears: num(row, "Avg_Barge_Age_Years") ?? 0,
      deliveryReliabilityPct: num(row, "Delivery_Reliability_Pct") ?? 0,
    });
    index.set(portCode, list);
  }

  return index;
}

/**
 * Splits supplier_quote_history.csv into its two Source_Basis populations in
 * one pass: "simulated" (a year of real-dated weekly quotes — historyIndex)
 * and "simulated-forecast" (future-dated per-supplier continuations — an
 * inner Map keyed supplier -> ascending points, forecastIndex). One scan
 * rather than two, since the file is ~44k rows.
 */
function buildHistoryAndForecastIndexes(): {
  historyIndex: Map<string, SupplierQuotePoint[]>;
  forecastIndex: Map<string, Map<string, SupplierForecastPoint[]>>;
} {
  const historyIndex = new Map<string, SupplierQuotePoint[]>();
  const forecastIndex = new Map<string, Map<string, SupplierForecastPoint[]>>();

  for (const row of readCsv(HISTORY_FILE).rows) {
    const date = str(row, "Date");
    const portCode = str(row, "Port_Code");
    const grade = str(row, "Grade");
    const supplier = str(row, "Supplier");
    const quote = num(row, "Quote_USD_Per_MT");
    const benchmark = num(row, "Benchmark_USD_Per_MT");
    const diff = num(row, "Diff_USD_Per_MT");
    const sourceBasis = str(row, "Source_Basis");

    // diff is checked for null, not falsiness: 0 is parity with the benchmark
    // and a perfectly ordinary quote. Number("") is 0, which is why str/num
    // return null for a blank and this never uses `!diff`.
    if (
      !date || !portCode || !grade || !supplier ||
      quote === null || benchmark === null || diff === null
    ) {
      continue;
    }

    const key = marketKey(portCode, grade);

    if (sourceBasis === "simulated-forecast") {
      const bySupplier = forecastIndex.get(key) ?? new Map();
      const points = bySupplier.get(supplier) ?? [];
      points.push({ date, diffUsdPerMt: diff });
      bySupplier.set(supplier, points);
      forecastIndex.set(key, bySupplier);
      continue;
    }

    // Anything other than "simulated" (including a blank/unrecognised value)
    // is excluded from the historical series rather than guessed into it —
    // getMarketQuoteHistory's contract is strictly "a year of weekly quotes".
    if (sourceBasis !== "simulated") continue;

    const list = historyIndex.get(key) ?? [];
    list.push({
      date,
      supplier,
      quoteUsdPerMt: quote,
      benchmarkUsdPerMt: benchmark,
      diffUsdPerMt: diff,
    });
    historyIndex.set(key, list);
  }

  for (const bySupplier of forecastIndex.values()) {
    for (const points of bySupplier.values()) {
      points.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return { historyIndex, forecastIndex };
}

function buildTransactionIndex(): Map<string, SupplierTransaction[]> {
  const index = new Map<string, SupplierTransaction[]>();

  for (const row of readCsv(TRANSACTIONS_FILE).rows) {
    const date = str(row, "Date");
    const portCode = str(row, "Port_Code");
    const grade = str(row, "Grade");
    const supplier = str(row, "Supplier");
    const quoted = num(row, "Quoted_USD_Per_MT");
    const contracted = num(row, "Contracted_USD_Per_MT");
    const benchmark = num(row, "Benchmark_USD_Per_MT");
    const forecast = num(row, "Forecast_At_Time_USD_Per_MT");

    if (
      !date || !portCode || !grade || !supplier ||
      quoted === null || contracted === null ||
      benchmark === null || forecast === null
    ) {
      continue;
    }

    const key = marketKey(portCode, grade);
    const list = index.get(key) ?? [];
    list.push({
      date,
      supplier,
      vessel: str(row, "Vessel") ?? "",
      quantityMt: num(row, "Quantity_MT") ?? 0,
      quotedUsdPerMt: quoted,
      contractedUsdPerMt: contracted,
      benchmarkUsdPerMt: benchmark,
      forecastAtTimeUsdPerMt: forecast,
      negotiationRounds: num(row, "Negotiation_Rounds") ?? 0,
      outcome: str(row, "Outcome") ?? "",
      fromFleetStem: (str(row, "Source_Basis") ?? "").includes("fleet stem"),
    });
    index.set(key, list);
  }

  return index;
}

/** Every supplier's delivery capability at a port. Empty for an unknown port. */
export function getPortFleet(portKey: string): SupplierFleet[] {
  if (!fleetCache) fleetCache = buildFleetIndex();
  return fleetCache.get(portKey) ?? [];
}

/**
 * A year of weekly quotes for one port × grade, oldest first.
 *
 * Empty where the market has no assessment in the trailing year — SANTOS HSFO
 * is the one such market, last assessed in 2019. Callers must render that as an
 * explicit empty state, not an empty chart.
 *
 * The covered window is NOT always 52 weeks: Ningbo's methanol market opened in
 * January 2026 and carries 30. Read the span off the rows.
 */
export function getMarketQuoteHistory(
  portKey: string,
  grade: Grade,
): SupplierQuotePoint[] {
  if (!historyCache || !forecastCache) {
    const built = buildHistoryAndForecastIndexes();
    historyCache = built.historyIndex;
    forecastCache = built.forecastIndex;
  }
  const rows = historyCache.get(marketKey(portKey, grade)) ?? [];
  return [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier),
  );
}

/**
 * Each supplier's forward-looking differential at one port × grade, ascending
 * by date. Empty where the market has no quote history at all (the same
 * markets getMarketQuoteHistory returns nothing for).
 *
 * This is NOT a per-supplier price forecast — see SupplierPriceHistory.tsx's
 * doc comment. It is how far each supplier's own quote is projected to sit
 * off the (separately, and more rigorously, forecast) benchmark.
 */
export function getMarketQuoteForecast(
  portKey: string,
  grade: Grade,
): Map<string, SupplierForecastPoint[]> {
  if (!historyCache || !forecastCache) {
    const built = buildHistoryAndForecastIndexes();
    historyCache = built.historyIndex;
    forecastCache = built.forecastIndex;
  }
  return forecastCache.get(marketKey(portKey, grade)) ?? new Map();
}

/** Settled stems for one port × grade, most recent first. */
export function getMarketTransactions(
  portKey: string,
  grade: Grade,
): SupplierTransaction[] {
  if (!transactionCache) transactionCache = buildTransactionIndex();
  const rows = transactionCache.get(marketKey(portKey, grade)) ?? [];
  return [...rows].sort(
    (a, b) => b.date.localeCompare(a.date) || a.supplier.localeCompare(b.supplier),
  );
}

/** The three variance figures the scorecard tiles show, for one supplier. */
export interface SupplierScorecard {
  supplier: string;
  transactionCount: number;
  /** Mean (quote − benchmark) / benchmark. How aggressively they price. */
  quoteVsBenchmarkPct: number;
  /** Mean (contracted − quoted) / quoted. Always ≤ 0 — how far we move them. */
  contractedVsQuotedPct: number;
  /** Mean (contracted − benchmark) / benchmark. What the desk actually realises. */
  contractedVsBenchmarkPct: number;
  /** Mean |contracted − forecast| / forecast. How well the forecast called it. */
  forecastAbsErrorPct: number;
  totalVolumeMt: number;
  lastTradedDate: string | null;
}

/**
 * Roll a market's ledger up per supplier.
 *
 * SCOPED TO ONE PORT × GRADE DELIBERATELY. Averaging a supplier's variance
 * across grades compares a certified renewable product to a fossil one — the
 * tier-3 methanol and biofuel houses quote 14-21% over their own benchmark and
 * concede almost nothing, while the tier-2 traders quote below benchmark and
 * concede ~2.6%. Both are correct inside their own market and meaningless
 * averaged together. data/README.md records this.
 */
export function buildScorecards(
  transactions: SupplierTransaction[],
): SupplierScorecard[] {
  const bySupplier = new Map<string, SupplierTransaction[]>();
  for (const tx of transactions) {
    const list = bySupplier.get(tx.supplier) ?? [];
    list.push(tx);
    bySupplier.set(tx.supplier, list);
  }

  const mean = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

  return [...bySupplier.entries()]
    .map(([supplier, rows]) => ({
      supplier,
      transactionCount: rows.length,
      quoteVsBenchmarkPct: mean(
        rows.map(
          (r) =>
            ((r.quotedUsdPerMt - r.benchmarkUsdPerMt) / r.benchmarkUsdPerMt) * 100,
        ),
      ),
      contractedVsQuotedPct: mean(
        rows.map(
          (r) =>
            ((r.contractedUsdPerMt - r.quotedUsdPerMt) / r.quotedUsdPerMt) * 100,
        ),
      ),
      contractedVsBenchmarkPct: mean(
        rows.map(
          (r) =>
            ((r.contractedUsdPerMt - r.benchmarkUsdPerMt) / r.benchmarkUsdPerMt) *
            100,
        ),
      ),
      forecastAbsErrorPct: mean(
        rows.map(
          (r) =>
            (Math.abs(r.contractedUsdPerMt - r.forecastAtTimeUsdPerMt) /
              r.forecastAtTimeUsdPerMt) *
            100,
        ),
      ),
      totalVolumeMt: rows.reduce((sum, r) => sum + r.quantityMt, 0),
      lastTradedDate:
        rows.map((r) => r.date).sort((a, b) => b.localeCompare(a))[0] ?? null,
    }))
    // Cheapest realised price first: the tile that ranks this list is the one
    // the recommendation reads, so the default order matches the decision.
    .sort((a, b) => a.contractedVsBenchmarkPct - b.contractedVsBenchmarkPct);
}
