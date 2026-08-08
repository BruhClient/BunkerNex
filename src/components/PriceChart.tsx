"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GRADE_COLORS, GRADE_LABELS, sortGrades } from "@/lib/colors";
import { formatDate, formatDateShort, formatPrice } from "@/lib/format";
import { RANGES, downsample, rangeStart, type Range } from "@/lib/series";
import type { Grade, PortPrices, PricePoint } from "@/lib/types";

interface Props {
  grades: PortPrices;
  brent: PricePoint[];
}

type Row = { date: string } & Partial<Record<Grade, number | null>>;

export default function PriceChart({ grades, brent }: Props) {
  const available = useMemo(
    () => sortGrades(Object.keys(grades) as Grade[]),
    [grades],
  );

  const [range, setRange] = useState<Range>("1Y");
  // The MEOH energy-equivalent series are derived from the same methanol
  // quote, so they start hidden to keep the default view readable. Their
  // current values are still shown in the tiles above.
  const [hidden, setHidden] = useState<Grade[]>(["MEOH_VLSFOe", "MEOH_MGOe"]);
  const [showBrent, setShowBrent] = useState(false);

  const shownKey = available.filter((g) => !hidden.includes(g)).join(",");

  const { rows, yDomain } = useMemo(() => {
    const shown = (shownKey ? shownKey.split(",") : []) as Grade[];
    const byDate = new Map<string, Row>();

    const add = (grade: Grade, points: PricePoint[]) => {
      for (const p of points) {
        let row = byDate.get(p.date);
        if (!row) {
          row = { date: p.date };
          byDate.set(p.date, row);
        }
        row[grade] = p.value;
      }
    };

    for (const grade of shown) add(grade, grades[grade] ?? []);
    if (showBrent) add("BRENT", brent);

    const all = [...byDate.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    if (all.length === 0) return { rows: all, yDomain: [0, 1] as [number, number] };

    const start = rangeStart(range, all[all.length - 1].date);
    const windowed = start ? all.filter((r) => r.date >= start) : all;
    const out = downsample(windowed);

    // Derive the scale from what is actually plotted. Recharts' "auto" domain
    // pads down to zero, which squashes every line into the top third.
    let min = Infinity;
    let max = -Infinity;
    for (const row of out) {
      for (const [key, v] of Object.entries(row)) {
        if (key === "date" || typeof v !== "number") continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { rows: out, yDomain: [0, 1] as [number, number] };
    }
    // Snap to a round step so the axis reads 200/400/600 rather than
    // 190/740/1290. Recharts is left to place ticks inside this domain.
    const span = Math.max(max - min, 1);
    // A finer step than the tick spacing, so snapping the floor does not drag
    // the axis all the way down to zero and squash the lines.
    const target = span / 8;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const step =
      [1, 2, 2.5, 5, 10]
        .map((m) => m * magnitude)
        .find((s) => s >= target) ?? 10 * magnitude;

    return {
      rows: out,
      yDomain: [
        Math.floor(min / step) * step,
        Math.ceil(max / step) * step,
      ] as [number, number],
    };
  }, [grades, brent, shownKey, showBrent, range]);

  if (available.length === 0) return null;

  const shown = (shownKey ? shownKey.split(",") : []) as Grade[];
  const series: Grade[] = showBrent ? [...shown, "BRENT"] : shown;

  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="label">Price trend · $/mt</span>
        <div className="flex items-center gap-px overflow-hidden rounded border border-line">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${
                range === r
                  ? "bg-accent/15 text-accent"
                  : "text-faint hover:text-fg"
              }`}
            >
              {r === "ALL" ? "All" : r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[220px] w-full pr-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={rows}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="#1f2733"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDateShort}
              tick={{ fill: "#5c6675", fontSize: 10 }}
              axisLine={{ stroke: "#1f2733" }}
              tickLine={false}
              minTickGap={44}
            />
            <YAxis
              width={48}
              domain={yDomain}
              allowDataOverflow
              tickCount={6}
              tick={{ fill: "#5c6675", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#2b3546" }} />
            {series.map((grade) => (
              <Line
                key={grade}
                type="monotone"
                dataKey={grade}
                name={GRADE_LABELS[grade]}
                stroke={GRADE_COLORS[grade]}
                strokeWidth={1.5}
                strokeDasharray={grade === "BRENT" ? "4 3" : undefined}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                isAnimationActive={false}
                /* Methanol is quoted weekly against a daily axis; without this
                   it would render as disconnected points. Leading blanks are
                   already trimmed server-side, so nothing is bridged that was
                   never actually quoted. */
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pb-1 pt-3">
        {available.map((grade) => {
          const on = !hidden.includes(grade);
          return (
            <button
              key={grade}
              type="button"
              onClick={() =>
                setHidden((prev) =>
                  prev.includes(grade)
                    ? prev.filter((g) => g !== grade)
                    : [...prev, grade],
                )
              }
              aria-pressed={on}
              className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[10px] transition-colors hover:border-line-strong"
              style={{ opacity: on ? 1 : 0.4 }}
            >
              <span
                aria-hidden
                className="h-0.5 w-3 rounded-full"
                style={{ background: GRADE_COLORS[grade] }}
              />
              <span className={on ? "text-fg" : "text-faint"}>
                {GRADE_LABELS[grade]}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowBrent((v) => !v)}
          aria-pressed={showBrent}
          className="flex items-center gap-1.5 rounded border border-dashed border-line px-2 py-1 text-[10px] transition-colors hover:border-line-strong"
          style={{ opacity: showBrent ? 1 : 0.4 }}
        >
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: GRADE_COLORS.BRENT }}
          />
          <span className={showBrent ? "text-fg" : "text-faint"}>Brent</span>
        </button>
      </div>
    </div>
  );
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey?: string | number; value?: number | null }>;
}

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;

  const entries = payload.filter(
    (p) => p.value !== null && p.value !== undefined,
  );
  if (entries.length === 0) return null;

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="tnum text-[10px] text-faint">{formatDate(label)}</div>
      <div className="mt-1.5 space-y-1">
        {entries.map((entry) => {
          const grade = entry.dataKey as Grade;
          return (
            <div
              key={grade}
              className="flex items-center justify-between gap-4 text-[11px]"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: GRADE_COLORS[grade] }}
                />
                <span className="text-muted">{GRADE_LABELS[grade]}</span>
              </span>
              <span className="tnum font-medium text-fg">
                {formatPrice(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
