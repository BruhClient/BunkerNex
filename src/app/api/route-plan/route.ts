import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { loadCo2eCostSeries } from "@/lib/emissions";
import {
  computeForecastEnsemble,
  computeMeanReversionForecast,
  computePriceForecast,
  computeSeasonalForecast,
  type ForecastEnsemblePoint,
  type MeanReversionForecast,
  type PriceForecast,
  type SeasonalForecast,
} from "@/lib/priceForecast";
import { computeTrendSignal } from "@/lib/priceTrend";
import { getPortPrices } from "@/lib/prices";
import {
  planRouteBunkering,
  type GradeMarket,
  type PlanCall,
  type RouteBunkerPlan,
  type RouteCallInput,
  type SupplierFleetInfo,
  type SupplierVarianceInfo,
} from "@/lib/routeBunkerPlan";
import { tankFor, type SpotContext, type SpotFuelGrade } from "@/lib/spotBunker";
import { resolveEmissionsCostUsdPerMt } from "@/lib/spotMatch";
import { buildScorecards, getMarketTransactions, getPortFleet } from "@/lib/supplierAnalytics";
import { getPortMarkets } from "@/lib/suppliers";
import { MGO_TANK_RATIO, type VesselSpec } from "@/lib/types";

/**
 * Assembles a route-wide bunkering plan: joins together five already-existing
 * data sources (prices, supplier markets, barge fleet, contract-vs-quote
 * variance, carbon cost) that today are each reached by a different route,
 * runs the three forecast models + ensemble per candidate call, and hands
 * everything to planRouteBunkering (pure, deterministic — every cost/quantity
 * figure in the response comes from there). An optional Claude haiku call
 * narrates the already-ranked plans in a few short bullets; it is never asked
 * to compute or reorder anything.
 *
 * Same server/pure split as /api/spot-match: node:fs-backed reads happen
 * only in this file.
 */

const MODEL = "claude-haiku-4-5";
const NARRATIVE_HORIZON_CANDIDATES: SpotFuelGrade[] = ["HSFO", "VLSFO", "MGO"];

interface FixedNomination {
  grade: SpotFuelGrade;
  quantityMt: number;
}

interface RequestBody {
  spec: VesselSpec;
  ctx: SpotContext;
  /**
   * ctx.carriedGrades is a Set — JSON.stringify turns it into "{}", which is
   * not iterable, so the client sends it separately as a plain array rather
   * than this route trying to read it back off ctx.
   */
  carriedGrades: SpotFuelGrade[];
  fixedNomination: FixedNomination | null;
  horizonCalls: RouteCallInput[];
}

export interface CallForecast {
  grade: SpotFuelGrade;
  trend: PriceForecast | null;
  seasonal: SeasonalForecast | null;
  meanReversion: MeanReversionForecast | null;
  ensemble: ForecastEnsemblePoint[];
}

export interface RoutePlanApiResponse {
  plans: RouteBunkerPlan[];
  /** portCode -> grade -> the 3 models + ensemble, for the comparison chart. */
  forecasts: Record<string, Partial<Record<SpotFuelGrade, CallForecast>>>;
  narrative: RoutePlanNarrative | null;
  narrativeError: string | null;
}

export interface RoutePlanNarrative {
  headline: string;
  reasons: string[];
  planNotes: { id: string; note: string }[];
}

const NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One sentence naming the cheapest plan's total cost and the $ gap to the next-cheapest plan.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description:
        "2 to 4 short bullets grounded only in the given figures, explaining why the cheapest plan wins on cost.",
    },
    planNotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          note: { type: "string" },
        },
        required: ["id", "note"],
        additionalProperties: false,
      },
      description:
        "One short sentence per given plan id, using only its own figures — why it's ranked where it is.",
    },
  },
  required: ["headline", "reasons", "planNotes"],
  additionalProperties: false,
} as const;

function applyFixedNomination(
  ctx: SpotContext,
  spec: VesselSpec,
  fixedNomination: FixedNomination | null,
): { startResidualRobMt: number; startComplianceRobMt: number } {
  const residualAtArrival =
    spec.maxRobMt === null || ctx.residualHeadroomMt === null
      ? 0
      : spec.maxRobMt - ctx.residualHeadroomMt;
  const complianceCapacityMt = spec.maxRobMt === null ? null : spec.maxRobMt * MGO_TANK_RATIO;
  const complianceAtArrival =
    complianceCapacityMt === null || ctx.mgoHeadroomMt === null
      ? 0
      : complianceCapacityMt - ctx.mgoHeadroomMt;

  let residual = residualAtArrival;
  let compliance = complianceAtArrival;
  if (fixedNomination) {
    if (fixedNomination.grade === "MGO") compliance += fixedNomination.quantityMt;
    else residual += fixedNomination.quantityMt;
  }

  // Same leg-level ECA simplification planRouteBunkering itself documents:
  // only the active tank burns down over the fixed-nomination port's own
  // berth stay.
  const berthDays = ctx.portStayDays ?? 0;
  const berthRate = spec.consumptionBerthMtPerDay ?? 0;
  residual = Math.max(residual - (ctx.isEcaDestination ? 0 : berthRate * berthDays), 0);
  compliance = Math.max(compliance - (ctx.isEcaDestination ? berthRate * berthDays : 0), 0);

  return { startResidualRobMt: residual, startComplianceRobMt: compliance };
}

