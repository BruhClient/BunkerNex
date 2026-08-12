"use client";

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
import type { RobTimelinePoint } from "@/lib/routeBunkerPlan";

interface Props {
  title: string;
  points: RobTimelinePoint[];
  /** Which established grade token colors this tank's line — VLSFO for the
   * residual tank, MGO for the compliance tank (whichever grade it actually
   * carries, this desk only ever nominates MGO into it — see spotBunker.ts). */
  lineGrade: "VLSFO" | "MGO";
}

/**
 * One tank's projected ROB across a full plan, chained call to call —
 * generalizes VesselRobChart's single-stem view into an N-stop line. The
 * 90% safe-fill cap (this recommender's own rule, see routeBunkerPlan.ts)
 * and the tank's minimum floor are drawn as reference lines so a plan's
 * "filled to the 90% cap" claim is visibly true rather than asserted.
 */
export default function RobTimelineChart({ title, points, lineGrade }: Props) {
  if (points.length <= 1) {
    return (
      <div className="rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
        No {title.toLowerCase()} calls in this horizon.
      </div>
    );
  }

  const capMt = points[0].capMt;
  const floorMt = points[0].floorMt;

  return (
    <div className="rounded border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fg">{title}</span>
        <span className="text-[10px] text-faint">
          90% cap {formatMt(capMt)} MT · floor {formatMt(floorMt)} MT
        </span>
      </div>
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: THEME.faint, fontSize: 9 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              interval={0}
              angle={-18}
              textAnchor="end"
              height={38}
            />
            <YAxis
              width={48}
              domain={[0, Math.max(capMt, ...points.map((p) => p.robMt)) * 1.08]}
              allowDataOverflow
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toLocaleString()}
            />
            <Tooltip
              contentStyle={{
                background: THEME.surface,
                border: `1px solid ${THEME.line}`,
                fontSize: 11,
              }}
              formatter={(v: number) => [`${formatMt(v)} MT`, "ROB"]}
            />

            <ReferenceLine
              y={floorMt}
              stroke={THEME.warn}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
              label={{ value: "floor", position: "insideBottomRight", fill: THEME.warn, fontSize: 9 }}
            />
            <ReferenceLine
              y={capMt}
              stroke={THEME.accent}
              strokeDasharray="3 3"
              strokeOpacity={0.6}
              label={{ value: "90% cap", position: "insideTopRight", fill: THEME.accent, fontSize: 9 }}
            />

            <Line
              type="linear"
              dataKey="robMt"
              stroke={GRADE_COLORS[lineGrade]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
