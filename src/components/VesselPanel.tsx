"use client";

import { useEffect, useMemo } from "react";
import { serviceColor } from "@/lib/colors";
import { activeGradeAt, buildLegs, stepTimestamp } from "@/lib/vesselPosition";
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

  // The two thresholds the simulation ignores — see data/README.md. Surfacing
  // them here is the point of the panel: a vessel below its minimum is not a
  // schedule anyone could actually run.
  const belowMin = spec.minRobMt !== null && residualRob < spec.minRobMt;
  const belowTrigger =
    spec.bunkeringTriggerMt !== null && residualRob < spec.bunkeringTriggerMt;

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
              mgoMaxMt={mgoMaxMt}
              mgoMinMt={mgoMinMt}
            />
          </div>

          {(belowMin || belowTrigger) && (
            <div className="mx-4 mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2">
              <p className="text-[11px] leading-relaxed text-warn">
                {residualRob <= 0 ? (
                  <>
                    <span className="font-semibold">No fuel onboard.</span> The
                    simulation runs this vessel to zero — not a survivable state.
                  </>
                ) : belowMin ? (
                  <>
                    <span className="font-semibold">Below safety minimum</span>{" "}
                    of {int(spec.minRobMt)} MT.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Below bunker trigger</span>{" "}
                    of {int(spec.bunkeringTriggerMt)} MT.
                  </>
                )}{" "}
                The movement data does not enforce either threshold, so these
                ROB curves are not a feasible operating plan.
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
