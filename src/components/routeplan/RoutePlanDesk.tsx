"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CombinationCard from "./CombinationCard";
import ForecastModelChart from "./ForecastModelChart";
import RobTimelineChart from "./RobTimelineChart";
import RoutePlanMap from "./RoutePlanMap";
import TimeScrubber from "@/components/TimeScrubber";
import { THEME } from "@/lib/colors";
import { isEcaPort } from "@/lib/eca";
import { formatDate, formatPrice } from "@/lib/format";
import { portMeta } from "@/lib/ports";
import type { RouteCallInput, RouteBunkerPlan } from "@/lib/routeBunkerPlan";
import {
  deriveSpotContext,
  isResidual,
  prefillSpotRequest,
  type SpotContext,
  type SpotFuelGrade,
} from "@/lib/spotBunker";
import { buildLegs, stepTimestamp } from "@/lib/vesselPosition";
import type { Port, PortCall, VesselSpec, VesselTrack } from "@/lib/types";
import type { RoutePlanApiResponse } from "@/app/api/route-plan/route";

/** Fixed lookahead: whichever bound is hit first bounds the horizon — a
 * forecast beyond ~30 days has little to say, per priceForecast.ts's own
 * horizon conventions. */
const HORIZON_MAX_CALLS = 5;
const HORIZON_MAX_DAYS = 30;

const GRADE_OPTIONS: SpotFuelGrade[] = ["HSFO", "VLSFO", "MGO"];

interface Props {
  vesselSpecs: VesselSpec[];
  vesselTracks: VesselTrack[];
  ports: Port[];
  portCalls: PortCall[];
  asOf: string | null;
}

/** Client-side, same construction Explorer.tsx already uses for its own
 * futureCalls (see submitSpotMatch), sliced to the ~5-call/~30-day horizon
 * and enriched with the transit/berth/ECA fields the planner needs. */
function buildHorizonCalls(track: VesselTrack, stepIndex: number): RouteCallInput[] {
  const legs = buildLegs(track);
  const currentLegIdx = legs.findIndex(
    (l) => stepIndex >= l.start && stepIndex < l.start + l.length,
  );
  const future = legs.slice(currentLegIdx + 1);

  const calls: RouteCallInput[] = [];
  for (const leg of future) {
    if (calls.length >= HORIZON_MAX_CALLS) break;
    const arrivalStep = leg.start + leg.transitSteps;
    const daysFromNow = ((arrivalStep - stepIndex) * track.stepHours) / 24;
    if (daysFromNow > HORIZON_MAX_DAYS) break;

    calls.push({
      portCode: leg.toKey,
      portName: portMeta(leg.toKey)?.name ?? null,
      arrivalTimestamp: stepTimestamp(track, arrivalStep),
      daysFromNow,
      transitDays: (leg.transitSteps * track.stepHours) / 24,
      portStayDays: ((leg.length - leg.transitSteps) * track.stepHours) / 24,
      isEcaDestination: isEcaPort(leg.toKey),
    });
  }
  return calls;
}

/**
 * The route-wide bunkering optimizer's state hub — mirrors HqDesk's
 * contract: this owns every selection, the panels below are stateless.
 */
