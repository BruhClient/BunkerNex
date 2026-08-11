import type { Co2eCostPoint, Co2eFactors } from "./emissions";
import { greatCircleArc, multiPointArc, pointAlong, type LonLat } from "./geo";
import { seaRoute } from "./searoutes";
import { VESSEL_GRADES, type VesselGrade, type VesselTrack } from "./types";

/**
 * A block of consecutive steps sharing one destination port: the transit
 * towards it, then the berth alongside it. `fromKey` is the port the vessel
 * departed, which the source never states — see originFor below.
 */
export interface VesselLeg {
  fromKey: string;
  toKey: string;
  /** First step index of the block. */
  start: number;
  /** Steps in the block, transit and berth together. */
  length: number;
  /** Leading steps spent in transit; the remainder are berthed. */
  transitSteps: number;
}

export interface VesselFix {
  position: LonLat;
  bearing: number;
  berthed: boolean;
  /** Port sailed towards, or berthed at. */
  portCode: string;
  /** Port departed on this leg. Equals portCode when no origin is knowable. */
  fromPortCode: string;
  /** The grade the main engine is on at this step, MGO through an ECA call. */
  grade: VesselGrade;
  /** ROB of `grade` — the fuel actually being burned, not the vessel total. */
  robMt: number;
  /** MT of `grade` lifted at this exact step, if any. */
  bunkeredMt: number | null;
}

/**
 * Where a tank sits against its two thresholds.
 *
 * The distinction the panel kept collapsing: the bunkering trigger and the
 * safety floor are not two severities of one alarm.
 *
 * - `due` — at or below `Bunkering_Trigger_MT` (1.5% DWT). The state the
 *   generator is *built* to produce: it lifts a stem once ROB has fallen to
 *   the trigger, so every vessel spends part of its loop here by design —
 *   8.0% of all 26,040 rows, across all 35 vessels. Never a fault.
 * - `breach` — below `Min_ROB_MT` (1.0% DWT). A genuine violation, and one
 *   `scripts/gen-vessel-movement.mjs` asserts against every row before
 *   writing, so it cannot occur in a file that script produced. Kept live
 *   anyway: the CSV is regenerable and hand-editable, and a threshold nothing
 *   checks is how this panel came to carry copy that outlived its own data.
 */
export type RobState = "ok" | "due" | "breach";

/**
 * `RobState` for one tank. A null threshold falls through to the looser
 * reading — with no figure there is nothing to have crossed.
 */
export function robState(
  robMt: number,
  minMt: number | null,
  triggerMt: number | null,
): RobState {
  if (minMt !== null && robMt < minMt) return "breach";
  if (triggerMt !== null && robMt <= triggerMt) return "due";
  return "ok";
}

/**
 * The grade being burned at a step, unpacked from the track's `activeGrades`.
 *
 * The char is written by the generator rather than inferred from which tank is
 * falling: on the ten rotations that touch no ECA port the MGO tank never
 * moves, which is indistinguishable from an MGO tank that is simply full.
 */
export function activeGradeAt(track: VesselTrack, step: number): VesselGrade {
  switch (track.activeGrades[step]) {
    case "H":
      return "HSFO";
    case "M":
      return "MGO";
    case "E":
      return "MEOH";
    case "N":
      return "LNG";
    case "B":
      return "B40";
    default:
      return "VLSFO";
  }
}

/**
 * Split a track into legs at each change of destination port.
 *
 * The source labels a transit row with the port being sailed *to*, and only
 * means "where the vessel is" once berthed — so a change of Port_Code marks a
 * departure, not an arrival.
 */
export function buildLegs(track: VesselTrack): VesselLeg[] {
  const legs: VesselLeg[] = [];

  for (let i = 0; i < track.portCodes.length; i++) {
    const code = track.portCodes[i];
    const current = legs[legs.length - 1];
    if (!current || current.toKey !== code) {
      legs.push({
        fromKey: code,
        toKey: code,
        start: i,
        length: 1,
        transitSteps: track.phases[i] === "T" ? 1 : 0,
      });
    } else {
      current.length++;
      if (track.phases[i] === "T") current.transitSteps++;
    }
  }

  for (let i = 0; i < legs.length; i++) {
    legs[i].fromKey = originFor(legs, i);
  }
  return legs;
}

