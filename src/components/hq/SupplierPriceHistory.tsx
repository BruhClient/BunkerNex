"use client";
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { THEME } from "@/lib/colors";
import { formatDateShort, formatPrice } from "@/lib/format";
import type { SeasonalForecast } from "@/lib/priceForecast";
import type {
  SupplierForecastPoint,
  SupplierQuotePoint,
} from "@/lib/supplierAnalytics";

/**
 * A year of every supplier's quote at one market, against the benchmark, with
 * the forecast carried forward.
 *
 * The supplier lines are what `supplier_offers.csv` cannot show: it holds one
 * static differential per market, so drawing from it alone would produce a
 * stack of parallel lines. These cross, converge and diverge, which is the
 * behaviour a desk is actually judging.
 *
 * THE BENCHMARK FORECAST IS FITTED PROPERLY; THE SUPPLIER CONTINUATIONS ARE
 * NOT A SECOND FORECAST. Each supplier's dashed line is the projected
 * benchmark plus that supplier's own projected differential —
 * `supplierDiffForecast`, a gentle day-by-day wander generated alongside the
 * historical quote history (see gen-supplier-quote-history.mjs), not a fit
 * against ~52 weekly points the way the benchmark's is. It is not a claim
 * about what any individual supplier will do, and the caption says so.
 *
 * MATCHED BY INDEX, NOT BY DATE. `forecast.forecast[i]` (i=1..horizonDays) and
 * `supplierDiffForecast[supplier][i-1]` both mean "day i of the horizon", but
 * their absolute dates can differ by a few days for a less-liquid market — the
 * generator anchors a market's forecast rows to its own last historical point,
 * while computeSeasonalForecast anchors to the true last point of the
 * benchmark series. Joining on date string would silently drop the supplier
 * offset for those markets.
 */

/**
 * Categorical hues for up to five suppliers.
 *
 * Validated: all five sit inside the dark-mode OKLCH lightness band, clear the
 * chroma floor, hold ΔE >= 9.2 between adjacent pairs under deuteranopia,
 * protanopia and tritanopia, and clear 3:1 against the chart surface.
 *
 * Deliberately clear of the palette's reserved semantics — accent cyan is
 * selection, and up-green / down-red / warn-amber carry price direction and
 * provenance elsewhere in the app. A supplier line is identity, not a value
 * judgement, so it must not borrow any of those.
 *
 * Assigned by ALPHABETICAL POSITION within the market, never by price rank: a
 * supplier's colour must not change because it got cheaper.
 */
const SUPPLIER_COLORS = [
  "#4791E3",
  "#D65FA3",
  "#B18B26",
  "#33AC80",
  "#9279E3",
] as const;

/** Any panel past the palette falls back to neutral rather than a new hue. */
const OVERFLOW_COLOR = THEME.faint;

export function supplierColor(supplier: string, ordered: string[]): string {
  const i = ordered.indexOf(supplier);
  return i >= 0 && i < SUPPLIER_COLORS.length
    ? SUPPLIER_COLORS[i]
    : OVERFLOW_COLOR;
}

interface Row {
  date: string;
  bmActual: number | null;
  bmProjected: number | null;
  band: [number, number] | null;
  [seriesKey: string]: unknown;
}

const actualKey = (supplier: string) => `a:${supplier}`;
const projectedKey = (supplier: string) => `p:${supplier}`;

