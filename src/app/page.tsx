import Explorer from "@/components/Explorer";
import { latestDataDate } from "@/lib/prices";
import {
  buildPortIndex,
  loadPortCalls,
  loadServices,
  loadTransitTimes,
} from "@/lib/schedules";
import { loadVesselSpecs, loadVesselTracks } from "@/lib/vessels";

// CSVs are read from disk per request, so a data edit shows up on reload.
export const dynamic = "force-dynamic";

export default function Page() {
  const services = loadServices();
  const portCalls = loadPortCalls();
  const transitTimes = loadTransitTimes();
  const ports = buildPortIndex(portCalls);
  const asOf = latestDataDate();

  // Only 11 of the 109 vessels have a movement series, and only those can be
  // placed on the map — so ship the specs for those alone rather than the
  // whole register, which nothing downstream could reach.
  const allVesselSpecs = loadVesselSpecs();
  const vesselTracks = loadVesselTracks(allVesselSpecs);
  const tracked = new Set(vesselTracks.map((t) => t.name));
  const vesselSpecs = allVesselSpecs.filter((s) => tracked.has(s.name));

  // One sub-region reads better named ("Intra Asia · East Coast India"); with
  // several loaded at once, naming only the first service's would be wrong.
  const subRegions = [...new Set(services.map((s) => s.subRegion))];
  const region = services[0]
    ? subRegions.length === 1
      ? `${services[0].tradeRegion} · ${subRegions[0]}`
      : `${services[0].tradeRegion} · ${subRegions.length} sub-regions`
    : "";

  return (
    <Explorer
      services={services}
      portCalls={portCalls}
      transitTimes={transitTimes}
      ports={ports}
      vesselSpecs={vesselSpecs}
      vesselTracks={vesselTracks}
      asOf={asOf}
      region={region}
    />
  );
}
