"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { THEME } from "@/lib/colors";
import { formatDateShort, formatPrice } from "@/lib/format";
import type { CallForecast } from "@/app/api/route-plan/route";

/**
 * Categorical hues for the 3 forecast models + ensemble median.
 *
 * Reuses the app's existing validated default categorical theme (see
 * SupplierPriceHistory.tsx's SUPPLIER_COLORS — same OKLCH lightness band,
 * chroma floor, and >=8 CVD separation under deuteranopia/protanopia,
 * re-checked here for this 4-hue subset) rather than hand-picking new hex —
 * this is a different categorical axis (model identity, not supplier
 * identity) in a different chart, so reuse carries no meaning collision.
 * Clear of accent/up/down/warn, same reserved-semantics rule.
 */
const MODEL_COLORS = {
  trend: "#4791E3",
  seasonal: "#D65FA3",
  meanReversion: "#B18B26",
  ensemble: "#33AC80",
} as const;

interface ChartRow {
  date: string;
  actual: number | null;
  trend: number | null;
  seasonal: number | null;
  meanReversion: number | null;
  ensemble: number | null;
}

interface Props {
  title: string;
  forecast: CallForecast;
}

/**
 * One port×grade's price history plus all three forecast models and their
 * ensemble median, so the route plan's cost basis is visibly grounded in
 * data rather than asserted. Aligned by array INDEX against the ensemble
 * (see computeForecastEnsemble's own doc comment) — all three models share
 * the same anchor date at index 0, so index i means the same forecast day
 * in every one of them.
 */
export default function ForecastModelChart({ title, forecast }: Props) {
  const { trend, seasonal, meanReversion, ensemble } = forecast;

  const actualSource = seasonal?.actual ?? meanReversion?.actual ?? trend?.actual ?? [];
  const rows: ChartRow[] = [];

  for (const p of actualSource) {
    if (p.value === null) continue;
    rows.push({
      date: p.date,
      actual: p.value,
      trend: null,
      seasonal: null,
      meanReversion: null,
      ensemble: null,
    });
  }

  ensemble.forEach((point, i) => {
    rows.push({
      date: point.date,
      actual: null,
      trend: trend?.forecast[i]?.value ?? null,
      seasonal: seasonal?.forecast[i]?.value ?? null,
      meanReversion: meanReversion?.forecast[i]?.value ?? null,
      ensemble: point.value,
    });
  });

  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
        Not enough price history to forecast {title}.
      </div>
    );
  }

  return (
    <div className="rounded border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fg">{title}</span>
        <span className="text-[10px] text-faint">the plan prices off the ensemble median</span>
      </div>
      <div className="h-[190px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              stroke={THEME.faint}
              tick={{ fontSize: 10 }}
              minTickGap={30}
            />
            <YAxis
              stroke={THEME.faint}
              tick={{ fontSize: 10 }}
              width={48}
              tickFormatter={(v: number) => formatPrice(v)}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                background: THEME.surface,
                border: `1px solid ${THEME.line}`,
                fontSize: 11,
              }}
              labelFormatter={(d: string) => formatDateShort(d)}
              formatter={(value: number, name: string) => [formatPrice(value), name]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke={THEME.fg}
              dot={false}
              strokeWidth={1.5}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="trend"
              name="Trend-nudge"
              stroke={MODEL_COLORS.trend}
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="seasonal"
              name="Seasonal"
              stroke={MODEL_COLORS.seasonal}
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="meanReversion"
              name="Mean-reversion"
              stroke={MODEL_COLORS.meanReversion}
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="ensemble"
              name="Ensemble (median)"
              stroke={MODEL_COLORS.ensemble}
              dot={false}
              strokeWidth={2.5}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
