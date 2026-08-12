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
}

/**
 * A thin, single-vessel wrapper around the full Explorer map — narrows
 * portCalls to this vessel's own service so its route reads on its own,
 * without wiring Explorer's broader visibility/focus state machine into a
 * page that has none of it.
 */
export default function RoutePlanMap({
  ports,
  portCalls,
  track,
  stepIndex,
  bunkerPlanPortCodes,
}: Props) {
  const serviceCalls = useMemo(
    () => portCalls.filter((c) => c.serviceCode === track.serviceCode),
    [portCalls, track.serviceCode],
  );
  const visibleVesselNames = useMemo(() => new Set([track.name]), [track.name]);

  return (
    <RouteMap
      ports={ports}
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
    />
  );
}