export default function RoutePlanDesk({
  vesselSpecs,
  vesselTracks,
  ports,
  portCalls,
  asOf,
}: Props) {
  const specByName = useMemo(
    () => new Map(vesselSpecs.map((s) => [s.name, s])),
    [vesselSpecs],
  );
  const sortedTracks = useMemo(
    () => [...vesselTracks].sort((a, b) => a.name.localeCompare(b.name)),
    [vesselTracks],
  );

  const [vesselName, setVesselName] = useState(() => sortedTracks[0]?.name ?? "");
  const [stepIndex, setStepIndex] = useState(0);

  const track = useMemo(
    () => sortedTracks.find((t) => t.name === vesselName) ?? null,
    [sortedTracks, vesselName],
  );
  const spec = track ? (specByName.get(track.name) ?? null) : null;

  const ctx: SpotContext | null = useMemo(
    () => (track && spec ? deriveSpotContext(spec, track, stepIndex) : null),
    [track, spec, stepIndex],
  );

  // A fresh vessel starts at the window's beginning, same as Explorer's
  // default scrubber position.
  useEffect(() => {
    setStepIndex(0);
    setData(null);
    setSelectedPlanId(null);
    setError(null);
  }, [vesselName]);

  // --- The Chief Engineer's fixed nomination for the immediate next port.
  // Prefilled from the vessel's own projected position, exactly the way
  // SpotBunkerPanel prefills its own draft — but editable here, since this
  // desk has no persisted nomination to read back (see routeBunkerPlan.ts's
  // "not re-optimizing the CE's fixed nomination" scope note: this form IS
  // that fixed input, not a recommendation this page can second-guess).
  const [fixedGrade, setFixedGrade] = useState<SpotFuelGrade | null>(null);
  const [fixedQtyMt, setFixedQtyMt] = useState<number | null>(null);
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ctx) return;
    const seedKey = `${vesselName}|${ctx.portCode}`;
    if (seededRef.current === seedKey) return;
    seededRef.current = seedKey;

    const draft = prefillSpotRequest(ctx);
    setFixedGrade(draft.grade);
    const headroom = draft.grade
      ? isResidual(draft.grade)
        ? ctx.residualHeadroomMt
        : ctx.mgoHeadroomMt
      : null;
    setFixedQtyMt(headroom !== null ? Math.round(headroom) : null);
  }, [ctx, vesselName]);

  const [data, setData] = useState<RoutePlanApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const runPlan = useCallback(() => {
    if (!track || !spec || !ctx) return;
    const horizonCalls = buildHorizonCalls(track, stepIndex);
    if (horizonCalls.length === 0) {
      setData(null);
      setSelectedPlanId(null);
      setError(
        "No further calls on this vessel's remaining route within the 30-day horizon.",
      );
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetch("/api/route-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        spec,
        ctx,
        carriedGrades: [...ctx.carriedGrades],
        fixedNomination:
          fixedGrade && fixedQtyMt && fixedQtyMt > 0
            ? { grade: fixedGrade, quantityMt: fixedQtyMt }
            : null,
        horizonCalls,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<RoutePlanApiResponse>;
      })
      .then((payload: RoutePlanApiResponse) => {
        setData(payload);
        setSelectedPlanId(payload.plans[0]?.id ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not compute a route plan.");
        setLoading(false);
      });
  }, [track, spec, ctx, stepIndex, fixedGrade, fixedQtyMt]);

  // Runs once per vessel/position, right after the nomination prefill
  // settles. Editing the nomination afterward needs the explicit button
  // below — a deliberate submit, the same contract SpotBunkerPanel uses.
  const autoRanRef = useRef<string | null>(null);
  useEffect(() => {
    if (!track || !ctx || fixedQtyMt === null) return;
    const key = `${vesselName}|${stepIndex}`;
    if (autoRanRef.current === key) return;
    autoRanRef.current = key;
    runPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, ctx, fixedQtyMt, vesselName, stepIndex]);

  const selectedPlan: RouteBunkerPlan | null = useMemo(
    () => data?.plans.find((p) => p.id === selectedPlanId) ?? data?.plans[0] ?? null,
    [data, selectedPlanId],
  );

  const bunkerPlanPortCodes = useMemo(
    () => (selectedPlan ? new Set(selectedPlan.stops.map((s) => s.portCode)) : null),
    [selectedPlan],
  );

  // One forecast chart per distinct port×grade the selected plan actually
  // stems at — not every candidate call, or switching combinations would
  // leave stale charts for ports the plan no longer touches.
  const selectedForecasts = useMemo(() => {
    if (!selectedPlan || !data) return [];
    const seen = new Set<string>();
    const out: { title: string; forecast: RoutePlanApiResponse["forecasts"][string][SpotFuelGrade] }[] = [];
    for (const stop of selectedPlan.stops) {
      const key = `${stop.portCode}|${stop.grade}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const forecast = data.forecasts[stop.portCode]?.[stop.grade];
      if (forecast) {
        out.push({ title: `${stop.portName ?? stop.portCode} · ${stop.grade}`, forecast });
      }
    }
    return out;
  }, [selectedPlan, data]);

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
            Route bunker plan · forward-looking optimizer
          </span>
          <Link
            href="/hq"
            className="hidden items-center rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-fg sm:inline-flex"
          >
            Supplier HQ
          </Link>
        </div>
        <div className="shrink-0 text-right">
          <div className="label leading-none">Prices as of</div>
          <div className="tnum mt-0.5 text-xs text-fg">{formatDate(asOf)}</div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-5">
          {/* --- Setup: vessel, position, fixed nomination --- */}
          <section className="flex flex-col gap-3 border-b border-line py-4">
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <label className="flex flex-col gap-1">
                <span className="label">Vessel</span>
                <select
                  value={vesselName}
                  onChange={(e) => setVesselName(e.target.value)}
                  className="min-w-[220px] rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-fg outline-none transition-colors hover:border-line-strong"
                >
                  {sortedTracks.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} · {t.serviceCode}
                    </option>
                  ))}
                </select>
              </label>

              {ctx && (
                <label className="flex flex-col gap-1">
                  <span className="label">
                    Fixed nomination · {ctx.portName ?? ctx.portCode ?? "next port"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={fixedGrade ?? ""}
                      onChange={(e) =>
                        setFixedGrade((e.target.value || null) as SpotFuelGrade | null)
                      }
                      className="rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-fg outline-none transition-colors hover:border-line-strong"
                    >
                      <option value="">—</option>
                      {GRADE_OPTIONS.filter((g) => ctx.eligibleGrades.has(g)).map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={fixedQtyMt ?? ""}
                      onChange={(e) =>
                        setFixedQtyMt(e.target.value === "" ? null : Number(e.target.value))
                      }
                      placeholder="MT"
                      className="tnum w-24 rounded border border-line bg-surface px-2 py-1.5 text-[12px] text-fg outline-none transition-colors hover:border-line-strong"
                    />
                    <span className="text-[10px] text-faint">MT</span>
                  </div>
                </label>
              )}

              <button
                type="button"
                onClick={runPlan}
                disabled={!ctx || loading}
                className="rounded border border-line px-3 py-1.5 text-[11px] font-medium text-fg transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {loading ? "Evaluating…" : "Evaluate route"}
              </button>
            </div>

            {track && (
              <TimeScrubber
                stepCount={track.portCodes.length}
                stepIndex={stepIndex}
                label={stepTimestamp(track, stepIndex)}
                onChange={setStepIndex}
              />
            )}

            <p className="text-[10px] leading-relaxed text-faint">
              The nomination above is the Chief Engineer's own call for the next port —
              this desk treats it as fixed and plans only the calls after it, up to{" "}
              {HORIZON_MAX_CALLS} calls or {HORIZON_MAX_DAYS} days ahead, whichever comes
              first.
            </p>
          </section>

          {loading && (
            <p className="py-16 text-center text-[11px] text-faint">Evaluating route…</p>
          )}
          {error && <p className="py-16 text-center text-[11px] text-down">{error}</p>}

          {!loading && !error && data && (
            <>
              {/* --- Top 3 ranked combinations --- */}
              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                  <span className="label">Top 3 bunkering combinations</span>
                  <span className="text-[10px] text-faint">
                    ranked by total landed cost · price + carbon cost
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {data.plans.map((plan, i) => (
                    <CombinationCard
                      key={plan.id}
                      plan={plan}
                      rank={i + 1}
                      selected={plan.id === selectedPlanId}
                      onSelect={() => setSelectedPlanId(plan.id)}
                    />
                  ))}
                </div>
              </section>

              {/* --- Map --- */}
              {track && (
                <section className="border-b border-line py-4">
                  <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                    <span className="label">Selected combination on the route</span>
                    <span className="text-[10px] text-faint">
                      gold ring marks a recommended stop
                    </span>
                  </div>
                  <div className="h-[420px] overflow-hidden rounded border border-line">
                    <RoutePlanMap
                      ports={ports}
                      portCalls={portCalls}
                      track={track}
                      stepIndex={stepIndex}
                      bunkerPlanPortCodes={bunkerPlanPortCodes}
                    />
                  </div>
                </section>
              )}

              {/* --- Why this route --- */}
              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                  <span className="label">Why this is the most cost-efficient route</span>
                  <span className="text-[10px] text-faint">grounded in the figures above</span>
                </div>
                <div className="grid grid-cols-1 gap-4 px-1 sm:grid-cols-2">
                  <div>
                    <PlanCostBarChart plans={data.plans} selectedPlanId={selectedPlanId} />
                  </div>
                  <div className="flex flex-col gap-2 text-[11px] text-muted">
                    {data.narrative ? (
                      <>
                        <p className="text-fg">{data.narrative.headline}</p>
                        <ul className="list-disc space-y-1 pl-4">
                          {data.narrative.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p>
                        The cheapest plan wins by total landed cost — forecasted price
                        plus carbon cost, summed across every recommended stop. Bars at
                        left compare the three combinations directly.
                      </p>
                    )}
                    <p className="text-[10px] text-faint">
                      Every recommended stem is capped at 90% of tank capacity —
                      international regulation requires headroom for thermal
                      expansion, and a tank filled to 100% risks overflow.
                    </p>
                  </div>
                </div>
              </section>

              {/* --- Forecast models behind the selected plan --- */}
              <section className="border-b border-line py-4">
                <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                  <span className="label">Price forecast · selected combination</span>
                  <span className="text-[10px] text-faint">3 models + ensemble median</span>
                </div>
                {selectedForecasts.length === 0 ? (
                  <EmptyState>No stops in the selected combination to forecast.</EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-3 px-1 lg:grid-cols-2">
                    {selectedForecasts.map(({ title, forecast }) =>
                      forecast ? (
                        <ForecastModelChart key={title} title={title} forecast={forecast} />
                      ) : null,
                    )}
                  </div>
                )}
              </section>

              {/* --- Tank levels across the plan --- */}
              {selectedPlan && (
                <section className="border-b border-line py-4">
                  <div className="flex items-baseline justify-between gap-3 px-1 pb-2">
                    <span className="label">Tank levels · selected combination</span>
                    <span className="text-[10px] text-faint">90% cap · safety floor</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 px-1 lg:grid-cols-2">
                    <RobTimelineChart
                      title="Residual tank (HSFO/VLSFO)"
                      points={selectedPlan.robTimeline.residual}
                      lineGrade="VLSFO"
                    />
                    <RobTimelineChart
                      title="Compliance tank (MGO)"
                      points={selectedPlan.robTimeline.compliance}
                      lineGrade="MGO"
                    />
                  </div>
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
    <div className="mx-1 rounded border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
      {children}
    </div>
  );
}

function PlanCostBarChart({
  plans,
  selectedPlanId,
}: {
  plans: RouteBunkerPlan[];
  selectedPlanId: string | null;
}) {
  const rows = plans.map((p) => ({ id: p.id, label: p.label, cost: p.totalCostUsd }));
  return (
    <div className="h-[130px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
        >
          <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={(v: number) => `$${formatPrice(v)}`}
            tick={{ fill: THEME.faint, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tick={{ fill: THEME.faint, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: THEME.surface,
              border: `1px solid ${THEME.line}`,
              fontSize: 11,
            }}
            formatter={(v: number) => [`$${formatPrice(v)}`, "Total landed cost"]}
          />
          <Bar dataKey="cost" radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell key={r.id} fill={r.id === selectedPlanId ? THEME.accent : THEME.faint} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Not optional copy. This desk's forecasts, supplier scores and the leg-level
 * ECA burn model are all documented approximations — see routeBunkerPlan.ts.
 */
function Provenance() {
  return (
    <p className="px-1 py-5 text-[10px] leading-relaxed text-faint">
      This is decision support, not an exact optimizer. Port/quantity choices
      come from a greedy cheapest-reachable-call search, provably cost-minimal
      only in the idealized case; the compliance tank's burn is approximated
      at one ECA/non-ECA flag per call rather than the finer position-based
      model the fleet simulation itself uses. Supplier quotes, barge fleets
      and contract-vs-quote variance are <span className="text-warn">simulated</span> —
      see data/README.md. Route lines are schematic, not navigable tracks.
    </p>
  );
}
