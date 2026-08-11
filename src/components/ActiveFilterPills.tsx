"use client";

import type { PortRegion } from "@/lib/filterLogic";
import type { Service } from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggleService: (code: string) => void;
  portRegions: Set<PortRegion>;
  onToggleRegion: (region: PortRegion) => void;
  portQuery: string;
  onPortQueryChange: (query: string) => void;
  vesselQuery: string;
  onVesselQueryChange: (query: string) => void;
  onReset: () => void;
}

/**
 * Removable chips for every non-default filter value, plus a reset. Service
 * chips only appear when the selection is partial — "all visible" is the
 * default state and isn't a filter worth naming.
 */
export default function ActiveFilterPills({
  services,
  visibleServices,
  onToggleService,
  portRegions,
  onToggleRegion,
  portQuery,
  onPortQueryChange,
  vesselQuery,
  onVesselQueryChange,
  onReset,
}: Props) {
  const partialServices =
    visibleServices.length > 0 && visibleServices.length < services.length
      ? visibleServices
      : [];

  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...partialServices.map((code) => ({
      key: `service:${code}`,
      label: `Service: ${code}`,
      onRemove: () => onToggleService(code),
    })),
    ...[...portRegions].map((region) => ({
      key: `region:${region}`,
      label: `Port region: ${region}`,
      onRemove: () => onToggleRegion(region),
    })),
    ...(portQuery
      ? [
          {
            key: "portQuery",
            label: `Port: ${portQuery}`,
            onRemove: () => onPortQueryChange(""),
          },
        ]
      : []),
    ...(vesselQuery
      ? [
          {
            key: "vesselQuery",
            label: `Vessel: ${vesselQuery}`,
            onRemove: () => onVesselQueryChange(""),
          },
        ]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <div className="border-b border-line px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="label">Active filters ({chips.length})</span>
        <button
          type="button"
          onClick={onReset}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-fg"
        >
          Reset
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onRemove}
            className="flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-faint hover:text-fg"
          >
            {chip.label}
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>
    </div>
  );
}