/**
 * Which port a leg departed from.
 *
 * For every leg but the first that is the previous leg's destination. The
 * first leg has no predecessor in the file — the window opens mid-voyage — so
 * we look forward to the next call at the same port and take whatever preceded
 * *that*. These tracks are cyclic rotations, so it recovers the true origin.
 * Reusing the *last* leg's port instead would invent a leg the vessel never
 * sails: a track opening mid-rotation would appear to sail from wherever the
 * 93-day window happened to stop, cutting across the whole loop.
 */
function originFor(legs: VesselLeg[], index: number): string {
  if (index > 0) return legs[index - 1].toKey;

  const first = legs[0].toKey;
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].toKey === first) return legs[i - 1].toKey;
  }
  // Never returns to this port, so no origin is knowable: the vessel sits at
  // its destination for the opening transit rather than sailing from a
  // fabricated one.
  return first;
}

/**
 * Resolve any step to a position, reusing the same sea-lane geometry the route
 * arcs are drawn from so vessels sit on the lines the map already shows.
 *
 * Leg paths are cached: scrubbing re-resolves every vessel per frame, and
 * rebuilding an arc each time would be wasteful.
 */
export function createTrackResolver(
  track: VesselTrack,
  portLonLat: (key: string) => LonLat | null,
): (step: number) => VesselFix | null {
  const legs = buildLegs(track);
  const paths = new Map<string, LonLat[]>();

  const pathFor = (fromKey: string, toKey: string): LonLat[] | null => {
    const cacheKey = `${fromKey}>${toKey}`;
    const cached = paths.get(cacheKey);
    if (cached) return cached;

    const from = portLonLat(fromKey);
    const to = portLonLat(toKey);
    if (!from || !to) return null;

    // Same pairing RouteMap uses for service arcs: routed through open water
    // where the sea-lane graph covers the pair, a direct arc otherwise.
    const via = seaRoute(fromKey, toKey);
    const path = via
      ? multiPointArc([from, ...via, to], 24)
      : greatCircleArc(from, to);

    paths.set(cacheKey, path);
    return path;
  };

  return (step: number): VesselFix | null => {
    if (step < 0 || step >= track.portCodes.length) return null;

    const leg = legs.find((l) => step >= l.start && step < l.start + l.length);
    if (!leg) return null;

    const berthed = track.phases[step] === "B";
    const destination = portLonLat(leg.toKey);
    if (!destination) return null;

    // The fix reports the tank in use, so a vessel mid-ECA reads as MGO rather
    // than as a residual figure that is not moving.
    const grade = activeGradeAt(track, step);
    const base = {
      berthed,
      portCode: leg.toKey,
      fromPortCode: leg.fromKey,
      grade,
      robMt: track.robMt[grade][step],
      bunkeredMt: track.bunkered[grade][step] ?? null,
    };

    // Berthed vessels sit exactly on the port, never an interpolated point
    // near it — the marker must agree with the port marker underneath.
    if (berthed || leg.transitSteps === 0 || leg.fromKey === leg.toKey) {
      return { ...base, position: destination, bearing: 0 };
    }

    const path = pathFor(leg.fromKey, leg.toKey);
    if (!path) return { ...base, position: destination, bearing: 0 };

    // The source puts the first transit step at the origin berth, and arrival
    // is the first berthed step — so the fraction runs [0, 1) across transit.
    const fraction = (step - leg.start) / leg.transitSteps;
    const { position, bearing } = pointAlong(path, fraction);
    return { ...base, position, bearing };
  };
}

/**
 * Timestamp for a step, formatted like the source's own strings.
 *
 * The source carries no timezone, so the string is not a UTC instant. The UTC
 * epoch here is only a calendar calculator for adding whole hours, and the
 * result is re-formatted by hand rather than through toISOString — so nothing
 * shifts the wall-clock value or appends a "Z" the source does not support.
 */
