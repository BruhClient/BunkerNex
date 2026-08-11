"use client";

import { useEffect, useMemo } from "react";
import { serviceColor, THEME } from "@/lib/colors";
import type { Co2eCostPoint, Co2eFactors } from "@/lib/emissions";
import { formatMt } from "@/lib/format";
import {
  activeGradeAt,
  buildLegs,
  robState,
  stepTimestamp,
  vesselCo2eCostSeries,
  vesselCo2eSeries,
} from "@/lib/vesselPosition";
import Co2ePriceChart from "./Co2ePriceChart";
import VesselCo2eChart from "./VesselCo2eChart";
import VesselCo2eCostChart from "./VesselCo2eCostChart";
import VesselFuelBar from "./VesselFuelBar";
import VesselRobChart from "./VesselRobChart";
import VesselStems from "./VesselStems";
import type { BunkerEvent } from "@/lib/bunkerEvents";
import { COMPLIANCE_TANK_MIN_RATIO, COMPLIANCE_TANK_RATIO } from "@/lib/types";
import type {
  PortCall,
  Service,
  VesselGrade,
  VesselSizeClass,
  VesselSpec,
  VesselTrack,
} from "@/lib/types";

/** What each compliance grade means for this hull, in the descriptive copy. */
const COMPLIANCE_FUEL_NOTE: Record<VesselGrade, string> = {
  MGO: "MGO is its ECA-compliance tank, burned through its ECA calls.",
  MEOH:
    "This is one of the fleet's two methanol dual-fuel vessels: MEOH is " +
    "its ECA-compliance tank in place of MGO, stemmed at Ningbo — the " +
    "only port in this dataset with a priced methanol market.",
  LNG:
    "This is one of the fleet's two LNG dual-fuel vessels: LNG is its " +
    "ECA-compliance tank in place of MGO, stemmed at Ningbo, Shanghai, " +
    "Singapore or Port Klang.",
  B40:
    "This is one of the fleet's two B40 biofuel vessels: B40 (60% MGO / " +
    "40% FAME) is its ECA-compliance tank in place of plain MGO, stemmed " +
    "at Jakarta or Surabaya.",
  VLSFO: "",
  HSFO: "",
};

interface Props {
  spec: VesselSpec | null;
  track: VesselTrack | null;
  service: Service | null;
  portCalls: PortCall[];
  stepIndex: number;
  /** Every stem in the window. Filtered to this vessel here. */
  events: BunkerEvent[];
  co2eFactors: Co2eFactors;
  co2eCostSeries: Co2eCostPoint[];
  onSeek: (step: number) => void;
  /**
   * Opens the spot bunker requirement form. Only offered while the vessel is in
   * transit — a stem is nominated on the way to a berth, not from alongside it.
   */
  onEvaluateSpot?: () => void;
  onClose: () => void;
}

/**
 * Container size band from nominal TEU.
 *
 * Duplicated from lib/vessels.ts rather than imported: that module reads CSVs
 * through node:fs and cannot be pulled into a client bundle — the same reason
 * ServicePanel re-implements its rotation sort inline.
 */
function sizeClassFor(nominalTeu: number | null): VesselSizeClass | null {
  if (nominalTeu === null || nominalTeu <= 0) return null;
  if (nominalTeu < 1000) return "Feeder";
  if (nominalTeu < 3000) return "Feedermax";
  if (nominalTeu < 5100) return "Panamax";
  if (nominalTeu <= 10000) return "Post-Panamax";
  return "Neo-Panamax";
}

const int = (n: number | null) =>
  n === null ? "—" : Math.round(n).toLocaleString();

const dec = (n: number | null, places = 2) =>
  n === null ? "—" : n.toFixed(places);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-1.5">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="tnum text-xs text-fg">{value}</span>
    </div>
  );
}

