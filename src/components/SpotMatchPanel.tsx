"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EmissionsEstimate, Narrative } from "@/app/api/spot-match/route";
import { THEME } from "@/lib/colors";
import { formatDateShort, formatMt, formatPrice } from "@/lib/format";
import type { PriceForecast } from "@/lib/priceForecast";
import type { SpotMatchResult } from "@/lib/spotMatch";
import type { BunkeringSimulation, RobPoint } from "@/lib/spotSimulation";
import { SPOT_PANEL_WIDTH } from "./SpotBunkerPanel";

export type SpotMatchPhase = "matching" | "result" | "error";

interface Props {
  vesselName: string;
  phase: SpotMatchPhase;
  result: SpotMatchResult | null;
  simulation: BunkeringSimulation | null;
  narrative: Narrative | null;
  narrativeError: string | null;
  emissions: EmissionsEstimate | null;
  priceForecast: PriceForecast | null;
  /** Network-level failure message, set only when phase is "error". */
  errorMessage: string | null;
  onBack: () => void;
  onClose: () => void;
  onEdit: () => void;
  onRetry: () => void;
}

/**
 * Everything after the spot bunker form is submitted: the loading state, the
 * ranked recommendation, or a network failure. A sibling to SpotBunkerPanel
 * rather than folded into it — that component's own doc comment scopes it to
 * "collects the requirement and nothing else."
 *
 * `onBack`/`onClose` are passed through unguarded; Explorer is the one that
 * no-ops them while phase is "matching" so every exit path (back arrow,
 * Escape, close X, the map) is blocked from a single place.
 */
