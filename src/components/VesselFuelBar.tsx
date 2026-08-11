"use client";

import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { formatMt } from "@/lib/format";
import { TANK_SERIES } from "@/lib/bunkerEvents";
import { robState, type RobState } from "@/lib/vesselPosition";
import type { VesselGrade } from "@/lib/types";

/** Where to point a CE desk at each compliance grade's market, in prose. */
const COMPLIANCE_MARKET_NOTE: Record<VesselGrade, string> = {
  MGO: "Burned through ECA calls, wherever this hull's charted position sits inside a shaded zone.",
  MEOH:
    "Burned through ECA calls in place of MGO — stemmed at Ningbo, the only priced methanol market in this dataset.",
  LNG: "Burned through ECA calls in place of MGO — stemmed at Ningbo, Shanghai, Singapore or Port Klang, the priced LNG markets in this dataset.",
  B40: "Burned through ECA calls in place of MGO — stemmed at Jakarta or Surabaya, the priced B40 biofuel markets in this dataset.",
  VLSFO: "",
  HSFO: "",
};

interface Props {
  /** ROB of each grade at the scrubbed step. Zero is a real zero. */
  robMt: Record<VesselGrade, number>;
  /** The grade the main engine is on right now — MGO through an ECA call. */
  activeGrade: VesselGrade;
  /** Whether the hull may hold HSFO at all. Unfitted hulls hide the row. */
  scrubber: boolean;
  /** Capacity shared by the two residual grades. MGO sits outside it. */
  maxRobMt: number | null;
  minRobMt: number | null;
  triggerMt: number | null;
  /**
   * Where the residual pair sits against those two. Computed by the parent so
   * the bar and the note beneath it cannot disagree about one reading.
   */
  state: RobState;
  /** Which grade this hull's ECA-compliance tank actually is. */
  complianceGrade: VesselGrade;
  /** Capacity of the separate compliance tank. */
  complianceMaxMt: number | null;
  complianceMinMt: number | null;
}

/** Plain-language state for the bar's accessible name. */
const STATE_LABEL: Record<RobState, string> = {
  ok: "above the bunkering trigger",
  due: "below the bunkering trigger, due to stem",
  breach: "below the safety minimum",
};

/** Colour and label resolve through the price grade, as a stem's valuation does. */
const colorFor = (grade: VesselGrade) => GRADE_COLORS[TANK_SERIES[grade]];
const labelFor = (grade: VesselGrade) => GRADE_LABELS[TANK_SERIES[grade]];

/**
 * Fuel onboard, one bar per fuel type.
 *
 * Three bars, one per tank the fleet actually carries: HSFO, VLSFO and MGO
 * each get their own row. HSFO and VLSFO still *share* Max_ROB_MT and one
 * bunkering trigger — that constraint is real and hasn't gone away, a
 * scrubber vessel's two residual bars are not independent capacities — but it
 * is no longer read off one stacked bar. Both residual bars are drawn to the
 * same shared scale (maxRobMt) so their fills stay comparable, and the
 * trigger/min ticks are repeated on both for the same reason. A ring around
 * the pair (not around each bar individually) carries the combined
 * "breach"/"due" state, since that state is a property of their sum, not of
 * either grade alone. MGO sits outside that capacity entirely (ASTERIOS opens
 * at 683 MT of residual — exactly its Max_ROB_MT — and carries its MGO on
 * top), so it keeps its own bar on its own scale below.
 *
 * The active grade is marked rather than inferred: a vessel mid-ECA is burning
 * its compliance grade (MGO, or MEOH/LNG/B40 on the small subsets that carry
 * one of those instead) while both residual tanks stand still, and on
 * rotations that touch no ECA port that tank never moves at all.
 *
 * The fills are always the grade colours — recolouring them to signal a
 * threshold would erase which grade is which, which is the one thing three
 * separate bars exist to keep legible. State is carried by the ticks and by
 * the ring around the residual pair instead.
 */
