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
import type { Co2eCostPoint } from "@/lib/emissions";
import { dateToStep, stepAxisLabel } from "@/lib/vesselPosition";
import type { VesselTrack } from "@/lib/types";

interface Props {
  /** Any track — every vessel shares the same window, so any one anchors
   *  the date-to-step conversion below. */
  track: VesselTrack;
  costSeries: Co2eCostPoint[];
  stepIndex: number;
  onSeek: (step: number) => void;
}

type Row = { step: number; date: string; euaUsdPerMt: number };

/**
 * The EUA carbon price itself, USD/t CO2 — fleet-wide, not per-vessel, so it
 * looks identical regardless of which vessel is selected. Plotted on the
 * same numeric step axis as every other chart in the panel so one red "now"
 * rule and one click-to-seek convention works across all of them.
 */
function Co2ePriceChart({ track, costSeries, stepIndex, onSeek }: Props) {
  const rows = useMemo<Row[]>(
    () =>
      costSeries.map((p) => ({
        step: dateToStep(track, p.date),
        date: p.date,
        euaUsdPerMt: p.euaUsdPerMt,
      })),
    [track, costSeries],
  );
  const lastStep = rows.length > 0 ? rows[rows.length - 1].step : 0;

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
              domain={["auto", "auto"]}
              tickCount={4}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `$${Math.round(v)}`}
            />
            <Tooltip
              content={<PriceTooltip />}
              cursor={{ stroke: THEME.lineStrong }}
            />
            <Line
              type="monotone"
              dataKey="euaUsdPerMt"
              stroke={THEME.muted}
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

function PriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Row }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="tnum text-[10px] text-faint">{row.date}</div>
      <div className="tnum mt-1 text-[11px] text-fg">
        ${row.euaUsdPerMt.toFixed(2)} / t CO2 (EUA)
      </div>
    </div>
  );
}

export default memo(Co2ePriceChart);
