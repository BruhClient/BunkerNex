import RoutePlanDesk from "@/components/routeplan/RoutePlanDesk";
import { latestDataDate } from "@/lib/prices";
import { buildPortIndex, loadPortCalls } from "@/lib/schedules";
import type { SpotFuelGrade } from "@/lib/spotBunker";
import { loadVesselSpecs, loadVesselTracks } from "@/lib/vessels";

// Same rule as the map page and /hq: CSVs are read from disk per request.
export const dynamic = "force-dynamic";

const SPOT_FUEL_GRADES: ReadonlySet<string> = new Set<SpotFuelGrade>([
  "HSFO",
  "VLSFO",
  "MGO",
]);

function parseGrade(raw: string | undefined): SpotFuelGrade | null {
  return raw !== undefined && SPOT_FUEL_GRADES.has(raw)
    ? (raw as SpotFuelGrade)
    : null;
}

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
 *
 * `searchParams` carries the handoff from SpotBunkerPanel's submit
 * (Explorer.goToRoutePlan): vessel, position and the CE's fixed grade/qty
 * nomination, so submitting that form lands here already scoped to the
 * right ship instead of on a generic first-vessel default.
 */
export default async function RoutePlanPage({
  searchParams,
}: {
  searchParams: Promise<{
    vessel?: string;
    step?: string;
    grade?: string;
    qty?: string;
  }>;
}) {
  const params = await searchParams;

  const portCalls = loadPortCalls();
  const ports = buildPortIndex(portCalls);

  const allVesselSpecs = loadVesselSpecs();
  const vesselTracks = loadVesselTracks(allVesselSpecs);
  const tracked = new Set(vesselTracks.map((t) => t.name));
  const vesselSpecs = allVesselSpecs.filter((s) => tracked.has(s.name));

  const asOf = latestDataDate();

  const step = params.step === undefined ? NaN : Number(params.step);
  const qty = params.qty === undefined ? NaN : Number(params.qty);

  return (
    <RoutePlanDesk
      vesselSpecs={vesselSpecs}
      vesselTracks={vesselTracks}
      ports={ports}
      portCalls={portCalls}
      asOf={asOf}
      initialVesselName={params.vessel ?? null}
      initialStepIndex={Number.isFinite(step) ? step : null}
      initialGrade={parseGrade(params.grade)}
      initialQtyMt={Number.isFinite(qty) ? qty : null}
    />
  );
}
