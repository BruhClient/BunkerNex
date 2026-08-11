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
import { THEME } from "@/lib/colors";
import type { Co2eFactors } from "@/lib/emissions";
import { formatMt } from "@/lib/format";
import {
  stepAxisLabel,
  stepTimestamp,
  vesselCo2eSeries,
} from "@/lib/vesselPosition";
import type { VesselTrack } from "@/lib/types";

interface Props {
  track: VesselTrack;
  factors: Co2eFactors;
  stepIndex: number;
  onSeek: (step: number) => void;
}

/**
 * Cumulative CO2e emitted across the whole window, summed across every tank
 * this hull carries (both residuals plus its one compliance grade) against
 * each grade's own CO2e_TtW_MT_Per_MT factor. Mirrors VesselRobChart's
 * layout and red "now" rule.
 */
function VesselCo2eChart({ track, factors, stepIndex, onSeek }: Props) {
  const rows = useMemo(
    () => vesselCo2eSeries(track, factors),
    [track, factors],
  );
  const lastStep = rows.length - 1;

  return (
    <div className="px-4">
      <div className="h-[130px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
            onClick={(state: { activeLabel?: string | number }) => {
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
            <XAxis
              dataKey="step"
              type="number"
              domain={[0, lastStep]}
              tickFormatter={(step: number) => stepAxisLabel(track, step)}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              width={44}
              tickCount={4}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <Tooltip
              content={
                <Co2eTooltip
                  track={track}
                  format={(v) => `${formatMt(v)} t CO2e`}
                />
              }
              cursor={{ stroke: THEME.lineStrong }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeT"
              stroke={THEME.accent}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            <ReferenceLine
              x={stepIndex}
              stroke={THEME.down}
              strokeWidth={1}
              ifOverflow="visible"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Co2eTooltip({
  track,
  format,
  active,
  label,
  payload,
}: {
  track: VesselTrack;
  format: (value: number) => string;
  active?: boolean;
  label?: string | number;
  payload?: Array<{ value?: number }>;
}) {
  const step = Number(label);
  const value = payload?.[0]?.value;
  if (!active || value === undefined || !Number.isFinite(step)) return null;

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="tnum text-[10px] text-faint">
        {stepTimestamp(track, step)}
      </div>
      <div className="tnum mt-1 text-[11px] text-fg">{format(value)}</div>
    </div>
  );
}

export default memo(VesselCo2eChart);
