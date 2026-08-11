import { isResidual, tankFor, type SpotBunkerRequest, type SpotContext, type SpotFuelGrade } from "./spotBunker";
import type { PortMarket, SupplierOffer, VesselGrade } from "./types";
import type { TrendSignal } from "./priceTrend";
import type { Co2eCostPoint } from "./emissions";

/**
 * Deterministic filter → score → rank pipeline for a spot bunker requirement
 * against one port's supplier offers. Pure — takes already-loaded data as
 * arguments so it has no node:fs dependency and is independently testable.
 *
 * Every number here is final. The one LLM call downstream (src/app/api/
 * spot-match/route.ts) is only ever handed this output to narrate — it never
 * recomputes or overrides anything produced here.
 */

export interface MatchInputs {
  request: SpotBunkerRequest;
  ctx: SpotContext;
  /** getPortMarkets(ctx.portCode), already filtered to request.grade. */
  market: PortMarket | null;
  emissionsCostUsdPerMt: number | null;
  trend: TrendSignal | null;
}

export interface RankedOffer {
  offer: SupplierOffer;
  priceUsdPerMt: number;
  emissionsCostUsdPerMt: number;
  trendNudgeUsdPerMt: number;
  totalCostUsdPerMt: number;
  totalCostUsd: number;
  reasons: string[];
}

export interface DisqualifiedOffer {
  offer: SupplierOffer;
  reason: string;
}

export interface SpotMatchResult {
  grade: SpotFuelGrade | null;
  portCode: string | null;
  /** Feasible offers, ascending by totalCostUsdPerMt. */
  candidates: RankedOffer[];
  disqualified: DisqualifiedOffer[];
  /** candidates[0], or null when nothing survived filtering. */
  winner: RankedOffer | null;
  /** Soft issues that never disqualify an offer — e.g. tank headroom. */
  warnings: string[];
  trend: TrendSignal | null;
  emissionsCostUsdPerMt: number | null;
  computedAt: string;
}

export function matchSpotRequest(inputs: MatchInputs): SpotMatchResult {
  const { request, ctx, market, emissionsCostUsdPerMt, trend } = inputs;
  const { grade, nominationMt } = request;
  const computedAt = new Date().toISOString();
  const warnings: string[] = [];

  const empty = (reason: string): SpotMatchResult => ({
    grade,
    portCode: ctx.portCode,
    candidates: [],
    disqualified: [],
    winner: null,
    warnings: [reason],
    trend,
    emissionsCostUsdPerMt,
    computedAt,
  });

  if (grade === null) return empty("No grade nominated.");
  if (nominationMt === null || nominationMt <= 0) {
    return empty("No valid nomination quantity.");
  }

  const tank = tankFor(grade);
  const portLabel = ctx.portName ?? ctx.portCode ?? "this port";

  if (!ctx.markets[tank]) {
    return empty(`No bunker market for ${grade} at ${portLabel}.`);
  }
  if (!market || market.offers.length === 0) {
    return empty(`No supplier offers quoted for ${grade} at ${portLabel}.`);
  }

  // Tank headroom mirrors validateSpotRequest()'s own treatment: projected on
  // arrival, a derived figure rather than a measured tank, so it can only
  // ever warn — never disqualify.
  const headroom = isResidual(grade) ? ctx.residualHeadroomMt : ctx.mgoHeadroomMt;
  if (headroom !== null && nominationMt > headroom) {
    warnings.push(
      `${Math.round(nominationMt)} MT exceeds the ${Math.round(headroom)} MT estimated tank headroom on arrival.`,
    );
  }

  const disqualified: DisqualifiedOffer[] = [];
  const survivors: SupplierOffer[] = [];

  for (const offer of market.offers) {
    if (nominationMt < offer.minMt || nominationMt > offer.maxMt) {
      disqualified.push({
        offer,
        reason: `Nomination of ${Math.round(nominationMt)} MT is outside ${offer.supplier}'s ${Math.round(offer.minMt)}–${Math.round(offer.maxMt)} MT lifting band.`,
      });
      continue;
    }
    if (ctx.daysToArrival !== null && offer.leadTimeDays > ctx.daysToArrival) {
      disqualified.push({
        offer,
        reason: `${offer.supplier}'s ${offer.leadTimeDays}-day lead time exceeds the ${ctx.daysToArrival} days to arrival.`,
      });
      continue;
    }
    survivors.push(offer);
  }

  if (survivors.length === 0) {
    return {
      grade,
      portCode: ctx.portCode,
      candidates: [],
      disqualified,
      winner: null,
      warnings,
      trend,
      emissionsCostUsdPerMt,
      computedAt,
    };
  }

  // Emissions cost and the trend nudge are port/grade-level, not
  // supplier-level — every survivor gets the same two figures, so ranking
  // among survivors is driven by offer.price. The composite number's job is
  // an honest total-landed-cost per tonne, not reshuffling suppliers on
  // emissions/trend: no data source in this repo differentiates either one
  // per supplier.
  const emissionsNudge = emissionsCostUsdPerMt ?? 0;
  const trendNudge = trend?.nudgeUsdPerMt ?? 0;

  const candidates: RankedOffer[] = survivors
    .map((offer) => {
      const totalCostUsdPerMt = offer.price + emissionsNudge + trendNudge;
      return {
        offer,
        priceUsdPerMt: offer.price,
        emissionsCostUsdPerMt: emissionsNudge,
        trendNudgeUsdPerMt: trendNudge,
        totalCostUsdPerMt,
        totalCostUsd: Math.round(totalCostUsdPerMt * nominationMt * 100) / 100,
        reasons: [] as string[],
      };
    })
    .sort((a, b) => a.totalCostUsdPerMt - b.totalCostUsdPerMt);

  const winnerCost = candidates[0].totalCostUsdPerMt;
  for (const [i, c] of candidates.entries()) {
    c.reasons = [
      i === 0
        ? `Lowest total landed cost at $${c.totalCostUsdPerMt.toFixed(2)}/mt.`
        : `$${(c.totalCostUsdPerMt - winnerCost).toFixed(2)}/mt more than the winning offer.`,
      `${c.offer.leadTimeDays}-day lead time fits the ${ctx.daysToArrival ?? "unstated"} days to arrival.`,
      `${Math.round(nominationMt)} MT nomination fits the ${Math.round(c.offer.minMt)}–${Math.round(c.offer.maxMt)} MT lifting band.`,
    ];
  }

  return {
    grade,
    portCode: ctx.portCode,
    candidates,
    disqualified,
    winner: candidates[0],
    warnings,
    trend,
    emissionsCostUsdPerMt,
    computedAt,
  };
}

/**
 * Resolves a Co2eCostPoint series (daily, 2026-05-05→2026-08-05) to the
 * figure nearest a target wall-clock timestamp, clamped to the series' own
 * range when the timestamp falls outside it. Series is tiny (~67 rows), so a
 * linear scan is simpler than a binary search and just as fast in practice.
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
