import Explorer from "@/components/Explorer";
import { bunkerPriceSnapshot, latestDataDate } from "@/lib/prices";
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
  // A few dozen numbers, so the arrival toasts can price a stem from props
  // rather than fetching per event.
  const bunkerPrices = bunkerPriceSnapshot();

  // Only 11 of the 109 vessels have a movement series, and only those can be
  // placed on the map — so ship the specs for those alone rather than the
  // whole register, which nothing downstream could reach.
  const allVesselSpecs = loadVesselSpecs();
  const vesselTracks = loadVesselTracks(allVesselSpecs);
  const tracked = new Set(vesselTracks.map((t) => t.name));
  const vesselSpecs = allVesselSpecs.filter((s) => tracked.has(s.name));

  // One sub-region reads better named ("Intra Asia · East Coast India"); with
  // several loaded at once, naming only the first service's would be wrong.
  // Same reasoning applies one level up now that a second Trade_Region
  // ("Asia-Europe") exists alongside "Intra Asia" — services[0] is no longer
  // representative of the whole dataset.
  const tradeRegions = [...new Set(services.map((s) => s.tradeRegion))];
  const subRegions = [...new Set(services.map((s) => s.subRegion))];
  const region = services[0]
    ? tradeRegions.length === 1
      ? subRegions.length === 1
        ? `${tradeRegions[0]} · ${subRegions[0]}`
        : `${tradeRegions[0]} · ${subRegions.length} sub-regions`
      : `${tradeRegions.length} trade regions · ${subRegions.length} sub-regions`
    : "";

  return (
    <Explorer
      services={services}
      portCalls={portCalls}
      transitTimes={transitTimes}
      ports={ports}
      vesselSpecs={vesselSpecs}
      vesselTracks={vesselTracks}
      bunkerPrices={bunkerPrices}
      asOf={asOf}
      region={region}
    />
  );
}
