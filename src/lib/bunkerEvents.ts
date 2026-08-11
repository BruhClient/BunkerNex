import { portMeta } from "./ports";
import { stepTimestamp } from "./vesselPosition";
import type { Grade, VesselGrade, VesselTrack } from "./types";

/**
 * Bunker stems, derived from the movement tracks for the bunker log.
 *
 * Client-safe on purpose: the price figures arrive pre-resolved in a snapshot
 * built server-side, so nothing here reaches for node:fs and the module can be
 * pulled into the client bundle. Keep it that way — importing lib/prices.ts
 * would drag the CSV reader in with it.
 */

/**
 * The price column a stem is valued against.
 *
 * `VesselGrade` and the pricing `Grade` both spell every grade the same way
 * now, so this is an identity mapping — kept as a function anyway, since
 * `stemDisplayGrade` and every caller already go through it, and the Chief
 * Engineer's sheet's LSMGO/MGO split (reconciled into one "MGO" grade — see
 * data/README.md) is exactly the kind of per-port distinction this function
 * used to carry. If a future grade needs port-specific resolution again, this
 * is where it goes.
 */
export function priceSeriesFor(grade: VesselGrade, _portCode: string): Grade {
  return grade;
}

/**
 * The grade a *tank* is drawn and labelled as, for colour lookups.
 *
 * Deliberately port-independent, unlike priceSeriesFor: a tank's colour on the
 * ROB chart must not change as the vessel moves between a Chinese berth and an
 * Indian one. The distillate tank stays "MGO" here because that is what
 * `VesselGrade` calls it — the 0.10%/0.50% distinction is a property of a
 * particular lift, and it belongs on the priced stem, not on the tank.
 */
export const TANK_SERIES: Record<VesselGrade, Grade> = {
  VLSFO: "VLSFO",
  HSFO: "HSFO",
  MGO: "MGO",
  MEOH: "MEOH",
  LNG: "LNG",
  B40: "B40",
};

/** The latest real assessment for a port and grade, with its own date. */
export interface AssessedPrice {
  value: number;
  /**
   * The assessment's date, not the stem's. The movement window now ends on the
   * last assessed date, so every stem falls inside the priced period — but this
   * is still the *latest* assessment rather than the one quoted on the stem's
   * own day, so a stem early in the window is priced weeks after it happened.
   * The UI must show this date rather than implying a same-day quote.
   */
  date: string;
  /** The column the figure came from, e.g. "HSFO" for an HSFO stem. */
  series: Grade;
}

/**
 * Latest assessment per port and vessel grade. Small enough (~25 ports × 2)
 * to ship as props, which is why the log needs no fetch of its own.
 */
export type BunkerPriceSnapshot = Record<
  string,
  Partial<Record<VesselGrade, AssessedPrice>>
>;

export interface BunkerEvent {
  /**
   * Stable across re-renders: a vessel never stems twice on one step, so the
   * pair is unique.
   */
  id: string;
  /**
   * The step the stem lands on. Kept alongside the formatted timestamp so a
   * log row can seek the scrubber back to the moment, and so rows can be split
   * into what has and has not happened yet at the scrubbed step.
   */
  step: number;
  vesselName: string;
  serviceCode: string;
  portCode: string;
  /** Falls back to the code for a port with no PORT_COORDS entry. */
  portName: string;
  grade: VesselGrade;
  quantityMt: number;
  /** Remaining-on-board at this step, i.e. after the lift. */
  robMt: number;
  /** Source wall-clock string, no timezone. Shown verbatim. */
  timestamp: string;
  /** Null where the port, or that grade at that port, is not assessed. */
  price: AssessedPrice | null;
  /**
   * Quantity at the assessed price. Null wherever `price` is, so an unpriced
   * stem never contributes 0 to a total — it is excluded and counted instead.
   *
   * Derived, not sourced: the assessment is weeks older than most stems, so
   * anything showing this must carry the assessment date with it.
   */
  valueUsd: number | null;
}

/**
 * The grade a stem should be *displayed* as. `event.grade` is the tank
 * (`VesselGrade`, port-independent — see TANK_SERIES); this prefers the
 * resolved price series via priceSeriesFor instead, so a stem's display name
 * never silently drifts from what it was actually priced against.
 */
