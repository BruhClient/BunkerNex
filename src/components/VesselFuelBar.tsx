"use client";

import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { formatMt } from "@/lib/format";
import { PRICE_SERIES } from "@/lib/bunkerEvents";
import type { VesselGrade } from "@/lib/types";

interface Props {
  /** The grade this vessel actually burns, from its scrubber fitting. */
  grade: VesselGrade;
  /** ROB of that grade at the scrubbed step. */
  robMt: number;
  /** Constant across the window, and null for most of the fleet. */
  mgoRobMt: number | null;
  maxRobMt: number | null;
  minRobMt: number | null;
  triggerMt: number | null;
}

/**
 * Fuel onboard as a proportion of tank capacity.
 *
 * The source lists VLSFO, HSFO and MGO as engine capability for every vessel,
 * but each one burns exactly one of VLSFO/HSFO following its scrubber, and
 * loadVesselTracks only ever reads that grade's column. The other is a flat 0
 * for the whole window — so a bar of fuel *mix* alone would be a single 100%
 * block for the 30 vessels carrying no MGO, static even across a stem.
 *
 * Scaling against Max_ROB_MT instead gives the bar something to say: it draws
 * down as the vessel burns and jumps back at a lift, and the two thresholds the
 * panel already names become positions rather than numbers.
 */
export default function VesselFuelBar({
  grade,
  robMt,
  mgoRobMt,
  maxRobMt,
  minRobMt,
  triggerMt,
}: Props) {
  // GRADE_COLORS is keyed by *price* grade and has no HSFO entry, so the hue
  // resolves the same way a stem's valuation does. It also lands the vessel's
  // fuel on the colour its series carries in the port price chart.
  const color = GRADE_COLORS[PRICE_SERIES[grade]];
  const label = GRADE_LABELS[PRICE_SERIES[grade]];

  const belowMin = minRobMt !== null && robMt < minRobMt;
  const belowTrigger = triggerMt !== null && robMt < triggerMt;

  // Capacity is 3% of deadweight for every vessel in the specs sheet and is
  // non-zero throughout, but the type admits null — without a scale there is no
  // proportion to draw, so the figures stand alone rather than dividing by it.
  const scale = maxRobMt !== null && maxRobMt > 0 ? maxRobMt : null;
  const pct = scale === null ? null : Math.min(100, (robMt / scale) * 100);

  return (
    <div className="px-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-fg">{label}</span>
        <span className="tnum text-xs text-fg">
          {formatMt(robMt)} MT
          {pct !== null && (
            <span className="text-faint"> · {pct.toFixed(0)}%</span>
          )}
        </span>
      </div>

      {scale !== null && pct !== null ? (
        <>
          <div
            className="relative mt-1.5 h-3 w-full overflow-hidden rounded-[2px] bg-surface-2"
            role="img"
            aria-label={`${formatMt(robMt)} MT of ${label} onboard, ${pct.toFixed(0)} percent of ${formatMt(maxRobMt)} MT capacity`}
          >
            <div
              className="h-full transition-[width] duration-150"
              style={{
                width: `${pct}%`,
                // Warn amber the moment the vessel is under a threshold, so the
                // bar carries the same signal as the box below it.
                background:
                  belowMin || belowTrigger ? "var(--color-warn)" : color,
              }}
            />

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

      {/* MGO is a separate tank: ASTERIOS opens at 683 MT of HSFO — exactly its
          Max_ROB_MT — and carries 119.9 MT of MGO on top. Folding it into the
          bar above would overstate the vessel against its own capacity. */}
      {mgoRobMt !== null && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] text-fg">MGO</span>
            <span className="tnum text-xs text-fg">
              {formatMt(mgoRobMt)} MT
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
            <div
              className="h-full"
              style={{
                // Deliberately not on the bar's scale — MGO sits outside
                // Max_ROB_MT, so a shared axis would be a false comparison.
                // Full width states presence; the figure carries the value.
                width: "100%",
                background: GRADE_COLORS.MGO,
                opacity: 0.55,
              }}
            />
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-faint">
            A separate tank, outside the {formatMt(maxRobMt)} MT capacity above
            and drawn on its own scale. Constant across the window and never
            bunkered in this data, so it does not move as you scrub.
          </p>
        </div>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-faint">
        The source lists VLSFO, HSFO and MGO as engine capability for every
        vessel. This one burns {label} only — the other residual grade is
        genuinely zero onboard, not missing.
      </p>
    </div>
  );
}
