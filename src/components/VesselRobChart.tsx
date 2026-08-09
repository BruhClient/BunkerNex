"use client";

import { memo, useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GRADE_COLORS, THEME } from "@/lib/colors";
import { formatMt } from "@/lib/format";
import { PRICE_SERIES } from "@/lib/bunkerEvents";
import { stepTimestamp } from "@/lib/vesselPosition";
import type { VesselSpec, VesselTrack } from "@/lib/types";

interface Props {
  track: VesselTrack;
  spec: VesselSpec;
  stepIndex: number;
  onSeek: (step: number) => void;
}

type Row = { step: number; rob: number };

/** "2026-05-05 00:00" -> "05 May". A 93-day window needs the day, not the year. */
function axisLabel(track: VesselTrack, step: number): string {
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
 * The vessel's ROB across the whole window, with the scrubbed moment marked.
 *
 * Memoised because the panel re-renders on every step during playback (12/s)
 * while only the red rule moves — without this, 744 points would reconcile
 * twelve times a second to redraw one vertical line.
 */
function VesselRobChart({ track, spec, stepIndex, onSeek }: Props) {
  const rows = useMemo<Row[]>(
    () => track.robMt.map((rob, step) => ({ step, rob })),
    [track],
  );

  const color = GRADE_COLORS[PRICE_SERIES[track.grade]];
  const lastStep = rows.length - 1;

  // Shares the fuel bar's scale so the two read as one statement about the same
  // tank. allowDataOverflow keeps a stem that lands on capacity from expanding
  // the axis past the figure the bar calls 100%.
  const yMax =
    spec.maxRobMt !== null && spec.maxRobMt > 0 ? spec.maxRobMt : "auto";

  return (
    <div className="px-4">
      <div className="h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
            onClick={(state: { activeLabel?: string | number }) => {
              // activeLabel is the x value under the cursor. The axis is
              // numeric, so it is the step index — clicking the trend seeks,
              // the same affordance a bunker-log row already has.
              const step = Number(state?.activeLabel);
              if (Number.isFinite(step)) onSeek(Math.round(step));
            }}
            className="cursor-pointer"
          >
            <CartesianGrid
              stroke={THEME.line}
              strokeDasharray="2 4"
              vertical={false}
            />
            {/* type="number" is required, not cosmetic: Recharts defaults an
                XAxis to "category", on which ReferenceLine x= snaps to a
                category rather than laying the rule at an arbitrary step. */}
            <XAxis
              dataKey="step"
              type="number"
              domain={[0, lastStep]}
              tickFormatter={(step: number) => axisLabel(track, step)}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              width={44}
              domain={[0, yMax]}
              allowDataOverflow
              tickCount={4}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <Tooltip
              content={<RobTooltip track={track} />}
              cursor={{ stroke: THEME.lineStrong }}
            />

            {/* The thresholds the panel names in words, as positions. */}
            {spec.minRobMt !== null && (
              <ReferenceLine
                y={spec.minRobMt}
                stroke={THEME.warn}
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            )}
            {spec.bunkeringTriggerMt !== null && (
              <ReferenceLine
                y={spec.bunkeringTriggerMt}
                stroke={THEME.faint}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
              />
            )}

            <Line
              type="linear"
              dataKey="rob"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              /* "linear", not PriceChart's "monotone": a stem is a genuine
                 vertical step, and smoothing would round it into a ramp the
                 vessel never sails. */
            />

            {/* Where we are. Declared last so it paints above the series. */}
            <ReferenceLine
              x={stepIndex}
              stroke={THEME.down}
              strokeWidth={1}
              ifOverflow="visible"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-faint">
        <span style={{ color: THEME.down }}>Red</span> marks the scrubbed
        moment; click the chart to seek. Dashed rules are the bunker trigger and
        safety minimum — both derived from deadweight, not measured.
      </p>
    </div>
  );
}

function RobTooltip({
  track,
  active,
  label,
  payload,
}: {
  track: VesselTrack;
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value?: number }>;
}) {
  const step = Number(label);
  if (!active || !payload?.length || !Number.isFinite(step)) return null;

  const lifted = track.bunkered[step] ?? null;

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="tnum text-[10px] text-faint">
        {stepTimestamp(track, step)}
      </div>
      <div className="tnum mt-1 text-[11px] text-fg">
        {formatMt(payload[0].value)} MT {track.grade}
      </div>
      {lifted !== null && (
        <div className="tnum mt-0.5 text-[10px] text-accent">
          Lifted {formatMt(lifted)} MT
        </div>
      )}
    </div>
  );
}

export default memo(VesselRobChart);
