"use client";

import { useEffect, useMemo, useState } from "react";
import PriceChart from "./PriceChart";
import PriceTiles from "./PriceTiles";
import SchedulePanel from "./SchedulePanel";
import SupplierOffers from "./SupplierOffers";
import { GRADE_COLORS, GRADE_LABELS, serviceColor } from "@/lib/colors";
import { summarizePortBunkering, TANK_SERIES } from "@/lib/bunkerEvents";
import { formatMt } from "@/lib/format";
import type { BunkerEvent } from "@/lib/bunkerEvents";
import type {
  Port,
  PortCall,
  PortMarket,
  PortPrices,
  PricePoint,
} from "@/lib/types";

interface PricesResponse {
  portKey: string;
  grades: PortPrices;
  brent: PricePoint[];
  markets: PortMarket[];
}

interface Props {
  port: Port | null;
  portCalls: PortCall[];
  bunkerEvents: BunkerEvent[];
  stepIndex: number;
  onClose: () => void;
}

export default function PortPanel({
  port,
  portCalls,
  bunkerEvents,
  stepIndex,
  onClose,
}: Props) {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricesOpen, setPricesOpen] = useState(false);

  const portKey = port?.key ?? null;

  useEffect(() => {
    if (!portKey) {
      setData(null);
      setError(null);
      return;
    }

    // Discard a slow response if the user has already picked another port.
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/prices/${portKey}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<PricesResponse>;
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load prices");
        setData(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [portKey]);

  // Esc closes the panel.
  useEffect(() => {
    if (!portKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [portKey, onClose]);

  const bunkerHistory = useMemo(() => {
    if (!portKey) return [];
    // As of the scrubbed moment, not the whole window — matches how
    // BunkerLog/VesselStems treat stepIndex as "now" everywhere else.
    const soFar = bunkerEvents.filter((e) => e.step <= stepIndex);
    return summarizePortBunkering(soFar, portKey);
  }, [bunkerEvents, portKey, stepIndex]);

  if (!port) return null;

  const hasPrices = data !== null && Object.keys(data.grades).length > 0;
  const hasMarkets = (data?.markets.length ?? 0) > 0;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:shadow-none"
      aria-label={`${port.name} detail`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-tight text-fg">
            {port.name}
          </h2>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            {port.country} · {port.key}
          </p>
          {port.serviceCodes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {port.serviceCodes.map((code) => (
                <span
                  key={code}
                  className="rounded-[2px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                  style={{
                    color: serviceColor(code),
                    borderColor: serviceColor(code),
                  }}
                >
                  {code}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="-mr-1 shrink-0 rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section>
          <h2>
            <button
              type="button"
              onClick={() => setPricesOpen((v) => !v)}
              aria-expanded={pricesOpen}
              className="flex w-full items-center justify-between px-4 pb-2 pt-3.5 text-left"
            >
              <span className="label">Bunker prices</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden
                className={`shrink-0 text-faint transition-transform ${
                  pricesOpen ? "" : "rotate-180"
                }`}
              >
                <path
                  d="M1 6.5 L5 2.5 L9 6.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
              </svg>
            </button>
          </h2>

          {pricesOpen && (
            <>
              {loading && (
                <p className="px-4 pb-4 text-xs text-faint">
                  Loading prices…
                </p>
              )}

              {error && !loading && (
                <p className="px-4 pb-4 text-xs text-down">{error}</p>
              )}

              {!loading && !error && !hasPrices && (
                /* 12 of the 14 route ports have no quotes in the dataset. Say so
                   plainly rather than showing an empty chart frame. */
                <div className="mx-4 mb-4 rounded border border-dashed border-line px-3 py-4">
                  <p className="text-xs text-muted">
                    No bunker pricing in this dataset.
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-faint">
                    Prices cover a separate set of global bunker hubs. Of the
                    ports on these services, only Singapore and Shanghai are
                    quoted.
                  </p>
                </div>
              )}

              {!loading && !error && hasPrices && data && (
                <>
                  <PriceTiles grades={data.grades} />
                  <div className="mt-4">
                    <PriceChart grades={data.grades} brent={data.brent} />
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {!loading && !error && hasMarkets && data && (
          <section className="mt-2 border-t border-line">
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <span className="label">Supplier offers</span>
              <span className="text-[10px] text-faint">cheapest first</span>
            </div>

            <SupplierOffers markets={data.markets} portKey={port.key} />
          </section>
        )}

        <section className="mt-2 border-t border-line">
          <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
            <span className="label">Bunkering history</span>
          </div>

          {bunkerHistory.length === 0 ? (
            <p className="px-4 pb-4 text-[11px] leading-relaxed text-faint">
              No vessel has bunkered here yet, as of the current time.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <thead>
                <tr className="label border-b border-line">
                  <th className="px-4 pb-1.5 text-left font-medium">
                    Vessel
                  </th>
                  <th className="pb-1.5 text-left font-medium">Grade</th>
                  <th className="px-2 pb-1.5 text-right font-medium">
                    Visits
                  </th>
                  <th className="px-4 pb-1.5 text-right font-medium">
                    Total MT
                  </th>
                </tr>
              </thead>
              <tbody>
                {bunkerHistory.map((v) => (
                  <tr
                    key={v.vesselName}
                    className="border-b border-line/60 last:border-b-0"
                  >
                    <td className="truncate px-4 py-1.5 text-fg">
                      {v.vesselName}
                      <span className="ml-1 text-faint">
                        · {v.serviceCode}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {v.grades.map((g) => (
                          <span
                            key={g}
                            className="inline-flex items-center gap-1"
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{
                                background: GRADE_COLORS[TANK_SERIES[g]],
                              }}
                            />
                            <span className="text-faint">
                              {GRADE_LABELS[TANK_SERIES[g]]}
                            </span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="tnum px-2 py-1.5 text-right text-faint">
                      {v.visitCount}
                    </td>
                    <td className="tnum px-4 py-1.5 text-right text-fg">
                      {formatMt(v.totalMt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mt-2 border-t border-line">
          <div className="px-4 pb-1 pt-3.5">
            <span className="label">Schedule</span>
          </div>
          <SchedulePanel port={port} portCalls={portCalls} />
        </section>
      </div>
    </aside>
  );
}