export default function SpotMatchPanel({
  vesselName,
  phase,
  result,
  simulation,
  narrative,
  narrativeError,
  emissions,
  priceForecast,
  errorMessage,
  onBack,
  onClose,
  onEdit,
  onRetry,
}: Props) {
  // Same Esc-to-back contract SpotBunkerPanel installs. Explorer guards
  // onBack itself, so a stray Esc during matching is already inert here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const matching = phase === "matching";

  return (
    <aside
      style={{ maxWidth: SPOT_PANEL_WIDTH }}
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:shadow-none"
      aria-label={`Spot bunker match for ${vesselName}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className={`-ml-1 mb-1 flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] transition-colors ${
              matching
                ? "cursor-default text-faint/50"
                : "text-faint hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <svg width="9" height="8" viewBox="0 0 9 8" aria-hidden className="shrink-0">
              <path
                d="M4 1L1 4l3 3M1 4h7"
                stroke="currentColor"
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="truncate">{vesselName}</span>
          </button>
          <h2 className="truncate text-[15px] font-semibold leading-tight text-fg">
            {matching
              ? "Matching…"
              : phase === "error"
                ? "Match failed"
                : "Supplier match"}
          </h2>
        </div>

        {matching ? (
          <span
            role="status"
            aria-label="Matching in progress — exit is disabled until complete"
            className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-faint/40 border-t-accent"
          />
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 shrink-0 rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {phase === "matching" && <MatchingBody />}
        {phase === "error" && (
          <ErrorBody message={errorMessage} onRetry={onRetry} onEdit={onEdit} />
        )}
        {phase === "result" && result && (
          <ResultBody
            result={result}
            simulation={simulation}
            narrative={narrative}
            narrativeError={narrativeError}
            emissions={emissions}
            priceForecast={priceForecast}
            onEdit={onEdit}
          />
        )}
      </div>
    </aside>
  );
}

/**
 * The whole pipeline is one atomic fetch, so there is no real incremental
 * progress to report — this is a client-side staged reveal, not a stream.
 * True SSE progress is a documented future enhancement, not v1.
 */
function MatchingBody() {
  const [stage, setStage] = useState<1 | 2>(1);
  useEffect(() => {
    const t = setTimeout(() => setStage(2), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <ol className="space-y-2 text-[12px] text-muted">
        <li className="flex items-center gap-2">
          <span className="text-accent">✓</span> Checking supplier offers…
        </li>
        <li className="flex items-center gap-2">
          {stage === 2 ? (
            <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-faint/40 border-t-accent" />
          ) : (
            <span className="size-3 shrink-0 rounded-full border border-line" />
          )}
          Writing recommendation…
        </li>
      </ol>

      <div className="animate-pulse rounded border border-line-strong bg-surface-2 px-3 py-3">
        <div className="h-3 w-1/2 rounded bg-line" />
        <div className="mt-2.5 h-5 w-2/3 rounded bg-line" />
        <div className="mt-2 h-2.5 w-full rounded bg-line" />
      </div>
    </div>
  );
}

function ErrorBody({
  message,
  onRetry,
  onEdit,
}: {
  message: string | null;
  onRetry: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <p className="text-[12px] leading-relaxed text-fg">
        {message ?? "The match request failed."}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="flex-1 rounded border border-line-strong bg-surface-2 px-3 py-2 text-[12px] font-semibold text-fg transition-colors hover:bg-surface"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 rounded border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:text-fg"
        >
          Edit requirement
        </button>
      </div>
    </div>
  );
}

function ResultBody({
  result,
  simulation,
  narrative,
  narrativeError,
  emissions,
  priceForecast,
  onEdit,
}: {
  result: SpotMatchResult;
  simulation: BunkeringSimulation | null;
  narrative: Narrative | null;
  narrativeError: string | null;
  emissions: EmissionsEstimate | null;
  priceForecast: PriceForecast | null;
  onEdit: () => void;
}) {
  const { winner, candidates, disqualified, warnings } = result;

  if (!winner) {
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-[12px] leading-relaxed text-fg">
          {warnings[0] ??
            "No supplier offers matched this requirement at this port."}
        </p>
        {disqualified.length > 0 && (
          <ul className="space-y-1 text-[11px] leading-relaxed text-faint">
            {disqualified.map((d, i) => (
              <li key={i}>
                {d.offer.supplier}: {d.reason}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded border border-line-strong bg-surface-2 px-3 py-2 text-[12px] font-semibold text-fg transition-colors hover:bg-surface"
        >
          Edit requirement
        </button>
      </div>
    );
  }

  const alternatives = candidates.slice(1, 5);

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {warnings.length > 0 && (
        <div className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-warn">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {/* Winner card */}
      <div className="rounded border border-line-strong bg-surface-2 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold text-fg">
              {winner.offer.supplier}
            </span>
            <span
              className="rounded-[2px] border border-line px-1 text-[9px] font-semibold text-faint"
              title={winner.offer.tierLabel}
            >
              T{winner.offer.tier}
            </span>
          </span>
          <span className="rounded-[3px] bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
            Best
          </span>
        </div>
        <div className="tnum mt-1.5 text-[20px] font-semibold text-fg">
          ${formatPrice(winner.totalCostUsdPerMt)}
          <span className="ml-1 text-[11px] font-normal text-faint">
            $/mt total landed
          </span>
        </div>
        <div className="tnum mt-1 text-[11px] text-muted">
          {formatPrice(winner.priceUsdPerMt)} price + {formatPrice(winner.emissionsCostUsdPerMt)} emissions
          {winner.trendNudgeUsdPerMt !== 0 && (
            <>
              {" "}
              {winner.trendNudgeUsdPerMt > 0 ? "+" : "−"}
              {formatPrice(Math.abs(winner.trendNudgeUsdPerMt))} trend
            </>
          )}
        </div>
      </div>

      {/* Why */}
      <div>
        <h3 className="label mb-1.5">Why</h3>
        {narrative ? (
          <>
            <p className="text-[12px] leading-relaxed text-fg">
              {narrative.headline}
            </p>
            <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted">
              {narrative.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
            {narrative.risks.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-warn">
                {narrative.risks.map((r, i) => (
                  <li key={i}>⚠ {r}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
              {winner.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-faint">
              {narrativeError ?? "AI explanation unavailable."}
            </p>
          </>
        )}
      </div>

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <div>
          <h3 className="label mb-1.5">Alternatives ({alternatives.length})</h3>
          <ul className="space-y-1">
            {alternatives.map((c) => (
              <li
                key={c.offer.supplier}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="min-w-0 truncate text-muted">
                  {c.offer.supplier}
                </span>
                <span className="tnum shrink-0 text-faint">
                  +${formatPrice(c.totalCostUsdPerMt - winner.totalCostUsdPerMt)}/mt
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disqualified offers — an audit trail for why a cheaper-looking
          quote didn't win. */}
      {disqualified.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-faint hover:text-fg">
            {disqualified.length} offer{disqualified.length === 1 ? "" : "s"} excluded
          </summary>
          <ul className="mt-1.5 space-y-1 pl-3 text-[10px] leading-relaxed text-faint">
            {disqualified.map((d, i) => (
              <li key={i}>
                {d.offer.supplier}: {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Cost + ROB simulation */}
      {simulation && (
        <div>
          <h3 className="label mb-1.5">Cost &amp; ROB simulation</h3>
          <dl className="grid grid-cols-2 gap-2">
            <Cell label="Fuel cost" value={formatUsd(simulation.costBreakdown.fuelCostUsd)} />
            <Cell label="Emissions cost" value={formatUsd(simulation.costBreakdown.emissionsCostUsd)} />
            <Cell label="Total landed" value={formatUsd(simulation.costBreakdown.totalLandedCostUsd)} />
            <Cell label="Nomination" value={`${formatMt(simulation.costBreakdown.nominationMt)} MT`} />
            {emissions && (
              <Cell label="CO2e generated" value={`${formatMt(emissions.co2eTonnes)} t`} />
            )}
          </dl>
          <div className="mt-2">
            <RobChart robTimeline={simulation.robTimeline} />
          </div>
          {narrative?.simulationNarrative && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
              {narrative.simulationNarrative}
            </p>
          )}
        </div>
      )}

      {/* Price trend */}
      {priceForecast && (
        <div>
          <h3 className="label mb-1.5">Price trend</h3>
          <PriceForecastChart forecast={priceForecast} />
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
            {priceForecast.note}
          </p>
        </div>
      )}

      <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-faint">
        Nothing here is sourced — supplier prices, differentials and this
        write-up are all generated for this demo. Emissions cost is a flat,
        unscoped EU ETS estimate, not a scoped compliance liability.
      </p>

      <button
        type="button"
        onClick={onEdit}
        className="rounded border border-line-strong bg-surface-2 px-3 py-2 text-[12px] font-semibold text-fg transition-colors hover:bg-surface"
      >
        Edit requirement
      </button>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 text-[11px] text-fg">{value}</dd>
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function RobChart({ robTimeline }: { robTimeline: RobPoint[] }) {
  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={robTimeline} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: THEME.faint, fontSize: 9 }}
            axisLine={{ stroke: THEME.line }}
            tickLine={false}
            interval={0}
          />
          <YAxis
            width={40}
            tick={{ fill: THEME.faint, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => Math.round(v).toString()}
          />
          <Tooltip content={<RobPointTooltip />} cursor={{ stroke: THEME.lineStrong }} />
          <Line
            type="linear"
            dataKey="robMt"
            stroke={THEME.accent}
            strokeWidth={1.5}
            dot={{ r: 2.5, fill: THEME.accent, strokeWidth: 0 }}
            activeDot={{ r: 3.5, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RobPointTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: RobPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="text-[10px] text-faint">{point.label}</div>
      <div className="tnum text-[11px] text-fg">{formatMt(point.robMt)} MT</div>
      {point.note && <div className="mt-0.5 text-[10px] text-warn">{point.note}</div>}
    </div>
  );
}

interface PriceTrendRow {
  date: string;
  actual: number | null;
  projected: number | null;
}

/**
 * Actual history (solid) joined to the trend-drift projection (dashed) at a
 * single shared row so the two lines meet — never let the dashed half look
 * like a continuation of real quotes without that visual break.
 */
function buildPriceTrendRows(forecast: PriceForecast): PriceTrendRow[] {
  const rows: PriceTrendRow[] = forecast.actual.map((p) => ({
    date: p.date,
    actual: p.value,
    projected: null,
  }));

  for (const p of forecast.forecast) {
    const last = rows[rows.length - 1];
    if (last && last.date === p.date) {
      last.projected = p.value;
    } else {
      rows.push({ date: p.date, actual: null, projected: p.value });
    }
  }
  return rows;
}

function PriceForecastChart({ forecast }: { forecast: PriceForecast }) {
  const data = buildPriceTrendRows(forecast);
  return (
    <div className="h-[140px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={THEME.line} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => formatDateShort(d)}
            tick={{ fill: THEME.faint, fontSize: 9 }}
            axisLine={{ stroke: THEME.line }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            width={40}
            tick={{ fill: THEME.faint, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => Math.round(v).toString()}
          />
          <Tooltip content={<PriceTrendTooltip />} cursor={{ stroke: THEME.lineStrong }} />
          <Line
            type="linear"
            dataKey="actual"
            stroke={THEME.accent}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="projected"
            stroke={THEME.muted}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceTrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: PriceTrendRow }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const value = point.actual ?? point.projected;
  return (
    <div className="rounded border border-line-strong bg-surface px-2.5 py-2 shadow-xl">
      <div className="text-[10px] text-faint">{formatDateShort(point.date)}</div>
      <div className="tnum text-[11px] text-fg">
        ${formatPrice(value)}/mt
        {point.actual === null && point.projected !== null && (
          <span className="ml-1 text-[9px] font-normal text-muted">projected</span>
        )}
      </div>
    </div>
  );
}
