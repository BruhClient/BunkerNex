import RoutePlanDesk from "@/components/routeplan/RoutePlanDesk";
import { latestDataDate } from "@/lib/prices";
import { buildPortIndex, loadPortCalls } from "@/lib/schedules";
import { loadVesselSpecs, loadVesselTracks } from "@/lib/vessels";

// Same rule as the map page and /hq: CSVs are read from disk per request.
export const dynamic = "force-dynamic";

/**
 * The route-wide bunkering optimizer.
 *
 * A separate route for the same reason /hq is one (see hq/page.tsx): this is
 * a vessel picker plus a map plus several charts plus three ranked
 * combination cards, unreadable squeezed into Explorer's 420px panel, and
 * Explorer's own state machine is already dense enough without a fifth mode
 * for an unrelated workflow.
 *
 * Loads the same vessel/port data src/app/page.tsx does and passes it down —
 * this route needs its own copy since it is not nested under Explorer.
 */
export default function RoutePlanPage() {
  const portCalls = loadPortCalls();
  const ports = buildPortIndex(portCalls);

  const allVesselSpecs = loadVesselSpecs();
  const vesselTracks = loadVesselTracks(allVesselSpecs);
  const tracked = new Set(vesselTracks.map((t) => t.name));
  const vesselSpecs = allVesselSpecs.filter((s) => tracked.has(s.name));

  const asOf = latestDataDate();

  return (
    <RoutePlanDesk
      vesselSpecs={vesselSpecs}
      vesselTracks={vesselTracks}
      ports={ports}
      portCalls={portCalls}
      asOf={asOf}
    />
  );
}
