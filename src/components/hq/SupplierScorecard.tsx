"use client";

import { supplierColor } from "./SupplierPriceHistory";
import { formatMt, formatPercent } from "@/lib/format";
import type { SupplierScorecard as Scorecard } from "@/lib/supplierAnalytics";

/**
 * How each supplier at this market has actually behaved, and what the desk
 * realised against them.
 *
 * COLOUR RULE, inherited from SupplierOffers: the variance figures are NOT
 * coloured with text-up / text-down. Those mean price direction everywhere
 * else in the app, and here a more negative number is the better outcome —
 * colouring by sign would invert the scale two panels apart. The accent BEST
 * chip carries the judgment instead, exactly as it does on the offers table.
 *
 * Every figure is scoped to one port × grade. Averaging a supplier across
 * grades compares a certified renewable product to a fossil one — see
 * data/README.md.
 */
export default function SupplierScorecard({
  scorecards,
  suppliers,
  selected,
  onSelect,
}: {
  /** Already sorted best-realised-price first by buildScorecards(). */
  scorecards: Scorecard[];
  /** Alphabetical — the colour order shared with the history chart. */
  suppliers: string[];
  selected: string | null;
  onSelect: (supplier: string | null) => void;
}) {
  if (scorecards.length === 0) {
    return (
      <div className="mx-4 rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
        No settled stems recorded at this market.
      </div>
    );
  }

  const best = scorecards[0];
  const chosen = scorecards.find((s) => s.supplier === selected) ?? null;

  return (
    <div>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-line">
            <th className="label py-1.5 pl-4 pr-2 text-left font-normal">
              Supplier
            </th>
            <th className="label w-14 py-1.5 pr-2 text-right font-normal">
              Deals
            </th>
            <th className="label w-20 py-1.5 pr-2 text-right font-normal">
              Quote v BM
            </th>
            <th className="label w-24 py-1.5 pr-2 text-right font-normal">
              Negotiated
            </th>
            <th className="label w-24 py-1.5 pr-4 text-right font-normal">
              Realised v BM
            </th>
          </tr>
        </thead>
        <tbody>
          {scorecards.map((card) => {
            const active = card.supplier === selected;
            return (
              <tr
                key={card.supplier}
                onClick={() =>
                  onSelect(active ? null : card.supplier)
                }
                className={`cursor-pointer border-b border-line/60 transition-colors last:border-b-0 hover:bg-surface-2 ${
                  active ? "bg-accent/10" : ""
                }`}
              >
                <td className="py-1.5 pl-4 pr-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-0.5 w-3 shrink-0 rounded-full"
                      style={{
                        background: supplierColor(card.supplier, suppliers),
                      }}
                    />
                    <span className="truncate text-fg">{card.supplier}</span>
                    {card.supplier === best.supplier && (
                      <span className="shrink-0 rounded-[2px] border border-accent/40 px-1 py-px text-[9px] font-semibold tracking-wide text-accent">
                        BEST
                      </span>
                    )}
                  </span>
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-muted">
                  {card.transactionCount}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-muted">
                  {formatPercent(card.quoteVsBenchmarkPct)}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-muted">
                  {formatPercent(card.contractedVsQuotedPct)}
                </td>
                <td
                  className={`tnum py-1.5 pr-4 text-right ${
                    card.supplier === best.supplier ? "text-accent" : "text-fg"
                  }`}
                >
                  {formatPercent(card.contractedVsBenchmarkPct)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="px-4 pt-2 text-[10px] leading-relaxed text-faint">
        Lower is better in all three columns.{" "}
        <span className="text-muted">Quote v BM</span> is how the house prices
        against the assessment, <span className="text-muted">Negotiated</span>{" "}
        how far the desk moved it off its own quote, and{" "}
        <span className="text-muted">Realised v BM</span> the two combined — the
        figure that decides who to call.
      </p>

      {chosen && <Tiles card={chosen} />}
    </div>
  );
}

function Tiles({ card }: { card: Scorecard }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
        <span className="label">{card.supplier} · year to date</span>
        <span className="tnum text-[10px] text-faint">
          {card.transactionCount} deals · {formatMt(card.totalVolumeMt)} MT
        </span>
      </div>

      {/* The 1px-gap hairline grid PriceTiles uses. */}
      <div className="grid grid-cols-3 gap-px bg-line">
        <Tile
          label="Quote vs benchmark"
          value={card.quoteVsBenchmarkPct}
          hint="how they price the screen"
        />
        <Tile
          label="Contract vs quote"
          value={card.contractedVsQuotedPct}
          hint="what negotiation wins"
        />
        <Tile
          label="Contract vs benchmark"
          value={card.contractedVsBenchmarkPct}
          hint="what the desk realises"
        />
      </div>

      <p className="px-4 pt-2 text-[10px] leading-relaxed text-faint">
        Forecast called this supplier&apos;s settled price to within{" "}
        <span className="tnum text-muted">
          {card.forecastAbsErrorPct.toFixed(1)}%
        </span>{" "}
        on average.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="label leading-none">{label}</div>
      <div className="tnum mt-1.5 text-[19px] font-semibold leading-none text-fg">
        {formatPercent(value)}
      </div>
      <div className="mt-1 text-[10px] text-faint">{hint}</div>
    </div>
  );
}
