import { matchSpotRequest, type SpotMatchResult } from "./spotMatch";
import { tankFor, type SpotBunkerRequest, type SpotContext, type SpotFuelGrade } from "./spotBunker";
import type { TrendSignal } from "./priceTrend";
import type { PortMarket } from "./types";

/**
 * A read-only nudge, not a second nomination: while a vessel is stemming a
 * compliance grade for an ECA, the port may also sell HSFO/VLSFO at a
 * favorable price — worth topping up now for after the vessel leaves the
 * ECA and switches back to burning residual fuel. Nothing here commits
 * anything; acting on it means the CE submits a separate nomination.
 */
export interface OpportunisticTopUp {
  grade: SpotFuelGrade;
  /** Residual tank headroom at evaluation time — a ceiling, not a quote. */
  suggestedQuantityMt: number;
  trend: TrendSignal;
  /** Full ranked result for the synthetic ask, reusing matchSpotRequest verbatim. */
  match: SpotMatchResult;
  rationale: string;
}

/** Below this, a suggestion would name a top-up nobody could act on. */
const MIN_HEADROOM_MT = 25;

function rationaleFor(grade: SpotFuelGrade, headroomMt: number, trend: TrendSignal): string {
  const move =
    trend.direction === "down"
      ? `has trended down $${Math.abs(trend.nudgeUsdPerMt).toFixed(0)}/mt over the last ${trend.windowDays} days`
      : `is flat over the last ${trend.windowDays} days`;
  return `${grade} here ${move} — headroom for ~${Math.round(headroomMt)} MT before you'd need to stem it again.`;
}

/**
 * Evaluates 0–2 opportunistic residual top-ups alongside a compliance-grade
 * (MGO/LSMGO) nomination inside an ECA. Reuses matchSpotRequest unmodified
 * for the ranking itself — this only decides whether to ask, not how to rank.
 */
export function evaluateOpportunisticTopUps(params: {
  request: SpotBunkerRequest;
  ctx: SpotContext;
  candidateGrades: SpotFuelGrade[];
  trendFor: (grade: SpotFuelGrade) => TrendSignal | null;
  marketFor: (grade: SpotFuelGrade) => PortMarket | null;
  emissionsCostFor: (grade: SpotFuelGrade) => number | null;
}): OpportunisticTopUp[] {
  const { request, ctx, candidateGrades, trendFor, marketFor, emissionsCostFor } = params;

  if (request.grade !== "MGO" && request.grade !== "LSMGO") return [];
  if (!ctx.isEcaDestination) return [];
  if (ctx.residualHeadroomMt === null || ctx.residualHeadroomMt <= MIN_HEADROOM_MT) {
    return [];
  }

  const headroomMt = ctx.residualHeadroomMt;
  const results: OpportunisticTopUp[] = [];

  for (const grade of candidateGrades) {
    if (!ctx.markets[tankFor(grade)]) continue;

    const trend = trendFor(grade);
    if (trend === null || trend.direction === "up") continue;

    const market = marketFor(grade);
    const match = matchSpotRequest({
      request: { ...request, grade, nominationMt: headroomMt },
      ctx,
      market,
      emissionsCostUsdPerMt: emissionsCostFor(grade),
      trend,
    });

    if (match.winner === null) continue;

    results.push({
      grade,
      suggestedQuantityMt: headroomMt,
      trend,
      match,
      rationale: rationaleFor(grade, headroomMt, trend),
    });
  }

  return results.sort(
    (a, b) => (a.match.winner?.totalCostUsdPerMt ?? 0) - (b.match.winner?.totalCostUsdPerMt ?? 0),
  );
}
