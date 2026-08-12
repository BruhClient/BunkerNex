import type { SpotFuelGrade } from "./spotBunker";
import { MGO_TANK_MIN_RATIO, MGO_TANK_RATIO, type SupplierOffer, type VesselSpec } from "./types";

/**
 * A route-wide bunkering recommender: given a vessel's fixed next-port
 * Chief Engineer nomination (untouched by this module — it plans the calls
 * AFTER it) and its next ~5 calls / ~30 days, decides which of those future
 * calls to bunker at, how much, and from which supplier, to minimize total
 * landed cost while respecting ECA eligibility and tank safety margins.
 *
 * Pure and client-safe, no node:fs, same contract as spotMatch.ts: every
 * number here is final, callers (the /api/route-plan route) hand in
 * already-loaded market/forecast/fleet/variance data and an LLM narrative
 * layer, if any, only ever describes this module's output — never
 * recomputes it.
 *
 * NOT an exact/MILP solver. The per-tank search below is the well-known
 * greedy for the idealized continuous "minimum-cost refueling with a tank
 * cap" problem (always transact at the cheapest reachable point, filling to
 * the cap) — provably cost-minimal in that idealized form, but real-world
 * wrinkles (supplier lifting bands, a leg-level rather than position-level
 * ECA burn model — see planRouteBunkering below) make the final 3-plan
 * output a heuristic. Say so in the UI, the same honesty spotMatch.ts and
 * priceForecast.ts already apply to their own limitations.
 */

/** Safe-fill ceiling for THIS recommender only — IMO thermal-expansion
 * margin (a tank must never be filled to 100% capacity). The existing
 * single-port CE nomination form (spotBunker.ts) is untouched and keeps its
 * own 100%-based headroom warnings; this constant is not shared with it. */
export const SAFE_FILL_RATIO = 0.9;

/** Below this, a "purchase" isn't worth recording as its own transaction. */
const MIN_STOP_MT = 5;

/** How close to the reachable window's cheapest price still counts as "good
 * enough" for the fewest-stops strategy, trading a small premium for fewer
 * port calls. */
const FEWEST_STOPS_TOLERANCE_PCT = 0.05;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Inputs the caller (the API route) assembles from already-existing modules
// ---------------------------------------------------------------------------

/** A supplier's delivery throughput at this port — from supplierAnalytics.ts's
 * SupplierFleet, mapped down to just what scoring needs. */
export interface SupplierFleetInfo {
  supplier: string;
  deliveryCapacityMtPerDay: number;
}

/** A supplier's historical contracted-vs-benchmark variance at this port ×
 * grade — from supplierAnalytics.ts's SupplierScorecard. Always the same
 * field the HQ desk's own scorecard ranks by, for one consistent "which
 * supplier actually delivers below benchmark" answer app-wide. */
export interface SupplierVarianceInfo {
  supplier: string;
  contractedVsBenchmarkPct: number;
}

/** Everything routeBunkerPlan needs to evaluate one grade at one call. */
export interface GradeMarket {
  grade: SpotFuelGrade;
  /** getPortMarkets(portCode) offers for this grade — cheapest-first is not
   * assumed here; this module re-sorts by whatever the strategy needs. */
  offers: SupplierOffer[];
  fleet: SupplierFleetInfo[];
  variance: SupplierVarianceInfo[];
  /** Ensemble-forecasted (priceForecast.ts) baseline $/mt at this call's
   * arrival date. Null when there's too little price history to model. */
  forecastBaselineUsdPerMt: number | null;
  /** $/mt carbon cost at this call's arrival date (emissions.ts). */
  emissionsCostUsdPerMt: number | null;
}

/**
 * The client-computable skeleton of one future call — everything
 * `buildLegs`/`isEcaPort`/`portMeta` already give for free, before the
 * server joins in market/forecast/fleet/variance data.
 */
export interface RouteCallInput {
  portCode: string;
  portName: string | null;
  arrivalTimestamp: string;
  daysFromNow: number;
  /** Main-engine burn window for the LEG ARRIVING HERE (from the previous
   * call, or from the fixed nomination's port for the first call). */
  transitDays: number;
  /** Berth burn window at this call, before departing toward the next. */
  portStayDays: number;
  isEcaDestination: boolean;
}