export default function VesselFuelBar({
  robMt,
  activeGrade,
  scrubber,
  maxRobMt,
  minRobMt,
  triggerMt,
  state,
  complianceGrade,
  complianceMaxMt,
  complianceMinMt,
}: Props) {
  const residual = robMt.HSFO + robMt.VLSFO;
  const complianceRob = robMt[complianceGrade];

  // The compliance tank has a floor but no trigger surfaced anywhere in the
  // app, so this is only ever "breach" or "ok".
  const complianceState = robState(complianceRob, complianceMinMt, null);

  // Capacity is 3% of deadweight for every vessel in the specs sheet and is
  // non-zero throughout, but the type admits null — without a scale there is no
  // proportion to draw, so the figures stand alone rather than dividing by it.
  const scale = maxRobMt !== null && maxRobMt > 0 ? maxRobMt : null;

  // Residual grades in burn order: HSFO is drawn on first where a scrubber
  // makes it lawful, and VLSFO is the compliant reserve behind it.
  const residualGrades = scrubber
    ? (["HSFO", "VLSFO"] as const)
    : (["VLSFO"] as const);

  return (
    <div className="px-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-fg">Residual</span>
        <span className="tnum text-xs text-fg">
          {formatMt(residual)} MT
          {scale !== null && (
            <span className="text-faint">
              {" "}
              · {Math.min(100, (residual / scale) * 100).toFixed(0)}%
            </span>
          )}
        </span>
      </div>

      {scale !== null ? (
        <>
          <div
            className={
              "mt-1.5 space-y-1 rounded-[2px]" +
              // A ring around the pair, not a repaint of either bar: the
              // breach/due state belongs to their sum, not to one grade.
              (state === "breach" ? " p-0.5 ring-1 ring-inset ring-warn" : "")
            }
          >
            {residualGrades.map((grade) => (
              <div
                key={grade}
                className="relative flex h-3 w-full overflow-hidden rounded-[2px] bg-surface-2"
                role="img"
                aria-label={
                  `${formatMt(robMt[grade])} MT of ${labelFor(grade)} onboard, ` +
                  `${Math.min(100, (robMt[grade] / scale) * 100).toFixed(0)} percent of ` +
                  `${formatMt(maxRobMt)} MT shared residual capacity. ${STATE_LABEL[state]}.`
                }
              >
                <div
                  className="h-full transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, (robMt[grade] / scale) * 100)}%`,
                    background: colorFor(grade),
                  }}
                />

                {/* Thresholds sit on the bar rather than beside it — a
                    vessel's distance from its trigger is the thing being
                    read here. Repeated on both residual bars (same shared
                    scale) since the threshold is a property of their sum. */}
                {[
                  { at: triggerMt, key: "trigger", lit: state === "due" },
                  { at: minRobMt, key: "min", lit: state === "breach" },
                ].map(({ at, key, lit }) =>
                  at === null || at > scale ? null : (
                    <span
                      key={key}
                      aria-hidden
                      className={
                        "absolute inset-y-0 " +
                        (lit ? "w-0.5 -translate-x-px" : "w-px bg-bg/70")
                      }
                      style={{
                        left: `${(at / scale) * 100}%`,
                        ...(lit
                          ? {
                              background:
                                key === "min"
                                  ? "var(--color-warn)"
                                  : "var(--color-accent)",
                            }
                          : null),
                      }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>

          {/* The split is the point of the bars, so it is named, not just drawn. */}
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {residualGrades.map((grade) => (
              <span
                key={grade}
                className="flex items-center gap-1 text-[10px] text-faint"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: colorFor(grade) }}
                />
                <span className={activeGrade === grade ? "text-fg" : undefined}>
                  {labelFor(grade)}
                </span>
                <span className="tnum">{formatMt(robMt[grade])} MT</span>
                {activeGrade === grade && (
                  <span className="text-fg">· burning</span>
                )}
              </span>
            ))}
          </div>

          {/* The crossed figure is brought up out of `faint`, so the reading
              survives without relying on the tick's colour alone. */}
          <div className="mt-1 flex justify-between text-[10px] text-faint">
            <span className="tnum">
              <span className={state === "breach" ? "text-warn" : undefined}>
                Min {formatMt(minRobMt)}
              </span>{" "}
              ·{" "}
              <span className={state === "due" ? "text-fg" : undefined}>
                Trigger {formatMt(triggerMt)}
              </span>
            </span>
            <span className="tnum">Capacity {formatMt(maxRobMt)} MT</span>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[11px] text-faint">
          No capacity figure in the specifications, so there is nothing to draw
          a proportion against.
        </p>
      )}

      {/* Compliance tank: a separate tank, drawn on its own scale. MGO for
          the fleet at large; a small subset of vessels draw this same
          section as MEOH, LNG or B40 instead — the tank the hull actually
          carries, never more than one. */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-fg">
            {GRADE_LABELS[complianceGrade]}
            {activeGrade === complianceGrade && (
              <span className="text-faint"> · burning</span>
            )}
          </span>
          <span className="tnum text-xs text-fg">
            {formatMt(complianceRob)} MT
            {complianceMaxMt !== null && complianceMaxMt > 0 && (
              <span className="text-faint">
                {" "}
                · {Math.min(100, (complianceRob / complianceMaxMt) * 100).toFixed(0)}%
              </span>
            )}
          </span>
        </div>

        {complianceMaxMt !== null && complianceMaxMt > 0 && (
          <div
            className={
              "relative mt-1.5 h-2 w-full overflow-hidden rounded-[2px] bg-surface-2" +
              // Same vocabulary as the residual bar: amber ring means breach.
              // The generator's compliance-tank trigger has no counterpart
              // here, so this tank has only the one threshold to be under.
              (complianceState === "breach" ? " ring-1 ring-inset ring-warn" : "")
            }
            role="img"
            aria-label={
              `${formatMt(complianceRob)} MT of ${labelFor(complianceGrade)} onboard, ` +
              `${Math.min(100, (complianceRob / complianceMaxMt) * 100).toFixed(0)} percent of ` +
              `${formatMt(complianceMaxMt)} MT tank` +
              (complianceState === "breach" ? ". Below the tank minimum." : "")
            }
          >
            <div
              className="h-full transition-[width] duration-150"
              style={{
                width: `${Math.min(100, (complianceRob / complianceMaxMt) * 100)}%`,
                background: colorFor(complianceGrade),
                opacity: 0.85,
              }}
            />
            {complianceMinMt !== null && complianceMinMt <= complianceMaxMt && (
              <span
                aria-hidden
                className={
                  "absolute inset-y-0 " +
                  (complianceState === "breach"
                    ? "w-0.5 -translate-x-px bg-warn"
                    : "w-px bg-bg/70")
                }
                style={{ left: `${(complianceMinMt / complianceMaxMt) * 100}%` }}
              />
            )}
          </div>
        )}

        {/* The one thing the bars cannot show: why this tank moves at all. The
            separate scale, heading and capacity already say it is its own tank,
            and an unfitted hull never renders an HSFO row to explain away. */}
        <p className="mt-1 text-[10px] leading-relaxed text-faint">
          {COMPLIANCE_MARKET_NOTE[complianceGrade]}
        </p>
      </div>
    </div>
  );
}
