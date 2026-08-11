import { isResidual, shiftTimestamp, type SpotBunkerRequest, type SpotContext } from "./spotBunker";
import type { RankedOffer } from "./spotMatch";
import type { VesselSpec } from "./types";

/**
 * Cost breakdown + ROB trajectory for the winning offer, computed server-side
 * alongside the matching pipeline so the numbers the client charts are
 * identical to what the LLM narrative was given to describe.
 *
 * Reuses fields already on SpotContext/SpotBunkerRequest (robMt,
 * projectedConsumptionMt, portStayDays — all CE-editable, already what the
 * rest of the form trusts) rather than re-deriving the fleet's
 * generator-only energy-based consumption model, which lives only in
 * scripts/gen-vessel-movement.mjs and isn't importable from src/.
 */

export interface CostBreakdown {
  priceUsdPerMt: number;
  nominationMt: number;
  fuelCostUsd: number;
  emissionsCostUsd: number;
  /** Shown separately — a market-timing signal, not a real cost line. */
  trendNoteUsdPerMt: number;
  totalLandedCostUsd: number;
}

export interface RobPoint {
  label: string;
  /** Wall-clock "YYYY-MM-DD HH:mm", same opaque convention as elsewhere. */
  timestamp: string | null;
  robMt: number;
  note?: string;
}

export interface BunkeringSimulation {
  costBreakdown: CostBreakdown;
  robTimeline: RobPoint[];
  headroomExceeded: boolean;
}

/** Length of the illustrative continuation past departure. */
const ILLUSTRATIVE_TAIL_DAYS = 7;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function simulateBunkering(
  request: SpotBunkerRequest,
  ctx: SpotContext,
  spec: VesselSpec,
  winner: RankedOffer,
): BunkeringSimulation {
  const grade = request.grade;
  const nominationMt = request.nominationMt ?? 0;

  const fuelCostUsd = Math.round(winner.priceUsdPerMt * nominationMt * 100) / 100;
  const emissionsCostUsd =
    Math.round(winner.emissionsCostUsdPerMt * nominationMt * 100) / 100;
  const costBreakdown: CostBreakdown = {
    priceUsdPerMt: winner.priceUsdPerMt,
    nominationMt,
    fuelCostUsd,
    emissionsCostUsd,
    trendNoteUsdPerMt: winner.trendNudgeUsdPerMt,
    totalLandedCostUsd: Math.round((fuelCostUsd + emissionsCostUsd) * 100) / 100,
  };

  const robNow = request.robMt ?? 0;
  const burnToArrival = request.projectedConsumptionMt ?? 0;
  const robAtArrival = Math.max(robNow - burnToArrival, 0);
  const robAfterDelivery = robAtArrival + nominationMt;

  const headroom =
    grade !== null && isResidual(grade) ? ctx.residualHeadroomMt : ctx.mgoHeadroomMt;
  const capacityMt = headroom !== null ? robAtArrival + headroom : null;
  const headroomExceeded = capacityMt !== null && robAfterDelivery > capacityMt;

  const berthRate = spec.consumptionBerthMtPerDay ?? 0;
  const portStayDays = request.portStayDays ?? 0;
  const robAtDeparture = Math.max(robAfterDelivery - berthRate * portStayDays, 0);

  const transitRate = spec.consumptionTransitMtPerDay ?? 0;
  const robAfterTail = Math.max(
    robAtDeparture - transitRate * ILLUSTRATIVE_TAIL_DAYS,
    0,
  );

  const departureTimestamp = ctx.departureTimestamp;
  const tailTimestamp = departureTimestamp
    ? shiftTimestamp(departureTimestamp, ILLUSTRATIVE_TAIL_DAYS * 24)
    : null;

  const robTimeline: RobPoint[] = [
    { label: "Now", timestamp: null, robMt: round1(robNow) },
    {
      label: "Arrival",
      timestamp: ctx.arrivalTimestamp,
      robMt: round1(robAtArrival),
    },
    {
      label: "Post-delivery",
      timestamp: ctx.arrivalTimestamp,
      robMt: round1(robAfterDelivery),
      note: headroomExceeded
        ? "Exceeds estimated tank headroom"
        : undefined,
    },
    {
      label: "Departure",
      timestamp: departureTimestamp,
      robMt: round1(robAtDeparture),
    },
    {
      label: "+7d (illustrative)",
      timestamp: tailTimestamp,
      robMt: round1(robAfterTail),
      note: "Illustrative continuation, not a routed voyage",
    },
  ];

  return { costBreakdown, robTimeline, headroomExceeded };
}
