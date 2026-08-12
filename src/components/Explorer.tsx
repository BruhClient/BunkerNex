"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import BunkerLog from "./BunkerLog";
import FilterSidebar from "./FilterSidebar";
import PortPanel from "./PortPanel";
import PriceForecastDrawer from "./PriceForecastDrawer";
import RouteMap from "./RouteMap";
import ServicePanel from "./ServicePanel";
import SpotBunkerPanel, {
  SPOT_PANEL_INLINE_MIN,
  SPOT_PANEL_WIDTH,
} from "./SpotBunkerPanel";
import TimeScrubber from "./TimeScrubber";
import VesselPanel from "./VesselPanel";
import { allBunkerEvents } from "@/lib/bunkerEvents";
import type { Co2eCostPoint, Co2eFactors } from "@/lib/emissions";
import { computeFilterResult } from "@/lib/filterLogic";
import { formatDate } from "@/lib/format";
import { stepTimestamp } from "@/lib/vesselPosition";
import type { BunkerPriceSnapshot } from "@/lib/bunkerEvents";
import type { SpotBunkerRequest } from "@/lib/spotBunker";
import type {
  Port,
  PortCall,
  Service,
  TransitTime,
  VesselSpec,
  VesselTrack,
} from "@/lib/types";

interface Props {
  services: Service[];
  portCalls: PortCall[];
  transitTimes: TransitTime[];
  ports: Port[];
  vesselSpecs: VesselSpec[];
  vesselTracks: VesselTrack[];
  /** Latest assessment per port and grade, for pricing a stem in the log. */
  bunkerPrices: BunkerPriceSnapshot;
  /** Tank-to-wake t CO2e per t fuel, for the vessel panel's carbon charts. */
  co2eFactors: Co2eFactors;
  /** Daily EUA price plus per-grade $/mt cost, same charts. */
  co2eCostSeries: Co2eCostPoint[];
  asOf: string | null;
  region: string;
}