export function stepTimestamp(track: VesselTrack, step: number): string {
  const [date, time = "00:00:00"] = track.startTimestamp.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);

  const at = new Date(
    Date.UTC(y, m - 1, d, hh, mm, ss) + step * track.stepHours * 3600_000,
  );

  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getUTCFullYear()}-${p2(at.getUTCMonth() + 1)}-${p2(at.getUTCDate())}` +
    ` ${p2(at.getUTCHours())}:${p2(at.getUTCMinutes())}`
  );
}

/**
 * "2026-05-05 00:00" -> "05 May". A 93-day window needs the day, not the
 * year. Shared by every chart in the vessel panel that plots against a
 * numeric step axis.
 */
export function stepAxisLabel(track: VesselTrack, step: number): string {
  const [date] = stepTimestamp(track, step).split(" ");
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Mass of `grade` actually consumed at `step`, derived from the ROB delta —
 * nothing in VesselTrack stores burned mass directly, only ROB and sparse
 * lifted amounts. A lift is added back into opening stock before diffing, so
 * a step that both bunkers and burns the same grade doesn't read as negative
 * consumption. Works uniformly across all six tanks: only the grade actually
 * being burned that step (activeGradeAt) will ever show a positive result.
 */
export function burnedMtAt(
  track: VesselTrack,
  grade: VesselGrade,
  step: number,
): number {
  if (step === 0) return 0;
  const opening = track.robMt[grade][step - 1];
  const lifted = track.bunkered[grade][step] ?? 0;
  const closing = track.robMt[grade][step];
  return Math.max(0, opening + lifted - closing);
}

export interface Co2eSeriesPoint {
  step: number;
  cumulativeT: number;
}

/**
 * Running total of CO2e emitted, in tonnes, across the whole window. Sums
 * every tank's burn at each step against that grade's own factor, so a
 * scrubber vessel's HSFO and VLSFO both count, not just its active grade.
 */
export function vesselCo2eSeries(
  track: VesselTrack,
  factors: Co2eFactors,
): Co2eSeriesPoint[] {
  const stepCount = track.robMt.VLSFO.length;
  let cumulativeT = 0;
  const rows: Co2eSeriesPoint[] = new Array(stepCount);
  for (let step = 0; step < stepCount; step++) {
    for (const grade of VESSEL_GRADES) {
      cumulativeT += burnedMtAt(track, grade, step) * factors[grade];
    }
    rows[step] = { step, cumulativeT };
  }
  return rows;
}

export interface Co2eCostSeriesPoint {
  step: number;
  cumulativeUsd: number;
}

/**
 * Running total of estimated CO2e cost, in USD, across the whole window.
 * `costSeries` (data/emissions/co2e_cost_per_mt.csv) has an irregular,
 * business-day-like cadence rather than one row per step, so this walks a
 * pointer forward and holds the latest known row across any gap — the same
 * "latest known point" rule bunkerPriceSnapshot() already applies to prices.
 * Valid because the cost series' window (2026-05-05 to 2026-08-05) exactly
 * brackets every track's window, so the pointer always starts in range.
 */
export function vesselCo2eCostSeries(
  track: VesselTrack,
  costSeries: Co2eCostPoint[],
): Co2eCostSeriesPoint[] {
  const stepCount = track.robMt.VLSFO.length;
  let cumulativeUsd = 0;
  let pointer = 0;
  const rows: Co2eCostSeriesPoint[] = new Array(stepCount);
  for (let step = 0; step < stepCount; step++) {
    const date = stepTimestamp(track, step).slice(0, 10);
    while (
      pointer + 1 < costSeries.length &&
      costSeries[pointer + 1].date <= date
    ) {
      pointer++;
    }
    const cost = costSeries[pointer]?.costUsdPerMt;
    if (cost) {
      for (const grade of VESSEL_GRADES) {
        cumulativeUsd += burnedMtAt(track, grade, step) * cost[grade];
      }
    }
    rows[step] = { step, cumulativeUsd };
  }
  return rows;
}

/**
 * Step number nearest a YYYY-MM-DD date, against a track's own timeline.
 * Inverse of stepTimestamp — used to place the fleet-wide EUA price series
 * (dated, not step-indexed) onto the same numeric step axis every other
 * chart in the panel uses, so a single ReferenceLine convention works
 * everywhere.
 */
export function dateToStep(track: VesselTrack, date: string): number {
  const start = new Date(`${track.startTimestamp.replace(" ", "T")}Z`);
  const at = new Date(`${date}T00:00:00Z`);
  const hours = (at.getTime() - start.getTime()) / 3600_000;
  return Math.round(hours / track.stepHours);
}
