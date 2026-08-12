"use client";

import { GRADE_COLORS } from "@/lib/colors";
import { formatDate, formatMt, formatPrice } from "@/lib/format";
import type { RouteBunkerPlan } from "@/lib/routeBunkerPlan";

interface Props {
  plan: RouteBunkerPlan;
  /** 1-based position after cost sorting — not the same as plan.id. */
  rank: number;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One ranked bunkering combination: port × grade × quantity × supplier at
 * each recommended stop, plus the total landed cost driving its rank.
 * Clicking selects it for the map/charts below — the same pattern
 * SupplierScatter/SupplierScorecard already use for cross-highlighting a
 * supplier in HqDesk.
 */
export default function CombinationCard({ plan, rank, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-2 rounded border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/5"
          : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              rank === 1 ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"
            }`}
          >
            {rank}
          </span>
          <span className="truncate text-[12px] font-medium text-fg">{plan.label}</span>
        </div>
        <span className="tnum shrink-0 text-[13px] font-semibold text-fg">
          ${formatPrice(plan.totalCostUsd)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-faint">
        <span>
          {plan.stopCount} stop{plan.stopCount === 1 ? "" : "s"}
        </span>
        <span aria-hidden>·</span>
        <span>{formatMt(plan.totalQuantityMt)} MT total</span>
      </div>

      {plan.stops.length === 0 ? (
        <p className="py-1 text-[11px] text-faint">
          No bunkering recommended in this horizon.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5 border-t border-line pt-2">
          {plan.stops.map((s, i) => (
            <li key={`${s.portCode}-${s.tank}-${i}`} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: GRADE_COLORS[s.grade] }}
                  />
                  <span className="truncate">
                    {s.portName ?? s.portCode} · {s.grade}
                  </span>
                </span>
                <span className="tnum shrink-0 text-faint">{formatMt(s.quantityMt)} MT</span>
              </div>
              <div className="tnum flex items-center justify-between gap-2 text-faint">
                <span className="truncate">
                  {s.supplier} · {formatDate(s.arrivalTimestamp.split(" ")[0])}
                </span>
                <span className="shrink-0">${formatPrice(s.priceUsdPerMt)}/mt</span>
              </div>
              {(s.bargeCapacityMtPerDay !== null || s.contractedVsBenchmarkPct !== null) && (
                <div className="tnum flex items-center gap-2 text-[10px] text-faint">
                  {s.bargeCapacityMtPerDay !== null && (
                    <span>{formatMt(s.bargeCapacityMtPerDay)} MT/day capacity</span>
                  )}
                  {s.contractedVsBenchmarkPct !== null && (
                    <span>
                      {s.contractedVsBenchmarkPct <= 0 ? "" : "+"}
                      {s.contractedVsBenchmarkPct.toFixed(1)}% vs benchmark
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {plan.warnings.length > 0 && (
        <p className="border-t border-line pt-2 text-[10px] text-warn">
          {plan.warnings[0]}
        </p>
      )}
    </button>
  );
}
