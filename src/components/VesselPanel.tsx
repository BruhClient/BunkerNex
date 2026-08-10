"use client";

import { useEffect, useMemo } from "react";
import { serviceColor } from "@/lib/colors";
import {
  activeGradeAt,
  buildLegs,
  robState,
  stepTimestamp,
} from "@/lib/vesselPosition";
import VesselFuelBar from "./VesselFuelBar";
import VesselRobChart from "./VesselRobChart";
import VesselStems from "./VesselStems";
import type { BunkerEvent } from "@/lib/bunkerEvents";
import { MGO_TANK_MIN_RATIO, MGO_TANK_RATIO } from "@/lib/types";
import type {
  PortCall,
  Service,
  VesselGrade,
  VesselSizeClass,
  VesselSpec,
  VesselTrack,
} from "@/lib/types";

interface Props {
  spec: VesselSpec | null;
  track: VesselTrack | null;
  service: Service | null;
  portCalls: PortCall[];
  stepIndex: number;
  /** Every stem in the window. Filtered to this vessel here. */
  events: BunkerEvent[];
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
  };
  const activeGrade = activeGradeAt(track, stepIndex);
  const lifted = track.bunkered[activeGrade][stepIndex] ?? null;

  // Thresholds are measured against the residual pair together, since that is
  // the capacity they were derived from. MGO has its own, smaller tank.
  const residualRob = robMt.HSFO + robMt.VLSFO;
  const mgoMaxMt =
    spec.maxRobMt === null ? null : spec.maxRobMt * MGO_TANK_RATIO;
  const mgoMinMt = mgoMaxMt === null ? null : mgoMaxMt * MGO_TANK_MIN_RATIO;

  // Both thresholds are enforced by scripts/gen-vessel-movement.mjs, which
  // asserts Min_ROB_MT ≤ HSFO + VLSFO ≤ Max_ROB_MT across all 26,040 rows
  // before writing — data/README.md, "The bunkering trigger is now enforced".
  // So what is worth surfacing is distance to the next stem, not a breach:
  // crossing the trigger is the generator working, not failing.
  const state = robState(residualRob, spec.minRobMt, spec.bunkeringTriggerMt);

  // The stem this vessel is heading for, once it is under the trigger. MGO is
  // excluded: it stems against its own tank on its own trigger, so an ECA lift
  // two days out says nothing about when the residual pair is topped up.
  const nextStem =
    state === "due"
      ? (stems.find((e) => e.step >= stepIndex && e.grade !== "MGO") ?? null)
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
              mgoMaxMt={mgoMaxMt}
              mgoMinMt={mgoMinMt}
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
              track.scrubber ? "HSFO + VLSFO + MGO" : "VLSFO + MGO"
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
            MGO is carried by every vessel and burned through China and Korea
            ECA calls.
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