/** One future port call in the planning horizon, server-enriched. */
export interface PlanCall extends RouteCallInput {
  /** Only entries this call's market actually supports. */
  grades: Partial<Record<SpotFuelGrade, GradeMarket>>;
}

// ---------------------------------------------------------------------------
// Supplier composite score
// ---------------------------------------------------------------------------

export interface SupplierScore {
  supplier: string;
  offer: SupplierOffer;
  /** Forecast baseline + this offer's diff + emissions cost — the same
   * price+emissions composition spotMatch.ts's totalCostUsdPerMt uses,
   * just forecasted forward instead of read at today's spot value. */
  forecastedLandedPriceUsdPerMt: number;
  bargeCapacityMtPerDay: number | null;
  contractedVsBenchmarkPct: number | null;
  /** Lower is better. Weighted blend of the three normalized factors below. */
  compositeScore: number;
}

/**
 * Price 65% / barge delivery capacity 15% / contract-vs-quote variance 20%.
 *
 * A documented, adjustable judgment call — the same kind this codebase
 * already makes for MGO_TANK_RATIO and friends — not a fitted or sourced
 * figure. Price dominant per the user's own framing ("favour lower price");
 * capacity and variance are secondary tie-breakers among suppliers already
 * close on price, not enough to override a large price gap on their own.
 */
export const SUPPLIER_SCORE_WEIGHTS = {
  price: 0.65,
  capacity: 0.15,
  variance: 0.2,
} as const;

