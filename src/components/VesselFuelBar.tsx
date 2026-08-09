"use client";

import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { formatMt } from "@/lib/format";
import { PRICE_SERIES } from "@/lib/bunkerEvents";
import type { VesselGrade } from "@/lib/types";

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
  /** Capacity of the separate distillate tank. */
  mgoMaxMt: number | null;
  mgoMinMt: number | null;
}

/** Colour and label resolve through the price grade, as a stem's valuation does. */
const colorFor = (grade: VesselGrade) => GRADE_COLORS[PRICE_SERIES[grade]];
const labelFor = (grade: VesselGrade) => GRADE_LABELS[PRICE_SERIES[grade]];

/**
 * Fuel onboard, one bar per tank.
 *
 * Two bars, not three, because the tanks are not peers. HSFO and VLSFO share
 * Max_ROB_MT and are drawn as one stacked bar — a scrubber vessel's split
 * between them is the reading that matters, and it is what the bunker trigger
 * is measured against. MGO is a separate tank sitting outside that capacity
 * (ASTERIOS opens at 683 MT of residual — exactly its Max_ROB_MT — and carries
 * its MGO on top), so it gets its own bar on its own scale. A shared axis would
 * be a false comparison.
 *
 * The active grade is marked rather than inferred: a vessel mid-ECA is burning
 * MGO while both residual tanks stand still, and on the ten rotations that
 * touch no ECA port the MGO tank never moves at all.
 */
export default function VesselFuelBar({
  robMt,
  activeGrade,
  scrubber,
  maxRobMt,
  minRobMt,
  triggerMt,
  mgoMaxMt,
  mgoMinMt,
}: Props) {
  const residual = robMt.HSFO + robMt.VLSFO;
  const belowMin = minRobMt !== null && residual < minRobMt;
  const belowTrigger = triggerMt !== null && residual < triggerMt;

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
            className="relative mt-1.5 flex h-3 w-full overflow-hidden rounded-[2px] bg-surface-2"
            role="img"
            aria-label={
              `${formatMt(residual)} MT of residual fuel onboard, ` +
              `${Math.min(100, (residual / scale) * 100).toFixed(0)} percent of ` +
              `${formatMt(maxRobMt)} MT capacity` +
              (scrubber
                ? `: ${residualGrades
                    .map((g) => `${formatMt(robMt[g])} MT ${labelFor(g)}`)
                    .join(", ")}`
                : "")
            }
          >
            {residualGrades
              .filter((grade) => robMt[grade] > 0)
              .map((grade) => (
                <div
                  key={grade}
                  className="h-full transition-[width] duration-150"
                  style={{
                    width: `${Math.min(100, (robMt[grade] / scale) * 100)}%`,
                    // Warn amber the moment the vessel is under a threshold, so
                    // the bar carries the same signal as the box below it.
                    background:
                      belowMin || belowTrigger
                        ? "var(--color-warn)"
                        : colorFor(grade),
                  }}
                />
              ))}

            {/* Thresholds sit on the bar rather than beside it — a vessel's
                distance from its trigger is the thing being read here. */}
            {[
              { at: triggerMt, key: "trigger" },
              { at: minRobMt, key: "min" },
            ].map(({ at, key }) =>
              at === null || at > scale ? null : (
                <span
                  key={key}
                  aria-hidden
                  className="absolute inset-y-0 w-px bg-bg/70"
                  style={{ left: `${(at / scale) * 100}%` }}
                />
              ),
            )}
          </div>

          {/* The split is the point of the bar, so it is named, not just drawn. */}
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

          <div className="mt-1 flex justify-between text-[10px] text-faint">
            <span className="tnum">
              Min {formatMt(minRobMt)} · Trigger {formatMt(triggerMt)}
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

      {/* MGO: a separate tank, drawn on its own scale. */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-fg">
            {GRADE_LABELS.MGO}
            {activeGrade === "MGO" && (
              <span className="text-faint"> · burning</span>
            )}
          </span>
          <span className="tnum text-xs text-fg">
            {formatMt(robMt.MGO)} MT
            {mgoMaxMt !== null && mgoMaxMt > 0 && (
              <span className="text-faint">
                {" "}
                · {Math.min(100, (robMt.MGO / mgoMaxMt) * 100).toFixed(0)}%
              </span>
            )}
          </span>
        </div>

        {mgoMaxMt !== null && mgoMaxMt > 0 && (
          <div
            className="relative mt-1.5 h-2 w-full overflow-hidden rounded-[2px] bg-surface-2"
            role="img"
            aria-label={`${formatMt(robMt.MGO)} MT of MGO onboard, ${Math.min(100, (robMt.MGO / mgoMaxMt) * 100).toFixed(0)} percent of ${formatMt(mgoMaxMt)} MT tank`}
          >
            <div
              className="h-full transition-[width] duration-150"
              style={{
                width: `${Math.min(100, (robMt.MGO / mgoMaxMt) * 100)}%`,
                background:
                  mgoMinMt !== null && robMt.MGO < mgoMinMt
                    ? "var(--color-warn)"
                    : GRADE_COLORS.MGO,
                opacity: 0.85,
              }}
            />
            {mgoMinMt !== null && mgoMinMt <= mgoMaxMt && (
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-bg/70"
                style={{ left: `${(mgoMinMt / mgoMaxMt) * 100}%` }}
              />
            )}
          </div>
        )}

        <p className="mt-1 text-[10px] leading-relaxed text-faint">
          A separate tank, outside the {formatMt(maxRobMt)} MT residual capacity
          above. Burned in place of the main fuel through China and Korea ECA
          calls, which cap sulphur at 0.10% — below what VLSFO clears. It stays
          flat all window on the rotations that call at no ECA port.
        </p>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        {scrubber
          ? "Scrubber-fitted, so this vessel may burn high-sulphur fuel and " +
            "carries VLSFO as its compliant reserve — lifted wherever a port " +
            "cannot supply HSFO, which is twelve of the twenty-six it calls."
          : "No scrubber, so HSFO would not be MARPOL Annex VI compliant on " +
            "this hull. Its HSFO figure is a true zero, not a missing value — " +
            "the source lists all three grades for every vessel as engine " +
            "capability, not as lawful use."}
      </p>
    </div>
  );
}
