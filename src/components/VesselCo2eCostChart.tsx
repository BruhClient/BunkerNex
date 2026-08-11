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
import { Co2eTooltip } from "./VesselCo2eChart";
import { THEME } from "@/lib/colors";
import type { Co2eCostPoint } from "@/lib/emissions";
import {
  stepAxisLabel,
  vesselCo2eCostSeries,
} from "@/lib/vesselPosition";
import type { VesselTrack } from "@/lib/types";

interface Props {
  track: VesselTrack;
  costSeries: Co2eCostPoint[];
  stepIndex: number;
  onSeek: (step: number) => void;
}

/**
 * Cumulative estimated CO2e cost across the whole window, in USD — the same
 * per-step burned mass as VesselCo2eChart, priced against
 * data/emissions/co2e_cost_per_mt.csv's daily $/mt-fuel figures instead of a
 * flat CO2e factor. An unscoped ceiling, not a modelled liability — see the
 * caveat in the panel section this chart sits under.
 */
function VesselCo2eCostChart({ track, costSeries, stepIndex, onSeek }: Props) {
  const rows = useMemo(
    () => vesselCo2eCostSeries(track, costSeries),
    [track, costSeries],
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
              tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
            />
            <Tooltip
              content={
                <Co2eTooltip
                  track={track}
                  format={(v) => `$${Math.round(v).toLocaleString()}`}
                />
              }
              cursor={{ stroke: THEME.lineStrong }}
            />
            <Line
              type="monotone"
              dataKey="cumulativeUsd"
              stroke={THEME.warn}
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

export default memo(VesselCo2eCostChart);
