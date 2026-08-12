"use client";

import { useMemo } from "react";
import RouteMap from "@/components/RouteMap";
import type { Port, PortCall, VesselTrack } from "@/lib/types";

interface Props {
  ports: Port[];
  portCalls: PortCall[];
  track: VesselTrack;
  stepIndex: number;
  bunkerPlanPortCodes: Set<string> | null;
  /** The Chief Engineer's own fixed next-port nomination, badged separately
   * from bunkerPlanPortCodes above (see RouteMap's is-fixed-nomination). */
  fixedNominationPortCode: string | null;
}

/**
 * A thin, single-vessel wrapper around the full Explorer map — narrows
 * portCalls to this vessel's own service so its route reads on its own,
 * without wiring Explorer's broader visibility/focus state machine into a
 * page that has none of it.
 *
 * Ports are narrowed to this service's own rotation (not the full port list
 * Explorer's map draws) — a single-vessel route has no use for every other
 * service's ports and pricing hubs cluttering the view. Camera movement is
 * switched off entirely (autoFit=false): with one fixed vessel/service on
 * screen there is nothing for a programmatic fitBounds/easeTo to usefully
 * frame, and letting the engineer's own pan/zoom stand is less disruptive
 * than the view jumping on every load, resize or selection.
 */
export default function RoutePlanMap({
  ports,
  portCalls,
  track,
  stepIndex,
  bunkerPlanPortCodes,
  fixedNominationPortCode,
}: Props) {
  const serviceCalls = useMemo(
    () => portCalls.filter((c) => c.serviceCode === track.serviceCode),
    [portCalls, track.serviceCode],
  );
  const routePorts = useMemo(() => {
    const codes = new Set(serviceCalls.map((c) => c.portCode));
    return ports.filter((p) => codes.has(p.key));
  }, [ports, serviceCalls]);
  const visibleVesselNames = useMemo(() => new Set([track.name]), [track.name]);

  return (
    <RouteMap
      ports={routePorts}
      portCalls={serviceCalls}
      vesselTracks={[track]}
      visibleServices={[track.serviceCode]}
      visiblePortKeys={null}
      visibleVesselNames={visibleVesselNames}
      selectedKey={null}
      focusedService={track.serviceCode}
      stepIndex={stepIndex}
      selectedVesselName={track.name}
      focusVesselName={null}
      focusOffsetX={0}
      onSelectPort={() => {}}
      onSelectVessel={() => {}}
      bunkerPlanPortCodes={bunkerPlanPortCodes}
      fixedNominationPortCode={fixedNominationPortCode}
      autoFit={false}
    />
  );
}