export default function VesselPanel({
  spec,
  track,
  service,
  portCalls,
  stepIndex,
  events,
  co2eFactors,
  co2eCostSeries,
  onSeek,
  onEvaluateSpot,
  onClose,
}: Props) {
  const vesselName = spec?.name ?? null;

  // Esc closes the panel, mirroring PortPanel's Esc handling.
  useEffect(() => {
    if (!vesselName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vesselName, onClose]);

  const legs = useMemo(() => (track ? buildLegs(track) : []), [track]);

  // Explorer already builds the fleet-wide list once; narrowing it here is the
  // same filter BunkerLog applies for services, and avoids a second walk of
  // every track's bunkered map.
  const stems = useMemo(
    () => events.filter((e) => e.vesselName === vesselName),
    [events, vesselName],
  );

  // The published rotation for this service, plus the ports the simulated
  // track never calls at. Sorted inline for the same reason sizeClassFor is
  // duplicated above.
  const { rotation, skipped } = useMemo(() => {
    if (!service) return { rotation: [] as PortCall[], skipped: [] as string[] };
    const calls = portCalls
      .filter((c) => c.serviceCode === service.code)
      .sort((a, b) => a.sequenceNo - b.sequenceNo);

    const visited = new Set(legs.map((l) => l.toKey));
    const missing = calls
      .filter((c) => !c.loopClosure && !visited.has(c.portCode))
      .map((c) => c.portCode);

    return { rotation: calls, skipped: missing };
  }, [service, portCalls, legs]);

  const co2eSeries = useMemo(
    () => (track ? vesselCo2eSeries(track, co2eFactors) : []),
    [track, co2eFactors],
  );
  const co2eCostSeriesForVessel = useMemo(
    () => (track ? vesselCo2eCostSeries(track, co2eCostSeries) : []),
    [track, co2eCostSeries],
  );

  if (!spec || !track) return null;

  const color = serviceColor(track.serviceCode);
  const sizeClass = sizeClassFor(spec.nominalTeu);

  const phase = track.phases[stepIndex] === "B" ? "Berthed" : "In transit";
  const leg = legs.find(
    (l) => stepIndex >= l.start && stepIndex < l.start + l.length,
  );
  // ROB of every tank at this step, plus what the engine is actually on.
  const robMt: Record<VesselGrade, number> = {
    HSFO: track.robMt.HSFO[stepIndex] ?? 0,
    VLSFO: track.robMt.VLSFO[stepIndex] ?? 0,
    MGO: track.robMt.MGO[stepIndex] ?? 0,
    MEOH: track.robMt.MEOH[stepIndex] ?? 0,
    LNG: track.robMt.LNG[stepIndex] ?? 0,
    B40: track.robMt.B40[stepIndex] ?? 0,
  };
  const activeGrade = activeGradeAt(track, stepIndex);
  const lifted = track.bunkered[activeGrade][stepIndex] ?? null;

  // The ECA-compliance tank: MGO on the fleet at large, MEOH/LNG/B40 on the
  // small subsets that carry one of those instead.
  const complianceGrade = track.complianceGrade;
  const complianceTankRatio = COMPLIANCE_TANK_RATIO[complianceGrade];
  const complianceTankMinRatio = COMPLIANCE_TANK_MIN_RATIO[complianceGrade];

  // Thresholds are measured against the residual pair together, since that is
  // the capacity they were derived from. The compliance tank has its own,
  // separate tank.
  const residualRob = robMt.HSFO + robMt.VLSFO;
  const complianceMaxMt =
    spec.maxRobMt === null ? null : spec.maxRobMt * complianceTankRatio;
  const complianceMinMt =
    complianceMaxMt === null ? null : complianceMaxMt * complianceTankMinRatio;

  // Both thresholds are enforced by scripts/gen-vessel-movement.mjs, which
  // asserts Min_ROB_MT ≤ HSFO + VLSFO ≤ Max_ROB_MT across all 26,040 rows
  // before writing — data/README.md, "The bunkering trigger is now enforced".
  // So what is worth surfacing is distance to the next stem, not a breach:
  // crossing the trigger is the generator working, not failing.
  const state = robState(residualRob, spec.minRobMt, spec.bunkeringTriggerMt);

  // The stem this vessel is heading for, once it is under the trigger. The
  // compliance grade is excluded: it stems against its own tank on its own
  // trigger, so an ECA lift two days out says nothing about when the residual
  // pair is topped up.
  const nextStem =
    state === "due"
      ? (stems.find((e) => e.step >= stepIndex && e.grade !== complianceGrade) ?? null)
      : null;
  const stemDays =
    nextStem === null
      ? null
      : ((nextStem.step - stepIndex) * track.stepHours) / 24;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:shadow-none"
      aria-label={`${spec.name} detail`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-tight text-fg">
            {spec.name}
          </h2>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            IMO {spec.imo} · {spec.flag}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span
              className="rounded-[2px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
              style={{ color, borderColor: color }}
            >
              {track.serviceCode}
            </span>
            <span className="rounded-[2px] border border-line-strong px-1.5 py-0.5 text-[10px] text-muted">
              {sizeClass ? `${sizeClass} container` : "Container vessel"}
            </span>
          </div>
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

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {/* --- State at the scrubbed moment --- */}
        <section>
          <div className="px-4 pb-2 pt-3.5">
            <span className="label">
              Position at {stepTimestamp(track, stepIndex)}
            </span>
          </div>
          <Row label="Status" value={phase} />
          <Row
            label={phase === "Berthed" ? "Alongside" : "Sailing"}
            value={
              leg
                ? phase === "Berthed"
                  ? leg.toKey
                  : `${leg.fromKey} → ${leg.toKey}`
                : "—"
            }
          />
          <Row label="Burning" value={activeGrade} />
          {lifted !== null && (
            <Row
              label="Bunkering now"
              value={`${int(lifted)} MT ${activeGrade}`}
            />
          )}

          {/* Replaces the three scalar rows this section used to carry: the bar
              states the residual split, the MGO tank and which one is burning
              at once, and against capacity rather than as bare tonnages. */}
          <div className="mt-2.5">
            <VesselFuelBar
              robMt={robMt}
              activeGrade={activeGrade}
              scrubber={track.scrubber}
              maxRobMt={spec.maxRobMt}
              minRobMt={spec.minRobMt}
              triggerMt={spec.bunkeringTriggerMt}
              state={state}
              complianceGrade={complianceGrade}
              complianceMaxMt={complianceMaxMt}
              complianceMinMt={complianceMinMt}
            />
          </div>

          {/* Two different things, deliberately styled apart. Under the trigger
              is the plan running to plan; under the floor would mean the CSV
              broke a rule its own generator asserts. Amber is only ever the
              second. */}
          {state === "due" && (
            <div className="mx-4 mt-2 rounded border border-line bg-surface-2 px-3 py-2">
              <p className="text-[11px] leading-relaxed text-muted">
                <span className="font-semibold text-fg">Due to bunker</span> —
                residual is under the {int(spec.bunkeringTriggerMt)} MT trigger.{" "}
                {nextStem === null ? (
                  <>
                    No further residual stem falls inside the window, so the
                    curve runs to the end on what is onboard.
                  </>
                ) : (
                  <>
                    Next stem is {int(nextStem.quantityMt)} MT {nextStem.grade}{" "}
                    at {nextStem.portName}
                    {stemDays !== null && stemDays > 0 && (
                      <>
                        ,{" "}
                        {stemDays < 1
                          ? "within a day"
                          : `in ${dec(stemDays, 1)} days`}
                      </>
                    )}
                    .
                  </>
                )}{" "}
                The {int(spec.minRobMt)} MT floor holds on every row of the
                window — the trigger is the prompt to stem, not a breach.
              </p>
            </div>
          )}

          {state === "breach" && (
            <div className="mx-4 mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2">
              <p className="text-[11px] leading-relaxed text-warn">
                <span className="font-semibold">Below safety minimum</span> of{" "}
                {int(spec.minRobMt)} MT.{" "}
                <code className="font-mono">gen-vessel-movement.mjs</code>{" "}
                asserts this cannot happen before it writes the file, so a
                vessel reaching here means the movement CSV was hand-edited or
                is stale. Re-run the generator rather than reading this curve as
                an operating plan.
              </p>
            </div>
          )}

          {/* A stem is nominated on passage, against the berth ahead — so this
              is offered in transit and withdrawn once the vessel is alongside. */}
          {phase !== "Berthed" && onEvaluateSpot && (
            <div className="px-4 pt-3">
              <button
                type="button"
                onClick={onEvaluateSpot}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-down/40 bg-down/15 px-3 py-2 text-[11px] font-semibold text-down transition-colors hover:bg-down/25"
              >
                Evaluate spot bunkering
              </button>
              <p className="mt-1 text-[10px] leading-relaxed text-faint">
                Nominate against {leg ? leg.toKey : "the next call"}.
              </p>
            </div>
          )}
        </section>

        {/* --- The whole window, not just the scrubbed step --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-2">
            <span className="label">Fuel remaining · trend</span>
          </div>
          <VesselRobChart
            track={track}
            spec={spec}
            stepIndex={stepIndex}
            onSeek={onSeek}
          />
        </section>

        {/* --- Emissions and carbon cost, derived from the same burn --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-2">
            <span className="label">CO2e generated · cumulative</span>
          </div>
          <Row
            label="Emitted so far"
            value={`${formatMt(co2eSeries[stepIndex]?.cumulativeT ?? 0)} t CO2e`}
          />
          <VesselCo2eChart
            track={track}
            factors={co2eFactors}
            stepIndex={stepIndex}
            onSeek={onSeek}
          />

          <div className="mt-3 px-4 pb-2">
            <span className="label">Estimated CO2e cost · cumulative</span>
          </div>
          <Row
            label="Estimated cost so far"
            value={`$${Math.round(
              co2eCostSeriesForVessel[stepIndex]?.cumulativeUsd ?? 0,
            ).toLocaleString()}`}
          />
          <VesselCo2eCostChart
            track={track}
            costSeries={co2eCostSeries}
            stepIndex={stepIndex}
            onSeek={onSeek}
          />

          <div className="mt-3 px-4 pb-2">
            <span className="label">Market CO2e price · EUA, USD/t CO2</span>
          </div>
          <Co2ePriceChart
            track={track}
            costSeries={co2eCostSeries}
            stepIndex={stepIndex}
            onSeek={onSeek}
          />

          <p className="mt-1 px-4 text-[10px] leading-relaxed text-faint">
            Derived from this hull&apos;s own fuel burn ×{" "}
            <code className="font-mono">CO2_per_mt.csv</code>&apos;s
            tank-to-wake factors, priced against{" "}
            <code className="font-mono">co2e_cost_per_mt.csv</code>&apos;s
            daily EUA carbon price. An unscoped ceiling, not a modelled
            liability — real EU ETS rules count a voyage&apos;s emissions at
            100%/50%/0% depending on whether both, one, or neither port call
            is in the EU/EEA, which nothing here classifies. Read these
            figures as what a stem could owe, not what it does.{" "}
            <span style={{ color: THEME.down }}>Red</span> marks the scrubbed
            moment on all three charts; click any of them to seek.
          </p>
        </section>

        {/* --- Every stem, relative to where the scrubber sits --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-2">
            <span className="label">
              Bunkering history
              {stems.length > 0 && ` · ${stems.length}`}
            </span>
          </div>
          <VesselStems
            events={stems}
            stepIndex={stepIndex}
            onSeek={onSeek}
          />
        </section>

        {/* --- Measured specifications --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-2">
            <span className="label">Specifications</span>
          </div>
          <Row label="Deadweight" value={`${int(spec.dwtMt)} MT`} />
          <Row label="Gross tonnage" value={int(spec.gt)} />
          <Row label="Net tonnage" value={int(spec.nt)} />
          <Row
            label="Nominal capacity"
            value={
              spec.nominalTeu === null ? "—" : `${int(spec.nominalTeu)} TEU`
            }
          />
          <Row
            label="Scrubber"
            value={spec.scrubber ? "Fitted" : "Not fitted"}
          />
          <Row
            label="Carries"
            value={
              (track.scrubber ? "HSFO + VLSFO + " : "VLSFO + ") +
              complianceGrade
            }
          />

          {spec.nominalTeu === null && (
            <p className="px-4 pt-1.5 text-[11px] leading-relaxed text-faint">
              Capacity is blank in the source (recorded as 0, which no container
              vessel can be), so no size class is shown.
            </p>
          )}
          {sizeClass && (
            <p className="px-4 pt-1.5 text-[11px] leading-relaxed text-faint">
              Size class is derived from TEU — the source carries no vessel-type
              column.
            </p>
          )}
          <p className="px-4 pt-1.5 text-[11px] leading-relaxed text-faint">
            Engine capability is listed as {spec.fuelTypes.join(", ")} for every
            vessel in the source — read as what the engine can burn, not what
            the vessel may lawfully burn.{" "}
            {track.scrubber
              ? "This one is scrubber-fitted, so HSFO is its main fuel and " +
                "VLSFO its compliant reserve."
              : "Without a scrubber, HSFO is not compliant on this hull, so " +
                "VLSFO is its only residual grade."}{" "}
            {COMPLIANCE_FUEL_NOTE[complianceGrade]}
          </p>
        </section>

        {/* --- Assumed figures, kept visually apart from measurements --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-1">
            <span className="label">Assumed bunker figures</span>
          </div>
          <p className="px-4 pb-2 text-[11px] leading-relaxed text-faint">
            Not measurements. Each is a fixed percentage of deadweight, so any
            vessel of this DWT gets the same numbers.
          </p>
          <Row label="Max ROB · 3.0% DWT" value={`${int(spec.maxRobMt)} MT`} />
          <Row label="Min ROB · 1.0% DWT" value={`${int(spec.minRobMt)} MT`} />
          <Row
            label="At sea · 0.09% DWT"
            value={`${dec(spec.consumptionTransitMtPerDay)} MT/day`}
          />
          <Row
            label="At berth · 0.015% DWT"
            value={`${dec(spec.consumptionBerthMtPerDay)} MT/day`}
          />
          <Row
            label="Bunker trigger · 1.5% DWT"
            value={`${int(spec.bunkeringTriggerMt)} MT`}
          />
        </section>

        {/* --- Service --- */}
        <section className="mt-4 border-t border-line pt-3.5">
          <div className="px-4 pb-2">
            <span className="label">Service</span>
          </div>
          {service ? (
            <>
              <Row label="Route" value={`${service.code} · ${service.name}`} />
              <Row label="Frequency" value={service.frequency} />
              <Row
                label="Published calls"
                value={String(service.portCallCount)}
              />

              <div className="px-4 pt-2.5">
                <div className="mb-1.5 text-[11px] text-faint">
                  Published rotation
                </div>
                <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                  {rotation.map((call, i) => {
                    const visited = legs.some((l) => l.toKey === call.portCode);
                    return (
                      <span
                        key={`${call.portCode}-${i}`}
                        className="flex items-center gap-1"
                      >
                        <span
                          className={`tnum rounded-[2px] border px-1.5 py-0.5 text-[10px] ${
                            visited
                              ? "border-line-strong text-fg"
                              : "border-dashed border-line-strong text-faint line-through"
                          }`}
                        >
                          {call.portCode}
                        </span>
                        {i < rotation.length - 1 && (
                          <span className="text-[10px] text-faint">›</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>

              {skipped.length > 0 && (
                <p className="px-4 pt-2.5 text-[11px] leading-relaxed text-faint">
                  The simulated track never calls at{" "}
                  <span className="text-warn">
                    {[...new Set(skipped)].join(", ")}
                  </span>
                  , though the published rotation includes{" "}
                  {skipped.length === 1 ? "it" : "them"}. Where the two
                  disagree, the map follows the track.
                </p>
              )}
            </>
          ) : (
            <p className="px-4 text-xs text-faint">
              No service master entry for {track.serviceCode}.
            </p>
          )}
        </section>
      </div>
    </aside>
  );
}
