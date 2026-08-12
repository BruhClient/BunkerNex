"use client";

import { useEffect, useState } from "react";
import { GRADE_COLORS, GRADE_LABELS, sortGrades } from "@/lib/colors";
import { formatPrice } from "@/lib/format";
import { computePriceForecast } from "@/lib/priceForecast";
import { computeTrendSignal } from "@/lib/priceTrend";
import type { Grade, Port, PortPrices } from "@/lib/types";
import { PriceForecastChart } from "./PriceForecastChart";

interface PricesResponse {
  portKey: string;
  grades: PortPrices;
}

interface Props {
  ports: Port[];
  open: boolean;
  onToggle: () => void;
}

const DEFAULT_PORT_KEY = "SGSIN";
const DEFAULT_GRADE: Grade = "VLSFO";

/**
 * A global reference forecast, not tied to any selected vessel — unlike the
 * per-call forecasts on the route plan desk, this has no request to inherit a
 * port/grade from, so it carries its own picker and defaults to the
 * fleet's most liquid hub (Singapore VLSFO).
 */
export default function PriceForecastDrawer({ ports, open, onToggle }: Props) {
  const pricePorts = ports
    .filter((p) => p.isPricePort)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [portKey, setPortKey] = useState<string>(
    pricePorts.some((p) => p.key === DEFAULT_PORT_KEY)
      ? DEFAULT_PORT_KEY
      : (pricePorts[0]?.key ?? ""),
  );
  const [grade, setGrade] = useState<Grade>(DEFAULT_GRADE);
  const [data, setData] = useState<PricesResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!portKey) return;
    const controller = new AbortController();
    setLoading(true);

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
        setData(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [portKey]);

  // Keep the selected grade valid whenever the port (and its price data)
  // changes underneath it — a port switch can drop the currently picked grade.
  useEffect(() => {
    const available = sortGrades(Object.keys(data?.grades ?? {}) as Grade[]);
    if (available.length === 0) return;
    setGrade((prev) =>
      available.includes(prev)
        ? prev
        : available.includes(DEFAULT_GRADE)
          ? DEFAULT_GRADE
          : available[0],
    );
  }, [data]);

  if (pricePorts.length === 0) return null;

  const port = pricePorts.find((p) => p.key === portKey) ?? null;
  const availableGrades = sortGrades(Object.keys(data?.grades ?? {}) as Grade[]);
  const series = data?.grades[grade] ?? [];
  const trend = computeTrendSignal(series);
  const forecast = computePriceForecast(series, trend);

  return (
    <section
      className="pointer-events-auto border-t border-line bg-bg/95 backdrop-blur"
      aria-label="Price forecast"
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className={`shrink-0 text-faint transition-transform ${
              open ? "" : "rotate-180"
            }`}
          >
            <path
              d="M1 6.5 L5 2.5 L9 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="label shrink-0 leading-none">Price forecast</span>
          <span className="tnum truncate text-[11px] text-muted">
            {port?.name ?? "—"} · {GRADE_LABELS[grade]}
            {forecast && (
              <> · ${formatPrice(trend?.latestValue ?? null)}/mt</>
            )}
          </span>
        </button>
      </h2>

      {open && (
        <div className="border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={portKey}
              onChange={(e) => setPortKey(e.target.value)}
              className="rounded border border-line bg-surface px-2 py-1.5 text-[11px] text-fg outline-none transition-colors hover:border-line-strong"
            >
              {pricePorts.map((p) => (
                <option key={p.key} value={p.key} className="bg-surface text-fg">
                  {p.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-1.5">
              {availableGrades.map((g) => {
                const on = g === grade;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrade(g)}
                    aria-pressed={on}
                    className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[10px] transition-colors hover:border-line-strong"
                    style={{ opacity: on ? 1 : 0.5 }}
                  >
                    <span
                      aria-hidden
                      className="h-0.5 w-3 rounded-full"
                      style={{ background: GRADE_COLORS[g] }}
                    />
                    <span className={on ? "text-fg" : "text-faint"}>
                      {GRADE_LABELS[g]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2">
            {loading && !data ? (
              <p className="py-4 text-center text-[11px] text-faint">
                Loading…
              </p>
            ) : forecast ? (
              <>
                <PriceForecastChart forecast={forecast} />
                <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
                  {forecast.note}
                </p>
              </>
            ) : (
              <p className="py-4 text-center text-[11px] text-faint">
                No price history for {GRADE_LABELS[grade]} at{" "}
                {port?.name ?? "this port"}.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