function buildCallForecast(portCode: string, grade: SpotFuelGrade, horizonDays: number): CallForecast {
  const series = getPortPrices(portCode)[grade] ?? [];
  const trendSignal = computeTrendSignal(series);
  const trend = computePriceForecast(series, trendSignal, horizonDays);
  const seasonal = computeSeasonalForecast(series, { horizonDays });
  const meanReversion = computeMeanReversionForecast(series, { horizonDays });
  const ensemble = computeForecastEnsemble(trend, seasonal, meanReversion);
  return { grade, trend, seasonal, meanReversion, ensemble };
}

function buildGradeMarket(
  portCode: string,
  grade: SpotFuelGrade,
  arrivalTimestamp: string,
  forecast: CallForecast,
): GradeMarket | null {
  const offers = getPortMarkets(portCode).find((m) => m.grade === grade)?.offers ?? [];
  if (offers.length === 0) return null;

  const fleet: SupplierFleetInfo[] = getPortFleet(portCode).map((f) => ({
    supplier: f.supplier,
    deliveryCapacityMtPerDay: f.deliveryCapacityMtPerDay,
  }));
  const scorecards = buildScorecards(getMarketTransactions(portCode, grade));
  const variance: SupplierVarianceInfo[] = scorecards.map((s) => ({
    supplier: s.supplier,
    contractedVsBenchmarkPct: s.contractedVsBenchmarkPct,
  }));

  const forecastBaselineUsdPerMt = forecast.ensemble.at(-1)?.value ?? null;
  const emissionsCostUsdPerMt = resolveEmissionsCostUsdPerMt(
    loadCo2eCostSeries(),
    tankFor(grade),
    arrivalTimestamp,
  );

  return {
    grade,
    offers,
    fleet,
    variance,
    forecastBaselineUsdPerMt,
    emissionsCostUsdPerMt,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RequestBody>;
  const { spec, ctx, carriedGrades: carriedGradesInput, fixedNomination = null, horizonCalls } = body;

  if (!spec || !ctx || !horizonCalls || !carriedGradesInput) {
    return NextResponse.json(
      { error: "Missing spec, ctx, carriedGrades, or horizonCalls." },
      { status: 400 },
    );
  }
  if (horizonCalls.length === 0) {
    return NextResponse.json(
      { error: "No future calls in the planning horizon." },
      { status: 400 },
    );
  }

  const { startResidualRobMt, startComplianceRobMt } = applyFixedNomination(
    ctx,
    spec,
    fixedNomination,
  );

  const forecasts: RoutePlanApiResponse["forecasts"] = {};
  const calls: PlanCall[] = horizonCalls.map((call) => {
    const horizonDays = Math.max(1, Math.ceil(call.daysFromNow));
    const grades: PlanCall["grades"] = {};
    const perPortForecasts: Partial<Record<SpotFuelGrade, CallForecast>> = {};

    for (const grade of NARRATIVE_HORIZON_CANDIDATES) {
      const forecast = buildCallForecast(call.portCode, grade, horizonDays);
      perPortForecasts[grade] = forecast;
      const market = buildGradeMarket(call.portCode, grade, call.arrivalTimestamp, forecast);
      if (market) grades[grade] = market;
    }

    forecasts[call.portCode] = perPortForecasts;
    return { ...call, grades };
  });

  const carriedGrades = new Set<SpotFuelGrade>(carriedGradesInput);

  const plans = planRouteBunkering({
    spec,
    calls,
    carriedGrades,
    startResidualRobMt,
    startComplianceRobMt,
  });

  const { narrative, error: narrativeError } = await generateNarrative(plans);

  return NextResponse.json({
    plans,
    forecasts,
    narrative,
    narrativeError,
  } satisfies RoutePlanApiResponse);
}

async function generateNarrative(
  plans: RouteBunkerPlan[],
): Promise<{ narrative: RoutePlanNarrative | null; error: string | null }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { narrative: null, error: "ANTHROPIC_API_KEY is not configured." };
  }
  if (plans.every((p) => p.stopCount === 0)) {
    return { narrative: null, error: null };
  }

  const summary = plans.map((p) => ({
    id: p.id,
    label: p.label,
    totalCostUsd: p.totalCostUsd,
    totalQuantityMt: p.totalQuantityMt,
    stopCount: p.stopCount,
    stops: p.stops.map((s) => ({
      port: s.portName ?? s.portCode,
      grade: s.grade,
      quantityMt: s.quantityMt,
      supplier: s.supplier,
      priceUsdPerMt: s.priceUsdPerMt,
    })),
    warnings: p.warnings,
  }));

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 640,
      system:
        "You are writing a very short procurement explanation for a route-wide " +
        "bunkering recommendation. Every number below is already computed and " +
        "final — do not recompute, alter, invent, or contradict any figure. " +
        "The plans array is already sorted cheapest-first. Reference only the " +
        "given values. Keep everything terse — this sits next to charts that " +
        "already show the numbers, so prose should not restate every stop, " +
        "only the headline reasoning.",
      output_config: {
        format: { type: "json_schema", schema: NARRATIVE_SCHEMA },
      },
      messages: [{ role: "user", content: JSON.stringify({ plans: summary }) }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { narrative: null, error: "No narrative text returned." };
    }
    return { narrative: JSON.parse(textBlock.text) as RoutePlanNarrative, error: null };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return { narrative: null, error: "Rate limited while generating the explanation." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { narrative: null, error: "Could not reach the narrative service." };
    }
    if (err instanceof Anthropic.APIError) {
      return { narrative: null, error: `Narrative generation failed: ${err.message}` };
    }
    return { narrative: null, error: "Narrative generation failed unexpectedly." };
  }
}
