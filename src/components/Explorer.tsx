"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortPanel from "./PortPanel";
import RouteMap from "./RouteMap";
import ServicePanel from "./ServicePanel";
import ServiceSidebar from "./ServiceSidebar";
import TimeScrubber from "./TimeScrubber";
import VesselPanel from "./VesselPanel";
import { formatDate } from "@/lib/format";
import { stepTimestamp } from "@/lib/vesselPosition";
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
  const [stepIndex, setStepIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const portsByKey = useMemo(
    () => new Map(ports.map((p) => [p.key, p])),
    [ports],
  );
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

  // Every track shares one time grid, so the scrubber's range and label can
  // come from any of them.
  const clock = vesselTracks[0] ?? null;
  const stepCount = clock?.portCodes.length ?? 0;

  const toggleService = useCallback((code: string) => {
    setVisibleServices((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }, []);

  const setAll = useCallback(
    (on: boolean) => setVisibleServices(on ? services.map((s) => s.code) : []),
    [services],
  );

  const selectPort = useCallback((key: string | null) => {
    setSelectedKey(key);
    // The port, service and vessel detail panels share one slot — picking a
    // port closes whichever of the others is open.
    if (key) {
      setSelectedServiceCode(null);
      setSelectedVesselName(null);
      // A narrow screen only has room for one overlay at a time.
      setSidebarOpen(false);
    }
  }, []);

  const selectService = useCallback((code: string) => {
    setSelectedServiceCode(code);
    setSelectedKey(null);
    setSelectedVesselName(null);
    // Viewing a service's detail panel is independent of the sidebar's
    // on/off toggles, but on a narrow screen they still compete for space.
    setSidebarOpen(false);
  }, []);

  const selectVessel = useCallback((name: string | null) => {
    setSelectedVesselName(name);
    if (name) {
      setSelectedKey(null);
      setSelectedServiceCode(null);
      setSidebarOpen(false);
    }
  }, []);

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
    setSelectedKey(null);
  }, []);

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
          <button
            type="button"
            onClick={() => (sidebarOpen ? setSidebarOpen(false) : openSidebar())}
            aria-label={sidebarOpen ? "Close services menu" : "Open services menu"}
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
          <span className="text-[15px] font-semibold tracking-tight text-fg">
            Bunker<span className="text-accent">Nex</span>
          </span>
          <span className="hidden text-xs text-muted sm:inline">{region}</span>
        </div>
        <div className="flex items-center gap-5">
          {/* Mirrors the three marker styles in globals.css. */}
          <div className="hidden items-center gap-4 text-[11px] text-faint md:flex">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-white ring-1 ring-fg/50" />
              Route port
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rotate-45 border-2 border-[#9AA6B8]" />
              Bunker price port
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-accent ring-2 ring-accent/60" />
              Both
            </span>
          </div>
          <div className="text-right">
            <div className="label leading-none">Prices as of</div>
            <div className="tnum mt-0.5 text-xs text-fg">{formatDate(asOf)}</div>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            aria-hidden
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <ServiceSidebar
          services={services}
          visibleServices={visibleServices}
          onToggle={toggleService}
          onSetAll={setAll}
          onSelectService={selectService}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className="relative min-w-0 flex-1">
          <RouteMap
            ports={ports}
            portCalls={portCalls}
            vesselTracks={vesselTracks}
            visibleServices={visibleServices}
            selectedKey={selectedKey}
            stepIndex={stepIndex}
            selectedVesselName={selectedVesselName}
            onSelectPort={selectPort}
            onSelectVessel={selectVessel}
          />
          {clock && stepCount > 0 && (
            <TimeScrubber
              stepCount={stepCount}
              stepIndex={stepIndex}
              label={stepTimestamp(clock, stepIndex)}
              onChange={setStepIndex}
            />
          )}
        </main>

        {selectedVesselSpec ? (
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
            onClose={() => setSelectedVesselName(null)}
          />
        ) : selectedPort ? (
          <PortPanel
            port={selectedPort}
            portCalls={portCalls}
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
