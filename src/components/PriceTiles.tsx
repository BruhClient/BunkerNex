"use client";

import { GRADE_COLORS, GRADE_LABELS, sortGrades } from "@/lib/colors";
import {
  formatDate,
  formatDelta,
  formatPercent,
  formatPrice,
} from "@/lib/format";
import { latestPoint, previousPoint } from "@/lib/series";
import type { Grade, PortPrices } from "@/lib/types";

export default function PriceTiles({ grades }: { grades: PortPrices }) {
  const available = sortGrades(Object.keys(grades) as Grade[]);

  return (
    <div className="grid grid-cols-2 gap-px bg-line">
      {available.map((grade) => {
        const points = grades[grade] ?? [];
        const latest = latestPoint(points);
        const prev = previousPoint(points);

        const delta =
          latest?.value != null && prev?.value != null
            ? latest.value - prev.value
            : null;
        const pct =
          delta !== null && prev?.value ? (delta / prev.value) * 100 : null;

        const tone =
          delta === null || delta === 0
            ? "text-faint"
            : delta > 0
              ? "text-up"
              : "text-down";

        return (
          <div key={grade} className="bg-surface px-3.5 py-3">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: GRADE_COLORS[grade] }}
              />
              <span className="label">{GRADE_LABELS[grade]}</span>
            </div>

            <div className="tnum mt-1.5 text-[19px] font-semibold leading-none text-fg">
              {formatPrice(latest?.value)}
              <span className="ml-1 text-[10px] font-normal text-faint">
                $/mt
              </span>
            </div>

            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className={`tnum text-[11px] ${tone}`}>
                {formatDelta(delta)}
                {pct !== null && (
                  <span className="ml-1 opacity-70">{formatPercent(pct)}</span>
                )}
              </span>
              {/* Each grade shows its own quote date — Methanol is weekly
                  while the rest are daily, so these legitimately differ. */}
              <span className="tnum text-[10px] text-faint">
                {formatDate(latest?.date)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
