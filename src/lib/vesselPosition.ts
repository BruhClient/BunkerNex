import { greatCircleArc, multiPointArc, pointAlong, type LonLat } from "./geo";
import { seaRoute } from "./searoutes";
import type { VesselTrack } from "./types";

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
  robMt: number;
  /** MT lifted at this exact step, if any. */
  bunkeredMt: number | null;
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
 * Reusing the last leg's port instead would invent a leg the vessel never
 * sails (ASTERIOS would appear to run IDSUB->CNTAO, skipping CNTSN).
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

    const base = {
      berthed,
      portCode: leg.toKey,
      fromPortCode: leg.fromKey,
      robMt: track.robMt[step],
      bunkeredMt: track.bunkered[step] ?? null,
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