export default function Explorer({
  services,
  portCalls,
  transitTimes,
  ports,
  vesselSpecs,
  vesselTracks,
  bunkerPrices,
  co2eFactors,
  co2eCostSeries,
  asOf,
  region,
}: Props) {
  const [visibleServices, setVisibleServices] = useState<string[]>(() =>
    services.map((s) => s.code),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedServiceCode, setSelectedServiceCode] = useState<
    string | null
  >(null);
  const [selectedVesselName, setSelectedVesselName] = useState<string | null>(
    null,
  );
  const [hoveredServiceCode, setHoveredServiceCode] = useState<string | null>(
    null,
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The spot bunker form is a sub-view of the selected vessel, sharing its
  // slot — and a mode: it holds the map on that vessel, unmounts the services
  // sidebar and freezes the clock. See `spotFocus` below.
  const [spotFormOpen, setSpotFormOpen] = useState(false);
  // Held here rather than in the panel so stepping back to the vessel detail
  // and returning does not throw away everything the engineer typed.
  const [spotDraft, setSpotDraft] = useState<SpotBunkerRequest | null>(null);
  // Collapsed by default: the map is the point, and a shut drawer costs
  // nothing per playback tick since only its header renders.
  const [logOpen, setLogOpen] = useState(false);
  // Open by default, unlike the log — this is the thing to check before
  // the log is even worth opening.
  const [forecastOpen, setForecastOpen] = useState(true);

  // Filter sidebar state, beyond visibleServices above. Region/service stay
  // one axis (visibleServices) — these two are the genuinely new ones:
  // vessel/port name search, computed together into a cross-filter result by
  // computeFilterResult below.
  const [vesselQuery, setVesselQuery] = useState("");
  const [portQuery, setPortQuery] = useState("");

  const portsByKey = useMemo(
    () => new Map(ports.map((p) => [p.key, p])),
    [ports],
  );

  /**
   * Vessels the movement series actually follows, per service. Not the same as
   * the fleet a service runs — four of the eleven have no tracked vessel at
   * all, and CAS's own blurb claims four — so anything showing this must say
   * "tracked" rather than implying a fleet size.
   */
  const trackedVessels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of vesselTracks) {
      counts.set(track.serviceCode, (counts.get(track.serviceCode) ?? 0) + 1);
    }
    return counts;
  }, [vesselTracks]);
  const selectedPort = selectedKey
    ? (portsByKey.get(selectedKey) ?? null)
    : null;
  const selectedService = selectedServiceCode
    ? (services.find((s) => s.code === selectedServiceCode) ?? null)
    : null;

  const selectedVesselSpec = selectedVesselName
    ? (vesselSpecs.find((v) => v.name === selectedVesselName) ?? null)
    : null;
  const selectedVesselTrack = selectedVesselName
    ? (vesselTracks.find((t) => t.name === selectedVesselName) ?? null)
    : null;

  /**
   * Focus mode, guarded. Four components branch on this, and a flag left set
   * with no resolvable vessel behind it would ask the map to hold a camera on
   * `null` and blank the sidebar for nothing.
   */
  const spotFocus =
    spotFormOpen && selectedVesselSpec !== null && selectedVesselTrack !== null;

  /**
   * The one service the map brings forward. A selection holds; a hover is
   * transient and only applies while nothing is selected, so moving the mouse
   * across the sidebar cannot pull focus off the service you just opened.
   *
   * Focus mode sits between the two: it brings the vessel's own service
   * forward, which is what pushes the other ten back while the camera is in
   * close, but a hover would have nothing to act on with the sidebar unmounted.
   */
  const focusedService =
    selectedServiceCode ??
    (spotFocus ? (selectedVesselTrack?.serviceCode ?? null) : null) ??
    hoveredServiceCode;

  /**
   * What the map draws. Focus mode narrows to the one service — which takes the
   * other ten route lines and their vessels with it, since `visibleServices`
   * already drives lines, fan offsets, port dimming and label opacity alike.
   *
   * Derived rather than assigned into state, so the sidebar toggles the user
   * set are handed back exactly as they were on exit.
   */
  const mapServices = useMemo(
    () =>
      spotFocus && selectedVesselTrack
        ? [selectedVesselTrack.serviceCode]
        : visibleServices,
    [spotFocus, selectedVesselTrack, visibleServices],
  );

  /**
   * Whether the requirement panel sits *over* the map rather than beside it.
   * Only then does the camera need biasing away from it.
   *
   * The lower bound is not decoration: under 768px the panel covers the map
   * outright, so there is no visible strip to centre a vessel in and the bias
   * would push it off screen instead.
   */
  const [panelOverlaysMap, setPanelOverlaysMap] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(
      `(min-width: 768px) and (max-width: ${SPOT_PANEL_INLINE_MIN - 1}px)`,
    );
    const sync = () => setPanelOverlaysMap(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Every track shares one time grid, so the scrubber's range and label can
  // come from any of them.
  const clock = vesselTracks[0] ?? null;
  const stepCount = clock?.portCodes.length ?? 0;

  // Every stem in the window, built once. The log filters and sorts it; the
  // scrubber only needs the distinct steps to tick.
  const bunkerEvents = useMemo(
    () => allBunkerEvents(vesselTracks, bunkerPrices),
    [vesselTracks, bunkerPrices],
  );

  const stemSteps = useMemo(
    () => [
      ...new Set(
        bunkerEvents
          .filter((e) => visibleServices.includes(e.serviceCode))
          .map((e) => e.step),
      ),
    ],
    [bunkerEvents, visibleServices],
  );

  const toggleService = useCallback((code: string) => {
    setVisibleServices((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }, []);

  const setAll = useCallback(
    (on: boolean) => setVisibleServices(on ? services.map((s) => s.code) : []),
    [services],
  );

  // The Region bulk-select buttons write into the same visibleServices set
  // the Service Route checkboxes do — one filter axis, two ways to set it.
  const setServicesByRegion = useCallback(
    (tradeRegion: string | null) => {
      setVisibleServices(
        tradeRegion === null
          ? services.map((s) => s.code)
          : services
              .filter((s) => s.tradeRegion === tradeRegion)
              .map((s) => s.code),
      );
    },
    [services],
  );

  const resetFilters = useCallback(() => {
    setAll(true);
    setVesselQuery("");
    setPortQuery("");
  }, [setAll]);

  const filterResult = useMemo(
    () =>
      computeFilterResult({ vesselQuery, portQuery }, ports, vesselTracks),
    [vesselQuery, portQuery, ports, vesselTracks],
  );

  const selectPort = useCallback((key: string | null) => {
    setSelectedKey(key);
    // The port, service and vessel detail panels share one slot — picking a
    // port closes whichever of the others is open.
    if (key) {
      setSelectedServiceCode(null);
      setSelectedVesselName(null);
      setSpotFormOpen(false);
      // A narrow screen only has room for one overlay at a time.
      setSidebarOpen(false);
    }
  }, []);

  const selectService = useCallback((code: string) => {
    setSelectedServiceCode(code);
    setSelectedKey(null);
    setSelectedVesselName(null);
    setSpotFormOpen(false);
    // Viewing a service's detail panel is independent of the sidebar's
    // on/off toggles, but on a narrow screen they still compete for space.
    setSidebarOpen(false);
  }, []);

  const selectVessel = useCallback((name: string | null) => {
    // Covers both the panel's own close (X) button and a map click on a
    // different vessel while focus mode is active — both route through
    // this one function, so the guard only needs to live here once.
    setSelectedVesselName(name);
    // A draft belongs to the vessel it was started on. Clearing it here is
    // what stops a stale draft reopening one engineer's requirement over
    // somebody else's ship.
    setSpotFormOpen(false);
    setSpotDraft(null);
    if (name) {
      setSelectedKey(null);
      setSelectedServiceCode(null);
      setSidebarOpen(false);
    }
  }, []);

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
    setSelectedKey(null);
    setSpotFormOpen(false);
  }, []);

  const enterSpotMode = useCallback(() => {
    setSpotFormOpen(true);
    // The drawer must not survive into a mode where the sidebar is unmounted.
    setSidebarOpen(false);
  }, []);

  // Leaves `spotDraft` alone on purpose: selectVessel remains the only thing
  // that discards typed input, so stepping out and back keeps the requirement.
  // This is the back arrow, the map chip, and (via SpotBunkerPanel's own
  // listener) Escape.
  const exitSpotMode = useCallback(() => {
    setSpotFormOpen(false);
  }, []);

  const router = useRouter();

  /**
   * Submitting the CE nomination no longer runs a single-port supplier
   * match — it hands the fixed grade/quantity off to the route-wide
   * bunkering optimizer (/route-plan), preselected to this vessel and
   * position, so the engineer lands straight on the ranked combinations
   * for the calls ahead rather than a one-port supplier list.
   */
  const goToRoutePlan = useCallback(
    (req: SpotBunkerRequest) => {
      if (!selectedVesselSpec) return;
      const params = new URLSearchParams({
        vessel: selectedVesselSpec.name,
        step: String(stepIndex),
      });
      if (req.grade) params.set("grade", req.grade);
      if (req.nominationMt !== null) params.set("qty", String(req.nominationMt));
      router.push(`/route-plan?${params.toString()}`);
    },
    [selectedVesselSpec, stepIndex, router],
  );

  /**
   * One gate for every seek in the app — the scrubber, the bunker log's rows
   * and the vessel panel all route through this rather than `setStepIndex`.
   *
   * Focus mode pins the requirement to one moment. `deriveSpotContext` re-reads
   * the arrival port, ROB and ECA status from `stepIndex` on every change while
   * the typed draft stays put, so a seek would silently re-base the form under
   * whoever was filling it in. Gated on the raw flag rather than `spotFocus`:
   * if the flag is ever set without a resolvable vessel, holding is still the
   * safe behaviour.
   */
  const seek = useCallback(
    (step: number) => {
      if (spotFormOpen) return;
      setStepIndex(step);
    },
    [spotFormOpen],
  );

  // Esc closes the mobile services drawer, mirroring PortPanel's Esc handling.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <div className="flex items-baseline gap-3">
          {/* Hidden in focus mode: the drawer it opens is unmounted there, so
              the control would toggle a component that does not exist. */}
          {!spotFocus && (
            <button
              type="button"
              onClick={() =>
                sidebarOpen ? setSidebarOpen(false) : openSidebar()
              }
              aria-label={
                sidebarOpen ? "Close services menu" : "Open services menu"
              }
              aria-expanded={sidebarOpen}
              className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path
                  d="M2 5h14M2 9h14M2 13h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          <span className="text-[15px] font-semibold tracking-tight text-fg">
            Bunker<span className="text-accent">Nex</span>
          </span>
          <span className="hidden text-xs text-muted sm:inline">{region}</span>
          {/* The only entry point to the HQ desk's supplier comparison — that
              page has no other link back to itself from the running app.
              Hidden in focus mode alongside the sidebar toggle: navigating
              away mid-form would drop the in-progress spot bunker draft,
              which Explorer holds only in memory. */}
          {!spotFocus && (
            <>
              <Link
                href="/hq"
                className="hidden items-center rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-fg sm:inline-flex"
              >
                Supplier HQ
              </Link>
              <Link
                href="/route-plan"
                className="hidden items-center rounded border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-line-strong hover:text-fg sm:inline-flex"
              >
                Route Plan
              </Link>
            </>
          )}
        </div>
        {/* The map key lives in the sidebar footer, where there is room to
            explain route lines and vessels rather than only port markers. */}
        <div className="text-right">
          <div className="label leading-none">Prices as of</div>
          <div className="tnum mt-0.5 text-xs text-fg">{formatDate(asOf)}</div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && !spotFocus && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            aria-hidden
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Unmounted rather than collapsed in focus mode. Every piece of state
            it renders lives here, so it costs nothing to rebuild, and <main>
            is flex-1 so the map takes the 300px back on its own. */}
        {!spotFocus && (
          <FilterSidebar
            services={services}
            visibleServices={visibleServices}
            onToggleService={toggleService}
            onSetAll={setAll}
            onSetRegion={setServicesByRegion}
            onSelectService={selectService}
            onHoverService={setHoveredServiceCode}
            trackedVessels={trackedVessels}
            vesselTracks={vesselTracks}
            vesselSpecs={vesselSpecs}
            vesselQuery={vesselQuery}
            onVesselQueryChange={setVesselQuery}
            onSelectVessel={selectVessel}
            ports={ports}
            portQuery={portQuery}
            onPortQueryChange={setPortQuery}
            onSelectPort={selectPort}
            onReset={resetFilters}
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />
        )}

        <main className="relative min-w-0 flex-1">
          <RouteMap
            ports={ports}
            portCalls={portCalls}
            vesselTracks={vesselTracks}
            visibleServices={mapServices}
            visiblePortKeys={filterResult.visiblePortKeys}
            visibleVesselNames={filterResult.visibleVesselNames}
            selectedKey={selectedKey}
            focusedService={focusedService}
            stepIndex={stepIndex}
            selectedVesselName={selectedVesselName}
            focusVesselName={spotFocus ? selectedVesselName : null}
            focusOffsetX={
              spotFocus && panelOverlaysMap ? -SPOT_PANEL_WIDTH / 2 : 0
            }
            onSelectPort={selectPort}
            onSelectVessel={selectVessel}
          />

          {/* The way out of the mode. Top-left, clear of MapLibre's navigation
              control; the red matches the button that opened it.

              It also carries the timestamp, which is not decoration: focus mode
              unmounts the scrubber, and this becomes the only place on screen
              naming the moment the requirement is pinned to. */}
          {spotFocus && selectedVesselSpec && clock && (
            <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded border border-down/40 bg-bg/90 px-2.5 py-1.5 shadow-lg backdrop-blur">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-down"
                />
                <span className="flex-1 text-[11px] font-semibold text-fg">
                  Spot bunkering
                </span>
                <button
                  type="button"
                  onClick={exitSpotMode}
                  className="-mr-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  Exit
                </button>
              </div>
              <p className="tnum mt-0.5 truncate pl-3.5 text-[10px] text-faint">
                {selectedVesselSpec.name} · positions held{" "}
                {stepTimestamp(clock, stepIndex)}
              </p>
            </div>
          )}

          {/* Log and scrubber share one bottom-anchored column so the drawer
              pushes the scrubber down by its own height — nothing has to know
              how tall the other is. Both go in focus mode: the fleet's other
              stems are not what the requirement is about, and the clock is
              held, so a live-looking scrubber would only invite a seek. */}
          {clock && stepCount > 0 && !spotFocus && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col">
              <PriceForecastDrawer
                ports={ports}
                open={forecastOpen}
                onToggle={() => setForecastOpen((o) => !o)}
              />
              <BunkerLog
                events={bunkerEvents}
                visibleServices={visibleServices}
                stepIndex={stepIndex}
                asOf={asOf}
                open={logOpen}
                onToggle={() => setLogOpen((o) => !o)}
                onSeek={seek}
                onSelectVessel={selectVessel}
              />
              <div className="pointer-events-auto">
                <TimeScrubber
                  stepCount={stepCount}
                  stepIndex={stepIndex}
                  label={stepTimestamp(clock, stepIndex)}
                  markSteps={stemSteps}
                  onChange={seek}
                />
              </div>
            </div>
          )}
        </main>

        {selectedVesselSpec ? (
          // The requirement form is a sub-view of the vessel, so it takes the
          // same slot rather than stacking a second overlay over it.
          spotFormOpen ? (
            <SpotBunkerPanel
              spec={selectedVesselSpec}
              track={selectedVesselTrack}
              stepIndex={stepIndex}
              draft={spotDraft}
              onChange={setSpotDraft}
              onSubmit={goToRoutePlan}
              onBack={exitSpotMode}
              onClose={() => selectVessel(null)}
            />
          ) : (
            <VesselPanel
              spec={selectedVesselSpec}
              track={selectedVesselTrack}
              service={
                services.find(
                  (s) => s.code === selectedVesselTrack?.serviceCode,
                ) ?? null
              }
              portCalls={portCalls}
              stepIndex={stepIndex}
              events={bunkerEvents}
              co2eFactors={co2eFactors}
              co2eCostSeries={co2eCostSeries}
              onSeek={seek}
              onEvaluateSpot={enterSpotMode}
              onClose={() => selectVessel(null)}
            />
          )
        ) : selectedPort ? (
          <PortPanel
            port={selectedPort}
            portCalls={portCalls}
            bunkerEvents={bunkerEvents}
            stepIndex={stepIndex}
            onClose={() => setSelectedKey(null)}
          />
        ) : (
          <ServicePanel
            service={selectedService}
            portCalls={portCalls}
            transitTimes={transitTimes}
            onClose={() => setSelectedServiceCode(null)}
          />
        )}
      </div>
    </div>
  );
}
