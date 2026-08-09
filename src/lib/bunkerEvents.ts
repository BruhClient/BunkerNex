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
 * The assessments quote high-sulphur fuel as IFO380; no column anywhere is
 * headed "HSFO". Mapping the two is the only way a scrubber-fitted vessel's
 * stem can be priced at all.
 *
 * MGO maps to the plain `MGO` column rather than `LSMGO`. Both exist in
 * "LSMGO_MGO Prices.csv", but the split is regional: every one of this fleet's
 * twenty-six ports carries `<PORT> MGO`, while `LSMGO` appears mostly at
 * Japan/Europe/Americas ports it never calls. See data/README.md.
 */
export const PRICE_SERIES: Record<VesselGrade, Grade> = {
  VLSFO: "VLSFO",
  HSFO: "IFO380",
  MGO: "MGO",
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
  /** The column the figure came from, e.g. "IFO380" for an HSFO stem. */
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
