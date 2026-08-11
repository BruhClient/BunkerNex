"use client";

import { formatDate, formatMt, formatPercent, formatPrice } from "@/lib/format";
import type { SupplierTransaction } from "@/lib/supplierAnalytics";

/**
 * One supplier's settled stems at this market: what was asked, what was signed,
 * and what both the assessment and the forecast said at the time.
 *
 * The forecast column is the desk marking its own homework — it was computed
 * from data available ten days before each stem, never with hindsight, so a
 * wide error here is a real finding about the model rather than a display bug.
 *
 * Same colour rule as the scorecard: variance stays in text-muted with an
 * explicit sign, because a lower number is the better buy and text-up/down mean
 * price direction elsewhere in the app.
 */
export default function SupplierTransactionTable({
  transactions,
  supplier,
}: {
  transactions: SupplierTransaction[];
  supplier: string;
}) {
  const rows = transactions.filter((t) => t.supplier === supplier);

  if (rows.length === 0) {
    return (
      <div className="mx-4 rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
        No settled stems recorded for {supplier} at this market.
      </div>
    );
  }

  const anchored = rows.filter((r) => r.fromFleetStem).length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-line">
              <th className="label py-1.5 pl-4 pr-2 text-left font-normal">
                Date
              </th>
              <th className="label py-1.5 pr-2 text-left font-normal">Vessel</th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                MT
              </th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                Quoted
              </th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                Signed
              </th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                Benchmark
              </th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                Forecast
              </th>
              <th className="label w-16 py-1.5 pr-2 text-right font-normal">
                v BM
              </th>
              <th className="label py-1.5 pr-4 text-left font-normal">
                Outcome
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => {
              const vsBenchmark =
                ((tx.contractedUsdPerMt - tx.benchmarkUsdPerMt) /
                  tx.benchmarkUsdPerMt) *
                100;
              return (
                <tr
                  key={`${tx.date}|${tx.vessel}`}
                  className="border-b border-line/60 last:border-b-0"
                >
                  <td className="tnum py-1.5 pl-4 pr-2 text-faint">
                    {formatDate(tx.date)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-muted">{tx.vessel}</span>
                      {tx.fromFleetStem && (
                        <span
                          aria-hidden
                          title="Vessel and quantity from the fleet movement series"
                          className="size-1 shrink-0 rounded-full bg-accent/60"
                        />
                      )}
                    </span>
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-muted">
                    {formatMt(tx.quantityMt)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-muted">
                    {formatPrice(tx.quotedUsdPerMt)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-fg">
                    {formatPrice(tx.contractedUsdPerMt)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-muted">
                    {formatPrice(tx.benchmarkUsdPerMt)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-faint">
                    {formatPrice(tx.forecastAtTimeUsdPerMt)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-muted">
                    {formatPercent(vsBenchmark)}
                  </td>
                  <td className="py-1.5 pr-4 text-faint">{tx.outcome}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-4 pt-2 text-[10px] leading-relaxed text-faint">
        {anchored > 0 ? (
          <>
            <span
              aria-hidden
              className="mr-1 inline-block size-1 rounded-full bg-accent/60 align-middle"
            />
            {anchored} of {rows.length} take their vessel and tonnage from the
            fleet movement series; the rest are backfilled. Every price on this
            table is simulated either way.
          </>
        ) : (
          <>
            All rows here are backfilled outside the fleet movement window.
            Every price on this table is simulated.
          </>
        )}{" "}
        Forecast was computed from data available ten days before each stem.
      </p>
    </div>
  );
}
