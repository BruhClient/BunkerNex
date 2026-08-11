"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { THEME } from "@/lib/colors";
import { formatDateShort, formatPrice } from "@/lib/format";
import type { PriceForecast } from "@/lib/priceForecast";

interface PriceTrendRow {
  date: string;
  actual: number | null;
  projected: number | null;
}

/**
 * Actual history (solid) joined to the trend-drift projection (dashed) at a
 * single shared row so the two lines meet — never let the dashed half look
 * like a continuation of real quotes without that visual break.
 */
function buildPriceTrendRows(forecast: PriceForecast): PriceTrendRow[] {
  const rows: PriceTrendRow[] = forecast.actual.map((p) => ({
    date: p.date,
    actual: p.value,
    projected: null,
  }));

  for (const p of forecast.forecast) {
    const last = rows[rows.length - 1];
    if (last && last.date === p.date) {
      last.projected = p.value;
    } else {
      rows.push({ date: p.date, actual: null, projected: p.value });
    }
  }
  return rows;
}

export function PriceForecastChart({ forecast }: { forecast: PriceForecast }) {
  const data = buildPriceTrendRows(forecast);
  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatDateShort(d)}
            tick={{ fill: THEME.faint, fontSize: 9 }}
            axisLine={{ stroke: THEME.line }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            width={40}
            tick={{ fill: THEME.faint, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => Math.round(v).toString()}
          />
          <Tooltip content={<PriceTrendTooltip />} cursor={{ stroke: THEME.lineStrong }} />
          <Line
            type="linear"
            dataKey="actual"
            stroke={THEME.accent}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="projected"
            stroke={THEME.muted}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceTrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: PriceTrendRow }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const value = point.actual ?? point.projected;
  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="text-[10px] text-faint">{formatDateShort(point.date)}</div>
      <div className="tnum text-[11px] text-fg">
        ${formatPrice(value)}/mt
        {point.actual === null && point.projected !== null && (
          <span className="ml-1 text-[9px] font-normal text-muted">projected</span>
        )}
      </div>
    </div>
  );
}