function minMax(values: number[]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/** Lower raw value is better. Null or a degenerate (all-equal) range scores
 * a neutral 0.5 — no data isn't 0 and isn't worst-case, the same
 * null-discipline the rest of this codebase applies to source CSVs, just
 * for a derived score instead of a blank cell. */
function normLowerBetter(x: number | null, min: number, max: number): number {
  if (x === null || max === min) return 0.5;
  return (x - min) / (max - min);
}

/** Higher raw value is better (e.g. barge capacity). */
function normHigherBetter(x: number | null, min: number, max: number): number {
  if (x === null || max === min) return 0.5;
  return (max - x) / (max - min);
}

/**
 * Scores every offer in one GradeMarket, ascending by compositeScore
 * (best first). Empty when there are no offers or no forecast to price
 * against — the caller can't rank what it can't cost.
 */
export function scoreSuppliers(market: GradeMarket): SupplierScore[] {
  const { offers, fleet, variance, forecastBaselineUsdPerMt, emissionsCostUsdPerMt } = market;
  if (offers.length === 0 || forecastBaselineUsdPerMt === null) return [];

  const fleetByName = new Map(fleet.map((f) => [f.supplier, f]));
  const varianceByName = new Map(variance.map((v) => [v.supplier, v]));
  const emissions = emissionsCostUsdPerMt ?? 0;

  const raw = offers.map((offer) => ({
    offer,
    price: forecastBaselineUsdPerMt + offer.diff + emissions,
    capacity: fleetByName.get(offer.supplier)?.deliveryCapacityMtPerDay ?? null,
    variancePct: varianceByName.get(offer.supplier)?.contractedVsBenchmarkPct ?? null,
  }));

  const [priceMin, priceMax] = minMax(raw.map((r) => r.price));
  const capacities = raw
    .map((r) => r.capacity)
    .filter((c): c is number => c !== null);
  const [capMin, capMax] = capacities.length > 0 ? minMax(capacities) : [0, 0];
  const variances = raw
    .map((r) => r.variancePct)
    .filter((v): v is number => v !== null);
  const [varMin, varMax] = variances.length > 0 ? minMax(variances) : [0, 0];

  return raw
    .map((r) => {
      const normPrice = normLowerBetter(r.price, priceMin, priceMax);
      const normCapacity = normHigherBetter(r.capacity, capMin, capMax);
      const normVariance = normLowerBetter(r.variancePct, varMin, varMax);

      const compositeScore =
        SUPPLIER_SCORE_WEIGHTS.price * normPrice +
        SUPPLIER_SCORE_WEIGHTS.capacity * normCapacity +
        SUPPLIER_SCORE_WEIGHTS.variance * normVariance;

      return {
        supplier: r.offer.supplier,
        offer: r.offer,
        forecastedLandedPriceUsdPerMt: r.price,
        bargeCapacityMtPerDay: r.capacity,
        contractedVsBenchmarkPct: r.variancePct,
        compositeScore,
      } satisfies SupplierScore;
    })
    .sort((a, b) => a.compositeScore - b.compositeScore);
}

function pickCheapest(scores: SupplierScore[]): SupplierScore | null {
  if (scores.length === 0) return null;
  return [...scores].sort(
    (a, b) => a.forecastedLandedPriceUsdPerMt - b.forecastedLandedPriceUsdPerMt,
  )[0];
}

function pickBestComposite(scores: SupplierScore[]): SupplierScore | null {
  // Already sorted ascending by compositeScore in scoreSuppliers.
  return scores.length > 0 ? scores[0] : null;
}

// ---------------------------------------------------------------------------
// Per-tank greedy search
// ---------------------------------------------------------------------------

export interface PlannedStop {
  callIndex: number;
  portCode: string;
  portName: string | null;
  arrivalTimestamp: string;
  tank: "residual" | "compliance";
  grade: SpotFuelGrade;
  quantityMt: number;
  supplier: string;
  priceUsdPerMt: number;
  emissionsCostUsdPerMt: number;
  totalCostUsd: number;
  robBeforeMt: number;
  robAfterMt: number;
  capMt: number;
  floorMt: number;
  /** The two secondary supplier factors behind the composite score (§
   * SUPPLIER_SCORE_WEIGHTS) — null wherever supplierAnalytics.ts has no row
   * for this supplier, same "no data ≠ worst case" reading as the score
   * itself gives it. Carried through for display, not just scoring. */
  bargeCapacityMtPerDay: number | null;
  contractedVsBenchmarkPct: number | null;
  /** One line, grounded in the figures above — no LLM involved. */
  reason: string;
}

type SearchStrategy = "cheapest" | "fewest-stops" | "best-value";

interface TankPlanParams {
  tank: "residual" | "compliance";
  startRobMt: number;
  /** Already ×SAFE_FILL_RATIO. */
  capMt: number;
  floorMt: number;
  burnTransitFor: (callIndex: number) => number;
  burnBerthFor: (callIndex: number) => number;
  calls: PlanCall[];
  /** Grades this tank could lawfully draw from at a given call — 0, 1 or 2
   * entries (a scrubber vessel's residual tank can take either HSFO or
   * VLSFO). Burn eligibility is handled by burnTransitFor/burnBerthFor
   * returning 0 on legs this tank isn't active on, not by this function. */
  gradesAt: (callIndex: number) => SpotFuelGrade[];
  strategy: SearchStrategy;
}

interface ReachEntry {
  index: number;
  robAtArrival: number;
  grade: SpotFuelGrade;
  score: SupplierScore;
}

function planTank(params: TankPlanParams): { stops: PlannedStop[]; warnings: string[] } {
  const {
    tank,
    capMt,
    floorMt,
    burnTransitFor,
    burnBerthFor,
    calls,
    gradesAt,
    strategy,
  } = params;
  const stops: PlannedStop[] = [];
  const warnings: string[] = [];

  let rob = params.startRobMt;
  let pos = 0;

  while (pos < calls.length) {
    const reach: ReachEntry[] = [];
    let cur = rob;
    let breached = false;

    for (let k = pos; k < calls.length; k++) {
      cur -= burnTransitFor(k) * calls[k].transitDays;
      if (cur < floorMt - 1e-6) {
        breached = true;
        break;
      }

      for (const grade of gradesAt(k)) {
        const market = calls[k].grades[grade];
        if (!market) continue;
        const scores = scoreSuppliers(market);
        const chosen =
          strategy === "best-value" ? pickBestComposite(scores) : pickCheapest(scores);
        if (chosen) reach.push({ index: k, robAtArrival: cur, grade, score: chosen });
      }

      cur -= burnBerthFor(k) * calls[k].portStayDays;
      if (cur < floorMt - 1e-6) {
        breached = true;
        break;
      }
    }

    if (reach.length === 0) {
      if (breached) {
        warnings.push(
          `No ${tank} supply call reachable within the horizon before projected ` +
            `ROB would cross the ${Math.round(floorMt)} MT floor.`,
        );
      }
      break;
    }

    const windowMinPrice = Math.min(
      ...reach.map((r) => r.score.forecastedLandedPriceUsdPerMt),
    );
    const target =
      strategy === "fewest-stops"
        ? (reach.find(
            (r) =>
              r.score.forecastedLandedPriceUsdPerMt <=
              windowMinPrice * (1 + FEWEST_STOPS_TOLERANCE_PCT),
          ) ?? reach[0])
        : reach.reduce((best, r) =>
            r.score.forecastedLandedPriceUsdPerMt < best.score.forecastedLandedPriceUsdPerMt
              ? r
              : best,
          );

    const call = calls[target.index];
    const quantityMt = Math.max(0, capMt - target.robAtArrival);

    if (quantityMt >= MIN_STOP_MT) {
      const priceUsdPerMt = target.score.forecastedLandedPriceUsdPerMt;
      const market = call.grades[target.grade];
      const reason = breached
        ? `Cheapest reachable call before ROB would otherwise cross the ${Math.round(floorMt)} MT floor — filled to the 90% cap.`
        : strategy === "fewest-stops"
          ? `Within ${Math.round(FEWEST_STOPS_TOLERANCE_PCT * 100)}% of the cheapest reachable call — filled to the 90% cap to avoid a later stop.`
          : strategy === "best-value"
            ? `Best price + reliability score among reachable suppliers — filled to the 90% cap.`
            : `Cheapest forecasted call reachable within the horizon — filled to the 90% cap.`;

      stops.push({
        callIndex: target.index,
        portCode: call.portCode,
        portName: call.portName,
        arrivalTimestamp: call.arrivalTimestamp,
        tank,
        grade: target.grade,
        quantityMt: round1(quantityMt),
        supplier: target.score.supplier,
        priceUsdPerMt,
        emissionsCostUsdPerMt: market?.emissionsCostUsdPerMt ?? 0,
        totalCostUsd: Math.round(priceUsdPerMt * quantityMt * 100) / 100,
        robBeforeMt: round1(target.robAtArrival),
        robAfterMt: round1(capMt),
        capMt: round1(capMt),
        floorMt: round1(floorMt),
        bargeCapacityMtPerDay: target.score.bargeCapacityMtPerDay,
        contractedVsBenchmarkPct: target.score.contractedVsBenchmarkPct,
        reason,
      });
      rob = capMt;
    } else {
      // Tank's already near the cap on arrival — nothing worth buying here.
      rob = target.robAtArrival;
    }
    pos = target.index + 1;
  }

  return { stops, warnings };
}

// ---------------------------------------------------------------------------
// ROB timeline, for charting a full plan (one tank at a time)
// ---------------------------------------------------------------------------

export interface RobTimelinePoint {
  label: string;
  timestamp: string | null;
  robMt: number;
  capMt: number;
  floorMt: number;
  isBunkerStop: boolean;
}

export function buildRouteRobTimeline(params: {
  startRobMt: number;
  safeCapMt: number;
  floorMt: number;
  burnTransitFor: (callIndex: number) => number;
  burnBerthFor: (callIndex: number) => number;
  calls: PlanCall[];
  /** This tank's stops only. */
  stops: PlannedStop[];
  /** What the first point's label says. Defaults to "Now" — the Chief
   * Engineer's fixed next-port nomination (see planRouteBunkering) passes a
   * label naming its own port/grade/quantity instead, so the graph never
   * silently absorbs that stem into an unlabelled starting figure. */
  startLabel?: string;
}): RobTimelinePoint[] {
  const {
    startRobMt,
    safeCapMt,
    floorMt,
    burnTransitFor,
    burnBerthFor,
    calls,
    stops,
    startLabel = "Now",
  } = params;
  const stopByIndex = new Map(stops.map((s) => [s.callIndex, s]));

  const points: RobTimelinePoint[] = [
    {
      label: startLabel,
      timestamp: null,
      robMt: round1(startRobMt),
      capMt: round1(safeCapMt),
      floorMt: round1(floorMt),
      isBunkerStop: false,
    },
  ];

  let rob = startRobMt;
  for (let k = 0; k < calls.length; k++) {
    rob = Math.max(rob - burnTransitFor(k) * calls[k].transitDays, 0);
    const label = calls[k].portName ?? calls[k].portCode;
    points.push({
      label,
      timestamp: calls[k].arrivalTimestamp,
      robMt: round1(rob),
      capMt: round1(safeCapMt),
      floorMt: round1(floorMt),
      isBunkerStop: false,
    });

    const stop = stopByIndex.get(k);
    if (stop) {
      rob = stop.robAfterMt;
      points.push({
        label: `${label} +${stop.quantityMt} MT`,
        timestamp: calls[k].arrivalTimestamp,
        robMt: round1(rob),
        capMt: round1(safeCapMt),
        floorMt: round1(floorMt),
        isBunkerStop: true,
      });
    }

    rob = Math.max(rob - burnBerthFor(k) * calls[k].portStayDays, 0);
  }

  return points;
}

// ---------------------------------------------------------------------------
// Top-level: three distinct, ranked route plans
// ---------------------------------------------------------------------------

export interface RouteBunkerPlan {
  id: "lowest-cost" | "fewest-stops" | "best-supplier-value";
  label: string;
  /** Residual + compliance stops merged, ordered by arrival. */
  stops: PlannedStop[];
  totalCostUsd: number;
  totalQuantityMt: number;
  stopCount: number;
  warnings: string[];
  robTimeline: { residual: RobTimelinePoint[]; compliance: RobTimelinePoint[] };
}

export interface RouteBunkerPlanInputs {
  spec: VesselSpec;
  calls: PlanCall[];
  /** From SpotContext.carriedGrades — which of HSFO/VLSFO/MGO this hull
   * physically carries, independent of what any one port can supply. */
  carriedGrades: ReadonlySet<SpotFuelGrade>;
  /** ROB right after the fixed nomination's own delivery + departure burn —
   * i.e. where this planner's horizon actually starts from. */
  startResidualRobMt: number;
  startComplianceRobMt: number;
  /**
   * The Chief Engineer's own fixed next-port stem, already folded into
   * startResidualRobMt/startComplianceRobMt above — this is carried through
   * separately purely so the ROB timeline's first point can name it (port,
   * grade, exact MT) rather than showing an unlabelled starting ROB. Null on
   * a direct /route-plan visit with no nomination entered.
   */
  fixedNomination: { grade: SpotFuelGrade; quantityMt: number; portLabel: string } | null;
}

const STRATEGY_LABELS: Record<RouteBunkerPlan["id"], string> = {
  "lowest-cost": "Lowest cost",
  "fewest-stops": "Fewest stops",
  "best-supplier-value": "Best supplier value",
};

function residualGradesFor(carried: ReadonlySet<SpotFuelGrade>): SpotFuelGrade[] {
  const out: SpotFuelGrade[] = [];
  if (carried.has("HSFO")) out.push("HSFO");
  if (carried.has("VLSFO")) out.push("VLSFO");
  return out;
}

/**
 * Plans both tanks under all three strategies and returns the three plans
 * sorted by totalCostUsd ascending — a genuinely cost-based "top 3 ranking,"
 * while each entry keeps its strategy id/label so the UI can say why it's
 * there, not just where it ranks.
 *
 * BURN MODEL SIMPLIFICATION: this plans off leg-level ECA classification
 * (PlanCall.isEcaDestination, one boolean per call — the same granularity
 * SpotContext.isEcaDestination already uses for the single-port CE form),
 * not the generator's finer position-based zone profile
 * (data/derived/eca_zone_windows.json), which isn't available to a forward
 * hypothetical planner. The residual tank is modelled as burning on every
 * non-ECA leg and idle on ECA legs; the compliance tank the exact reverse.
 * This is an approximation of the real Active_Fuel switching behaviour, not
 * a re-simulation of it.
 */
export function planRouteBunkering(input: RouteBunkerPlanInputs): RouteBunkerPlan[] {
  const {
    spec,
    calls,
    carriedGrades,
    startResidualRobMt,
    startComplianceRobMt,
    fixedNomination,
  } = input;

  const residualStartLabel =
    fixedNomination && residualGradesFor(carriedGrades).includes(fixedNomination.grade)
      ? `${fixedNomination.portLabel} +${round1(fixedNomination.quantityMt)} MT ${fixedNomination.grade} (CE fixed)`
      : "Now";
  const complianceStartLabel =
    fixedNomination && fixedNomination.grade === "MGO"
      ? `${fixedNomination.portLabel} +${round1(fixedNomination.quantityMt)} MT MGO (CE fixed)`
      : "Now";

  const residualCapMt = spec.maxRobMt === null ? 0 : spec.maxRobMt * SAFE_FILL_RATIO;
  const residualFloorMt = spec.minRobMt ?? 0;

  const complianceTankMt = spec.maxRobMt === null ? 0 : spec.maxRobMt * MGO_TANK_RATIO;
  const complianceCapMt = complianceTankMt * SAFE_FILL_RATIO;
  const complianceFloorMt = complianceTankMt * MGO_TANK_MIN_RATIO;

  const burnTransit = spec.consumptionTransitMtPerDay ?? 0;
  const burnBerth = spec.consumptionBerthMtPerDay ?? 0;

  // Residual burns outside an ECA (its default fuel); the compliance grade
  // takes over inside one, so residual sits idle there and vice versa.
  const residualBurnTransit = (k: number) => (calls[k].isEcaDestination ? 0 : burnTransit);
  const residualBurnBerth = (k: number) => (calls[k].isEcaDestination ? 0 : burnBerth);
  const complianceBurnTransit = (k: number) => (calls[k].isEcaDestination ? burnTransit : 0);
  const complianceBurnBerth = (k: number) => (calls[k].isEcaDestination ? burnBerth : 0);

  const strategies: RouteBunkerPlan["id"][] = [
    "lowest-cost",
    "fewest-stops",
    "best-supplier-value",
  ];

  const plans = strategies.map((id): RouteBunkerPlan => {
    const searchStrategy: SearchStrategy =
      id === "lowest-cost" ? "cheapest" : id === "fewest-stops" ? "fewest-stops" : "best-value";

    const residual = planTank({
      tank: "residual",
      startRobMt: startResidualRobMt,
      capMt: residualCapMt,
      floorMt: residualFloorMt,
      burnTransitFor: residualBurnTransit,
      burnBerthFor: residualBurnBerth,
      calls,
      gradesAt: (k) => (calls[k].isEcaDestination ? [] : residualGradesFor(carriedGrades)),
      strategy: searchStrategy,
    });

    const compliance = carriedGrades.has("MGO")
      ? planTank({
          tank: "compliance",
          startRobMt: startComplianceRobMt,
          capMt: complianceCapMt,
          floorMt: complianceFloorMt,
          burnTransitFor: complianceBurnTransit,
          burnBerthFor: complianceBurnBerth,
          calls,
          // MGO is purchasable in or out of an ECA (a vessel may top up
          // ahead of one), unlike residual — mirrors SpotContext.eligibleGrades,
          // where outside an ECA eligibleGrades still includes the carried
          // compliance grade.
          gradesAt: () => ["MGO"],
          strategy: searchStrategy,
        })
      : { stops: [], warnings: [] };

    const stops = [...residual.stops, ...compliance.stops].sort((a, b) =>
      a.arrivalTimestamp.localeCompare(b.arrivalTimestamp),
    );
    const totalCostUsd = Math.round(stops.reduce((s, x) => s + x.totalCostUsd, 0) * 100) / 100;
    const totalQuantityMt = round1(stops.reduce((s, x) => s + x.quantityMt, 0));

    return {
      id,
      label: STRATEGY_LABELS[id],
      stops,
      totalCostUsd,
      totalQuantityMt,
      stopCount: stops.length,
      warnings: [...residual.warnings, ...compliance.warnings],
      robTimeline: {
        residual: buildRouteRobTimeline({
          startRobMt: startResidualRobMt,
          safeCapMt: residualCapMt,
          floorMt: residualFloorMt,
          burnTransitFor: residualBurnTransit,
          burnBerthFor: residualBurnBerth,
          calls,
          stops: residual.stops,
          startLabel: residualStartLabel,
        }),
        compliance: buildRouteRobTimeline({
          startRobMt: startComplianceRobMt,
          safeCapMt: complianceCapMt,
          floorMt: complianceFloorMt,
          burnTransitFor: complianceBurnTransit,
          burnBerthFor: complianceBurnBerth,
          calls,
          stops: compliance.stops,
          startLabel: complianceStartLabel,
        }),
      },
    };
  });

  return plans.sort((a, b) => a.totalCostUsd - b.totalCostUsd);
}