export default function SupplierPriceHistory({
  quoteHistory,
  supplierDiffForecast,
  forecast,
  suppliers,
  selected,
  onSelect,
}: {
  quoteHistory: SupplierQuotePoint[];
  /** Keyed by supplier, ascending by date. See the file header. */
  supplierDiffForecast: Record<string, SupplierForecastPoint[]>;
  forecast: SeasonalForecast | null;
  /** Alphabetical, and the colour order. */
  suppliers: string[];
  selected: string | null;
  onSelect: (supplier: string | null) => void;
}) {
  const { rows, joinDate } = useMemo(() => {
    const byDate = new Map<string, Row>();
    const diffs = new Map<string, number>();

    for (const point of quoteHistory) {
      let row = byDate.get(point.date);
      if (!row) {
        row = {
          date: point.date,
          bmActual: point.benchmarkUsdPerMt,
          bmProjected: null,
          band: null,
        };
        byDate.set(point.date, row);
      }
      row[actualKey(point.supplier)] = point.quoteUsdPerMt;
      // History is ascending, so the last write per supplier is its latest.
      diffs.set(point.supplier, point.diffUsdPerMt);
    }

    const ordered = [...byDate.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const join = ordered[ordered.length - 1]?.date ?? null;

    if (forecast && join) {
      for (const [i, point] of forecast.forecast.entries()) {
        // The forecast's first element repeats the last actual so the solid and
        // dashed halves meet. Write it onto the existing join row rather than
        // appending a duplicate date.
        const target =
          i === 0
            ? ordered[ordered.length - 1]
            : ({
                date: point.date,
                bmActual: null,
                bmProjected: null,
                band: null,
              } satisfies Row);

        target.bmProjected = point.value;
        target.band = [point.lower, point.upper];
        for (const [supplier, diff] of diffs) {
          // Index-based, not date-based — see the file header. i is the
          // horizon day (1..horizonDays); supplierDiffForecast[i-1] is that
          // supplier's own projected offset for that same day.
          const projected = supplierDiffForecast[supplier]?.[i - 1];
          const offset = projected ? projected.diffUsdPerMt : diff;
          target[projectedKey(supplier)] = Math.max(0, point.value + offset);
        }
        if (i > 0) ordered.push(target);
      }
    }

    return { rows: ordered, joinDate: join };
  }, [quoteHistory, forecast, supplierDiffForecast]);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-[11px] text-faint">
        No quote history for this market. The benchmark has not been assessed in
        the past year.
      </p>
    );
  }

  const covered = `${formatDateShort(rows[0].date)} – ${formatDateShort(
    rows[rows.length - 1].date,
  )}`;

  return (
    <div>
      {/* Legend first: identity must never rest on colour alone, and this
          doubles as the supplier selector for the record below. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-2">
        {suppliers.map((supplier) => {
          const on = selected === null || selected === supplier;
          return (
            <button
              key={supplier}
              type="button"
              onClick={() => onSelect(selected === supplier ? null : supplier)}
              aria-pressed={selected === supplier}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
              style={{ opacity: on ? 1 : 0.4 }}
            >
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ background: supplierColor(supplier, suppliers) }}
              />
              {supplier}
            </button>
          );
        })}
        <span className="flex items-center gap-1.5 px-1 text-[10px] text-faint">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: THEME.fg }}
          />
          Benchmark
        </span>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDateShort(d)}
              tick={{ fill: THEME.faint, fontSize: 9 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              minTickGap={36}
            />
            <YAxis
              width={56}
              tick={{ fill: THEME.muted, fontSize: 10 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <Tooltip
              content={<HistoryTooltip suppliers={suppliers} />}
              cursor={{ stroke: THEME.lineStrong }}
            />

            {/* ±1σ of the fit. Drawn under everything and very quiet — it is
                context for the dashed lines, not a series in its own right. */}
            <Area
              dataKey="band"
              stroke="none"
              fill={THEME.muted}
              fillOpacity={0.1}
              isAnimationActive={false}
              activeDot={false}
            />

            {joinDate && (
              <ReferenceLine
                x={joinDate}
                stroke={THEME.lineStrong}
                strokeDasharray="3 3"
                label={{
                  value: "today",
                  position: "insideTopRight",
                  fill: THEME.faint,
                  fontSize: 9,
                }}
              />
            )}

            {/* The benchmark reads as the reference: brightest, and the only
                series in plain foreground ink rather than a categorical hue. */}
            <Line
              type="monotone"
              dataKey="bmActual"
              stroke={THEME.fg}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="bmProjected"
              stroke={THEME.fg}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls
            />

            {suppliers.map((supplier) => {
              const dimmed = selected !== null && selected !== supplier;
              const color = supplierColor(supplier, suppliers);
              return [
                <Line
                  key={actualKey(supplier)}
                  type="monotone"
                  dataKey={actualKey(supplier)}
                  stroke={color}
                  strokeWidth={selected === supplier ? 2.25 : 1.5}
                  strokeOpacity={dimmed ? 0.22 : 1}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls
                />,
                <Line
                  key={projectedKey(supplier)}
                  type="monotone"
                  dataKey={projectedKey(supplier)}
                  stroke={color}
                  strokeWidth={selected === supplier ? 2.25 : 1.5}
                  strokeOpacity={dimmed ? 0.18 : 0.75}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  isAnimationActive={false}
                  connectNulls
                />,
              ];
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-1 px-4 pt-1.5">
        <p className="tnum text-[10px] text-faint">{covered}</p>
        {forecast && (
          <p className="text-[10px] leading-relaxed text-faint">
            Dashed is projection, not quotes. {forecast.note} Supplier
            continuations show each house&apos;s own projected differential
            against the projected benchmark — not a claim about what any
            individual supplier will do.
          </p>
        )}
      </div>
    </div>
  );
}

function HistoryTooltip({
  active,
  payload,
  label,
  suppliers,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
  label?: string;
  suppliers?: string[];
}) {
  if (!active || !payload?.length || !suppliers) return null;
  const row = payload[0].payload;

  const benchmark = row.bmActual ?? row.bmProjected;
  const projected = row.bmActual === null;

  const entries = suppliers
    .map((supplier) => ({
      supplier,
      value: (row[actualKey(supplier)] ?? row[projectedKey(supplier)]) as
        | number
        | undefined,
    }))
    .filter((e) => typeof e.value === "number")
    .sort((a, b) => (a.value as number) - (b.value as number));

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="tnum text-[10px] text-faint">
        {formatDateShort(label ?? row.date)}
        {projected && <span className="ml-1 text-muted">projected</span>}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-4 border-b border-line pb-1.5">
        <span className="flex items-center gap-1.5 text-[10px] text-muted">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: THEME.fg }}
          />
          Benchmark
        </span>
        <span className="tnum text-[11px] font-medium text-fg">
          ${formatPrice(benchmark as number | null)}
        </span>
      </div>

      <dl className="mt-1.5 space-y-0.5">
        {entries.map((entry) => (
          <div
            key={entry.supplier}
            className="flex items-center justify-between gap-4"
          >
            <dt className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: supplierColor(entry.supplier, suppliers) }}
              />
              {entry.supplier}
            </dt>
            <dd className="tnum text-[10px] text-fg">
              ${formatPrice(entry.value as number)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
