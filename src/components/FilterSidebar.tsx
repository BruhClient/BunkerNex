"use client";

import type { ReactNode } from "react";
import ActiveFilterPills from "./ActiveFilterPills";
import FuelFilters from "./FuelFilters";
import PortFilters from "./PortFilters";
import VesselFilters from "./VesselFilters";
import type { PortRegion } from "@/lib/filterLogic";
import type {
  Port,
  Service,
  VesselGrade,
  VesselSpec,
  VesselTrack,
} from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggleService: (code: string) => void;
  onSetAll: (on: boolean) => void;
  onSetRegion: (tradeRegion: string | null) => void;
  onSelectService: (code: string) => void;
  onHoverService: (code: string | null) => void;
  trackedVessels: Map<string, number>;
  vesselTracks: VesselTrack[];
  vesselSpecs: VesselSpec[];
  vesselQuery: string;
  onVesselQueryChange: (query: string) => void;

  ports: Port[];
  portRegions: Set<PortRegion>;
  onTogglePortRegion: (region: PortRegion) => void;
  portQuery: string;
  onPortQueryChange: (query: string) => void;

  fuelGrades: Set<VesselGrade>;
  onToggleFuel: (grade: VesselGrade) => void;

  onReset: () => void;
  open: boolean;
  onClose: () => void;
}

/**
 * Left "FILTERS" panel: replaces the old ServiceSidebar with a hierarchical,
 * multi-select filter over vessels (service/region/name), ports
 * (region/code) and fuel type, cross-filtering the map in real time via
 * Explorer.tsx's computeFilterResult. Same mobile-drawer contract
 * ServiceSidebar had (open/onClose), so Explorer mounts it the same way.
 */
export default function FilterSidebar({
  services,
  visibleServices,
  onToggleService,
  onSetAll,
  onSetRegion,
  onSelectService,
  onHoverService,
  trackedVessels,
  vesselTracks,
  vesselSpecs,
  vesselQuery,
  onVesselQueryChange,
  ports,
  portRegions,
  onTogglePortRegion,
  portQuery,
  onPortQueryChange,
  fuelGrades,
  onToggleFuel,
  onReset,
  open,
  onClose,
}: Props) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-[85%] max-w-[320px] flex-col border-r border-line bg-surface shadow-2xl transition-transform duration-200 ease-out md:static md:z-auto md:w-[300px] md:max-w-none md:translate-x-0 md:shadow-none ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="label">Filters</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters menu"
          className="-mr-1 flex size-8 items-center justify-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ActiveFilterPills
          services={services}
          visibleServices={visibleServices}
          onToggleService={onToggleService}
          portRegions={portRegions}
          onToggleRegion={onTogglePortRegion}
          portQuery={portQuery}
          onPortQueryChange={onPortQueryChange}
          vesselQuery={vesselQuery}
          onVesselQueryChange={onVesselQueryChange}
          fuelGrades={fuelGrades}
          onToggleFuel={onToggleFuel}
          onReset={onReset}
        />
        <VesselFilters
          services={services}
          visibleServices={visibleServices}
          onToggle={onToggleService}
          onSetAll={onSetAll}
          onSetRegion={onSetRegion}
          onSelectService={onSelectService}
          onHoverService={onHoverService}
          trackedVessels={trackedVessels}
          vesselTracks={vesselTracks}
          vesselSpecs={vesselSpecs}
          vesselQuery={vesselQuery}
          onVesselQueryChange={onVesselQueryChange}
        />
        <PortFilters
          ports={ports}
          portRegions={portRegions}
          onToggleRegion={onTogglePortRegion}
          portQuery={portQuery}
          onPortQueryChange={onPortQueryChange}
        />
        <FuelFilters fuelGrades={fuelGrades} onToggle={onToggleFuel} />
      </div>

      <div className="border-t border-line px-4 py-3">
        <span className="label">Map key</span>
        <dl className="mt-2 grid grid-cols-[18px_1fr] items-center gap-x-2.5 gap-y-1.5 text-[10px] text-faint">
          <LegendKey label="Route port">
            <span className="size-2.5 rounded-full bg-white ring-1 ring-fg/50" />
          </LegendKey>
          <LegendKey label="Bunker price port">
            <span className="size-2 rotate-45 border-2 border-muted" />
          </LegendKey>
          <LegendKey label="Route + price port">
            <span className="size-2.5 rounded-full bg-accent ring-2 ring-accent/60" />
          </LegendKey>
          <LegendKey label="Vessel, points to heading">
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M8 1 C9.7 3 11 4.7 11 6.3 L11 13 L5 13 L5 6.3 C5 4.7 6.3 3 8 1 Z"
                fill="var(--color-fg)"
              />
            </svg>
          </LegendKey>
          <LegendKey label="Direction — selected service">
            <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden>
              <path d="M0 4h18" stroke="var(--color-muted)" strokeWidth="1.5" />
              <path
                d="M7 1.5 L10 4 L7 6.5"
                fill="none"
                stroke="var(--color-fg)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </LegendKey>
        </dl>
        <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
          Schematic sea lanes between published calls — not navigable tracks.
        </p>
      </div>
    </aside>
  );
}

function LegendKey({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex h-3.5 items-center justify-center" aria-hidden>
        {children}
      </dt>
      <dd className="leading-snug">{label}</dd>
    </>
  );
}
