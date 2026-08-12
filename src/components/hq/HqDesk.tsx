"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import SupplierPriceHistory from "./SupplierPriceHistory";
import SupplierScatter from "./SupplierScatter";
import SupplierScorecard from "./SupplierScorecard";
import SupplierTransactionTable from "./SupplierTransactionTable";
import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { formatDate } from "@/lib/format";
import type { HqAnalyticsResponse } from "@/app/api/hq/analytics/[portKey]/[grade]/route";
import type { Grade } from "@/lib/types";

export interface HqPortOption {
  key: string;
  name: string;
  country: string | null;
  /** Grades this port has a supplier panel in, in display order. */
  grades: Grade[];
}

type Horizon = 10 | 30;

/** Where the desk opens. Singapore is the deepest panel in the dataset. */
const DEFAULT_PORT = "SGSIN";

/**
 * The desk's state hub.
 *
 * Deliberately mirrors Explorer's contract rather than inventing one: this owns
 * every selection and the panels below are stateless. The one piece of state
 * that is not a user choice is `data`, which is refetched whenever the market
 * changes.
 */
export default function HqDesk({
  ports,
  asOf,
}: {
  ports: HqPortOption[];
  asOf: string | null;
}) {
  // Seeded once from the URL, so a deep link from the port panel ("view this
  // supplier's full record") lands on the right market instead of always
  // opening at the desk's own default. An invalid or absent param falls
  // through to the same defaults as a bare "/hq" visit — never a blank panel.
  const searchParams = useSearchParams();
  const initialPort = searchParams.get("port");
  const initialGrade = searchParams.get("grade");
  const initialSupplier = searchParams.get("supplier");

  const [portKey, setPortKey] = useState(
    () =>
      ports.find((p) => p.key === initialPort)?.key ??
      ports.find((p) => p.key === DEFAULT_PORT)?.key ??
      ports[0]?.key ??
      "",
  );
  // Validated the same way a manual selection is: activeGrade below falls
  // back to the port's first grade if this doesn't match.
  const [grade, setGrade] = useState<Grade | null>(
    (initialGrade as Grade | null) ?? null,
  );
  const [supplier, setSupplier] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(10);
  // Applied once the market's supplier list is known, and only once — after
  // that a manual deselect (clicking the same row again) must stick.
  const appliedInitialSupplier = useRef(false);

  const [data, setData] = useState<HqAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const port = useMemo(
    () => ports.find((p) => p.key === portKey) ?? null,
    [ports, portKey],
  );

  // Keep the grade valid across a port change — the same guard
  // PriceForecastDrawer applies, and for the same reason: a port that does not
  // sell the selected fuel would otherwise fetch a guaranteed empty market.
  const activeGrade = useMemo<Grade | null>(() => {
    if (!port || port.grades.length === 0) return null;
    return grade && port.grades.includes(grade) ? grade : port.grades[0];
  }, [port, grade]);

  useEffect(() => {
    if (!portKey || !activeGrade) {
      setData(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/hq/analytics/${portKey}/${activeGrade}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json() as Promise<HqAnalyticsResponse>;
      })
      .then((payload) => {
        setData(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load market.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [portKey, activeGrade]);

  // A supplier selected in one market does not exist in the next.
  useEffect(() => {
    setSupplier(null);
  }, [portKey, activeGrade]);

  /** Alphabetical: this is the colour order, and it must not track price. */
  const suppliers = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.quoteHistory.map((q) => q.supplier))].sort();
  }, [data]);

  // Deep-linked supplier, applied once the first market's roster is known.
  // Runs at most once per page load, so it never fights a later manual
  // selection or the reset-on-market-change effect above.
  useEffect(() => {
    if (appliedInitialSupplier.current || suppliers.length === 0) return;
    appliedInitialSupplier.current = true;
    if (initialSupplier && suppliers.includes(initialSupplier)) {
      setSupplier(initialSupplier);
    }
  }, [suppliers, initialSupplier]);

  const forecast = horizon === 10 ? data?.forecast10 : data?.forecast30;

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/"
            className="rounded text-[15px] font-semibold tracking-tight text-fg transition-colors hover:text-accent"
          >
            Bunker<span className="text-accent">Nex</span>
          </Link>
          <span className="hidden text-xs text-muted sm:inline">
            HQ bunker desk · supplier evaluation
          </span>
          <Link
            href="/route-plan"
            className="hidden items-center rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-fg sm:inline-flex"
          >
            Route Plan
          </Link>
        </div>
        <div className="shrink-0 text-right">
          <div className="label leading-none">Prices as of</div>
          <div className="tnum mt-0.5 text-xs text-fg">{formatDate(asOf)}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-5">
          {/* Filters in one row above the charts. */}
          <section className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-line py-4">
            <label className="flex flex-col gap-1">
              <span className="label">Port</span>
              <select
                value={portKey}
                onChange={(e) => setPortKey(e.target.value)}
                className="min-w-[200px] rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-fg outline-none transition-colors hover:border-line-strong"
              >
                {ports.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                    {p.country ? ` · ${p.country}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="label">Fuel</span>
              <div className="flex items-center gap-px overflow-hidden rounded border border-line">
                {(port?.grades ?? []).map((g) => {
                  const active = g === activeGrade;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrade(g)}
                      aria-pressed={active}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                        active ? "bg-accent/15 text-accent" : "text-faint hover:text-fg"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{
                          background: GRADE_COLORS[g],
                          opacity: active ? 1 : 0.45,
                        }}
                      />
                      {GRADE_LABELS[g]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="label">Forecast horizon</span>
              <div className="flex items-center gap-px overflow-hidden rounded border border-line">
                {([10, 30] as Horizon[]).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorizon(h)}
                    aria-pressed={horizon === h}
                    className={`flex items-center justify-center px-3 py-1.5 text-[10px] font-medium transition-colors ${
                      horizon === h
                        ? "bg-accent/15 text-accent"
                        : "text-faint hover:text-fg"
                    }`}
                  >
                    {h} days
                  </button>
                ))}
              </div>
            </div>
          </section>

          {loading && (
            <p className="py-16 text-center text-[11px] text-faint">
              Loading market…
            </p>
          )}
          {error && (
            <p className="py-16 text-center text-[11px] text-down">{error}</p>
          )}

          {!loading && !error && data && (
            <>
              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
                  <span className="label">Market positioning</span>
                  <span className="text-[10px] text-faint">
                    quote against delivery capability
                  </span>
                </div>
                {data.market ? (
                  <SupplierScatter
                    market={data.market}
                    fleet={data.fleet}
                    suppliers={suppliers}
                    selected={supplier}
                    onSelect={setSupplier}
                  />
                ) : (
                  <EmptyState>
                    No supplier panel quotes {GRADE_LABELS[data.grade]} at this
                    port.
                  </EmptyState>
                )}
              </section>

              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
                  <span className="label">Quote history &amp; forecast</span>
                  <span className="text-[10px] text-faint">
                    {horizon}-day horizon
                  </span>
                </div>
                <SupplierPriceHistory
                  quoteHistory={data.quoteHistory}
                  supplierDiffForecast={data.supplierDiffForecast}
                  forecast={forecast ?? null}
                  suppliers={suppliers}
                  selected={supplier}
                  onSelect={setSupplier}
                />
              </section>

              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
                  <span className="label">Supplier record</span>
                  <span className="text-[10px] text-faint">
                    year to date · best realised first
                  </span>
                </div>
                <SupplierScorecard
                  scorecards={data.scorecards}
                  suppliers={suppliers}
                  selected={supplier}
                  onSelect={setSupplier}
                />
              </section>

              {supplier && (
                <section className="border-b border-line py-4">
                  <div className="flex items-baseline justify-between gap-3 px-4 pb-2">
                    <span className="label">Bunkering history · {supplier}</span>
                    <span className="text-[10px] text-faint">
                      most recent first
                    </span>
                  </div>
                  <SupplierTransactionTable
                    transactions={data.transactions}
                    supplier={supplier}
                  />
                </section>
              )}

              <Provenance />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-4 rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
      {children}
    </div>
  );
}

/**
 * Not optional copy. Every figure on this page above the benchmark line is
 * generated — the barge fleets, the quote history, the contracted prices and
 * the negotiation outcomes have no source, and at the 28 modelled ports the
 * benchmark underneath is a hub plus a judgment differential rather than an
 * assessment. data/README.md is the record of which is which.
 */
function Provenance() {
  return (
    <p className="px-4 py-5 text-[10px] leading-relaxed text-faint">
      Supplier quotes, delivery fleets, contracted prices and negotiation
      outcomes on this page are <span className="text-warn">simulated</span> —
      no source document in this dataset carries a supplier rate, a barge
      figure or a settled contract price. Benchmarks are real assessments at 10
      ports and modelled from a hub plus a documented basis at 28 more. Treat
      these as a working model of a bunker desk, not as market data.
    </p>
  );
}