export function stemDisplayGrade(event: BunkerEvent): Grade {
  return event.price?.series ?? event.grade;
}

/**
 * Every stem in the movement window, chronological.
 *
 * `bunkered` is sparse — a handful of steps per vessel out of 744 — so this
 * walks the recorded stems rather than scanning the grid. 250 rows fleet-wide,
 * cheap enough to build once and hold.
 *
 * The grade comes from which per-grade map the stem sits in, never from the
 * vessel's primary grade: a scrubber vessel lifts VLSFO at the twelve ports
 * with no high-sulphur market, and MGO wherever its ECA legs demand it.
 */
export function allBunkerEvents(
  tracks: VesselTrack[],
  snapshot: BunkerPriceSnapshot,
): BunkerEvent[] {
  const events: BunkerEvent[] = [];

  for (const track of tracks) {
    for (const [grade, byStep] of Object.entries(track.bunkered) as Array<
      [VesselGrade, Record<number, number>]
    >) {
      for (const [key, quantityMt] of Object.entries(byStep)) {
        const step = Number(key);

        const portCode = track.portCodes[step];
        if (portCode === undefined) continue;

        const price = snapshot[portCode]?.[grade] ?? null;

        events.push({
          // A vessel can lift two grades on one step — a residual top-up
          // alongside an MGO one — so the grade is part of the key.
          id: `${track.name}@${step}@${grade}`,
          step,
          vesselName: track.name,
          serviceCode: track.serviceCode,
          portCode,
          portName: portMeta(portCode)?.name ?? portCode,
          grade,
          quantityMt,
          robMt: track.robMt[grade][step] ?? 0,
          timestamp: stepTimestamp(track, step),
          price,
          valueUsd: price ? quantityMt * price.value : null,
        });
      }
    }
  }

  // Every track shares one time grid, so comparing steps across vessels is
  // comparing the same instant. Vessel name then grade breaks ties for a
  // stable order.
  return events.sort(
    (a, b) =>
      a.step - b.step ||
      a.vesselName.localeCompare(b.vesselName) ||
      a.grade.localeCompare(b.grade),
  );
}

/** One vessel's bunkering activity at one port, summed across the window. */
export interface PortVesselBunkerSummary {
  vesselName: string;
  serviceCode: string;
  totalMt: number;
  /** Distinct calls the vessel bunkered on — not grade-events, so a call
   *  that lifts both VLSFO and MGO still counts once. */
  visitCount: number;
  grades: VesselGrade[];
}

/**
 * Every vessel that has bunkered at a port, with its total lift.
 *
 * A vessel can call at the same port more than once in the window and can
 * lift more than one grade per call, so this is a group-by-vessel sum over
 * `allBunkerEvents`'s output, not a 1:1 mapping. Sorted by total MT
 * descending — the busiest bunkering customers first.
 *
 * Callers wanting the history as of a scrubbed moment rather than the whole
 * window should pre-filter `events` to `step <= stepIndex` before calling
 * this — it has no notion of "now" itself, matching how BunkerLog/VesselStems
 * do their own step filtering over the same shared event list.
 */
export function summarizePortBunkering(
  events: BunkerEvent[],
  portCode: string,
): PortVesselBunkerSummary[] {
  const byVessel = new Map<string, PortVesselBunkerSummary>();
  const stepsByVessel = new Map<string, Set<number>>();

  for (const event of events) {
    if (event.portCode !== portCode) continue;

    let summary = byVessel.get(event.vesselName);
    if (!summary) {
      summary = {
        vesselName: event.vesselName,
        serviceCode: event.serviceCode,
        totalMt: 0,
        visitCount: 0,
        grades: [],
      };
      byVessel.set(event.vesselName, summary);
      stepsByVessel.set(event.vesselName, new Set());
    }

    summary.totalMt += event.quantityMt;
    stepsByVessel.get(event.vesselName)!.add(event.step);
    if (!summary.grades.includes(event.grade)) summary.grades.push(event.grade);
  }

  for (const summary of byVessel.values()) {
    summary.visitCount = stepsByVessel.get(summary.vesselName)!.size;
  }

  return [...byVessel.values()].sort((a, b) => b.totalMt - a.totalMt);
}
