"use client";

import { useEffect, useState } from "react";
import PriceChart from "./PriceChart";
import PriceTiles from "./PriceTiles";
import SchedulePanel from "./SchedulePanel";
import SupplierOffers from "./SupplierOffers";
import { serviceColor } from "@/lib/colors";
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
  onClose: () => void;
}

export default function PortPanel({ port, portCalls, onClose }: Props) {
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
            <span className="label">Bunker prices</span>
          </div>

          {loading && (
            <p className="px-4 pb-4 text-xs text-faint">Loading prices…</p>
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
                Prices cover a separate set of global bunker hubs. Of the ports
                on these services, only Singapore and Shanghai are quoted.
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
        </section>

        {!loading && !error && hasMarkets && data && (
          <section className="mt-2 border-t border-line">
            <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
              <span className="label">Supplier offers</span>
              <span className="text-[10px] text-faint">cheapest first</span>
            </div>

            <SupplierOffers markets={data.markets} />
          </section>
        )}

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
