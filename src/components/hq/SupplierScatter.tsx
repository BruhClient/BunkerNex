"use client";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { THEME } from "@/lib/colors";
import { formatMt, formatPrice } from "@/lib/format";
import type { SupplierFleet } from "@/lib/supplierAnalytics";
import type { PortMarket, SupplierOffer } from "@/lib/types";

/**
 * Where each supplier sits on price against what it can actually deliver.
 *
 * The point of plotting these two together is that neither answers the buying
 * question alone: the cheapest quote in a panel is not the better buy if the
 * supplier cannot move the parcel inside the port stay, and the biggest fleet
 * is not worth paying an open-ended premium for. The quadrant guides make that
 * trade-off readable — cheap-and-capable is bottom-right of the crosshair.
 *
 * Y is Delivery_Capacity_MT_Per_Day, NOT barge tonnage. 51 of the 317 fleet
 * rows are shore-supplied with zero barges, and plotting tonnage would pin all
 * of them to the axis as though they had no capability at all.
 */

interface Row {
  supplier: string;
  price: number;
  capacity: number;
  /** Bubble area — the biggest parcel this supplier will quote. */
  maxMt: number;
  minMt: number;
  bargeCount: number;
  reliability: number;
  leadTimeDays: number;
  tierLabel: string;
  availability: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default function SupplierScatter({
  market,
  fleet,
  selected,
  onSelect,
}: {
  market: PortMarket;
  fleet: SupplierFleet[];
  selected: string | null;
  onSelect: (supplier: string) => void;
}) {
  const bySupplier = new Map(fleet.map((f) => [f.supplier, f]));

  const rows: Row[] = market.offers.flatMap((offer: SupplierOffer) => {
    const f = bySupplier.get(offer.supplier);
    // A quote with no fleet row cannot be placed on the y-axis. Dropping it
    // silently would understate the panel, so the caller is told the count.
    if (!f) return [];
    return [
      {
        supplier: offer.supplier,
        price: offer.price,
        capacity: f.deliveryCapacityMtPerDay,
        maxMt: offer.maxMt,
        minMt: offer.minMt,
        bargeCount: f.bargeCount,
        reliability: f.deliveryReliabilityPct,
        leadTimeDays: offer.leadTimeDays,
        tierLabel: offer.tierLabel,
        availability: offer.availability,
      },
    ];
  });

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[11px] text-faint">
        No supplier has both a quote and a delivery profile at this market.
      </p>
    );
  }

  const missing = market.offers.length - rows.length;
  const baseline = market.baseline?.value ?? null;
  const medianCapacity = median(rows.map((r) => r.capacity));

  // Split the panel so the selected point can be drawn on top in the accent —
  // Recharts paints Scatter series in order, and a single series cannot put one
  // point above its siblings.
  const others = rows.filter((r) => r.supplier !== selected);
  const chosen = rows.filter((r) => r.supplier === selected);

  return (
    <div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="price"
              name="Quote"
              unit=""
              domain={["dataMin - 6", "dataMax + 6"]}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={{ stroke: THEME.line }}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
            />
            <YAxis
              type="number"
              dataKey="capacity"
              name="Capacity"
              width={52}
              domain={[0, "dataMax + 4000"]}
              tick={{ fill: THEME.faint, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
            />
            <ZAxis type="number" dataKey="maxMt" range={[60, 420]} />

            {/* The assessment, and the middle of the panel's capability. Read
                the crosshair as: cheaper than the market, and able to lift. */}
            {baseline !== null && (
              <ReferenceLine
                x={baseline}
                stroke={THEME.lineStrong}
                strokeDasharray="3 3"
                label={{
                  value: "benchmark",
                  position: "top",
                  fill: THEME.faint,
                  fontSize: 9,
                }}
              />
            )}
            <ReferenceLine
              y={medianCapacity}
              stroke={THEME.lineStrong}
              strokeDasharray="3 3"
            />

            <Tooltip
              content={<ScatterTooltip />}
              cursor={{ stroke: THEME.lineStrong, strokeDasharray: "3 3" }}
            />

            <Scatter
              data={others}
              fill={THEME.muted}
              fillOpacity={0.55}
              stroke={THEME.bg}
              strokeWidth={1}
              isAnimationActive={false}
              onClick={(point: unknown) => {
                const row = point as Row | undefined;
                if (row?.supplier) onSelect(row.supplier);
              }}
              className="cursor-pointer"
            />
            <Scatter
              data={chosen}
              fill={THEME.accent}
              stroke={THEME.bg}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-1">
        <p className="text-[10px] leading-relaxed text-faint">
          Bubble size is the largest parcel quoted. Click a supplier to load its
          record below.
        </p>
        {missing > 0 && (
          <p className="text-[10px] leading-relaxed text-warn">
            {missing} quoting supplier{missing === 1 ? "" : "s"} without a
            delivery profile, not shown
          </p>
        )}
      </div>
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
}) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;

  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="text-[11px] font-medium text-fg">{r.supplier}</div>
      {r.tierLabel && (
        <div className="mt-0.5 text-[9px] text-faint">{r.tierLabel}</div>
      )}
      <div className="tnum mt-1.5 text-[11px] text-fg">
        ${formatPrice(r.price)}
        <span className="ml-1 text-[9px] font-normal text-faint">$/mt</span>
      </div>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 text-[10px]">
        <dt className="text-faint">Capacity</dt>
        <dd className="tnum text-right text-muted">
          {formatMt(r.capacity)} MT/day
        </dd>
        <dt className="text-faint">Barges</dt>
        <dd className="tnum text-right text-muted">
          {r.bargeCount > 0 ? r.bargeCount : "shore only"}
        </dd>
        <dt className="text-faint">Parcel</dt>
        <dd className="tnum text-right text-muted">
          {formatMt(r.minMt)}–{formatMt(r.maxMt)} MT
        </dd>
        <dt className="text-faint">Reliability</dt>
        <dd className="tnum text-right text-muted">{r.reliability}%</dd>
        <dt className="text-faint">Lead time</dt>
        <dd className="tnum text-right text-muted">{r.leadTimeDays}d</dd>
      </dl>
    </div>
  );
}
