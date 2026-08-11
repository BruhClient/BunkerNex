"use client";

import { useMemo, useState } from "react";
import { serviceColor } from "@/lib/colors";
import type { Service } from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggle: (code: string) => void;
  onSetAll: (on: boolean) => void;
  /** Bulk-selects visibleServices to every service in a trade region, or every service when null. */
  onSetRegion: (tradeRegion: string | null) => void;
  onSelectService: (code: string) => void;
  onHoverService: (code: string | null) => void;
  trackedVessels: Map<string, number>;
}

/**
 * "Vessels" section of the filter sidebar: the region bulk-select buttons and
 * per-service rows (absorbed from the old ServiceSidebar, unchanged markup),
 * grouped by Service.tradeRegion. The vessel name search that used to sit
 * beneath this list now lives at the top of the sidebar — see
 * VesselSearch.tsx.
 *
 * Region and Service Route are two ways of writing the same visibleServices
 * set, not independent filter axes — see filterLogic.ts's doc comment.
 *
 * Each row is a click-to-toggle button rather than a checkbox control — no
 * checkbox-style indicator box, the route code's own color/weight carries
 * the on/off state instead.
 */
export default function VesselFilters({
  services,
  visibleServices,
  onToggle,
  onSetAll,
  onSetRegion,
  onSelectService,
  onHoverService,
  trackedVessels,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const allOn = visibleServices.length === services.length;

  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const service of services) {
      const list = map.get(service.tradeRegion) ?? [];
      list.push(service);
      map.set(service.tradeRegion, list);
    }
    return map;
  }, [services]);

  return (
    <div className="border-b border-line">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="label">Vessels</span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onSetAll(true)}
            disabled={allOn}
            className="rounded px-1.5 py-0.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50"
          >
            All
          </button>
          <span className="text-line-strong">/</span>
          <button
            type="button"
            onClick={() => onSetAll(false)}
            disabled={visibleServices.length === 0}
            className="rounded px-1.5 py-0.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50"
          >
            None
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pb-2">
        <RegionButton label="All Regions" onClick={() => onSetRegion(null)} />
        {[...grouped.keys()].map((region) => (
          <RegionButton
            key={region}
            label={region}
            onClick={() => onSetRegion(region)}
          />
        ))}
      </div>

      {[...grouped.entries()].map(([region, list]) => {
        const isCollapsed = collapsed[region] ?? false;
        return (
          <div key={region} className="border-t border-line/60">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => ({ ...prev, [region]: !isCollapsed }))
              }
              className="flex w-full items-center justify-between px-4 py-2 text-left"
            >
              <span className="text-[11px] font-medium text-muted">
                {region} · {list.length}
              </span>
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                aria-hidden
                className={`text-faint transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              >
                <path
                  d="M1 1l5 3-5 3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {!isCollapsed &&
              list.map((service) => (
                <ServiceRow
                  key={service.code}
                  service={service}
                  on={visibleServices.includes(service.code)}
                  vessels={trackedVessels.get(service.code) ?? 0}
                  onToggle={() => onToggle(service.code)}
                  onSelect={() => onSelectService(service.code)}
                  onHover={onHoverService}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function RegionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-line-strong px-2 py-1 text-[10px] text-muted transition-colors hover:border-faint hover:text-fg"
    >
      {label}
    </button>
  );
}

/**
 * Lifted from the old ServiceSidebar's per-service row, minus the leading
 * checkbox-style swatch — the whole row is still the toggle button (onToggle
 * fires on click), just without a checkbox-look indicator drawing the on/off
 * state. The route code's own color does that instead.
 */
function ServiceRow({
  service,
  on,
  vessels,
  onToggle,
  onSelect,
  onHover,
}: {
  service: Service;
  on: boolean;
  vessels: number;
  onToggle: () => void;
  onSelect: () => void;
  onHover: (code: string | null) => void;
}) {
  const color = serviceColor(service.code);
  return (
    <div
      onMouseEnter={() => onHover(service.code)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(service.code)}
      onBlur={() => onHover(null)}
      className="group flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 transition-colors hover:bg-surface-2"
    >
      <button
        type="button"
        onClick={onToggle}
        className="min-w-0 flex-1 text-left"
        aria-pressed={on}
        aria-label={`${on ? "Hide" : "Show"} ${service.code} on map`}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className="tnum text-[13px] font-semibold tracking-wide transition-colors"
              style={{ color: on ? color : "var(--color-faint)" }}
            >
              {service.code}
            </span>
            <span
              className={`flex shrink-0 items-center gap-0.5 transition-colors ${
                !on
                  ? "text-faint/50"
                  : vessels > 0
                    ? "text-muted"
                    : "text-faint/60"
              }`}
              title={
                vessels === 0
                  ? `No vessels tracked on ${service.code}`
                  : `${vessels} vessel${vessels === 1 ? "" : "s"} tracked on ${service.code}`
              }
            >
              <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden>
                <path
                  d="M8 1 C9.7 3 11 4.7 11 6.3 L11 13 L5 13 L5 6.3 C5 4.7 6.3 3 8 1 Z"
                  fill="currentColor"
                />
              </svg>
              <span className="tnum text-[10px] leading-none">
                {vessels}
              </span>
            </span>
          </span>
          <span className="tnum shrink-0 text-[10px] text-faint">
            {service.uniquePortCount} ports · {service.frequency}
          </span>
        </span>
        <span
          className={`mt-0.5 block truncate text-xs ${on ? "text-fg" : "text-faint"}`}
          title={service.name}
        >
          {service.name}
        </span>
        {on && service.keyFeatures.length > 0 && (
          <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">
            {service.keyFeatures[0]}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`View ${service.code} route details`}
        className="-m-1.5 mt-[1.5px] shrink-0 rounded p-1.5 text-faint transition-colors hover:bg-surface hover:text-fg"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path
            d="M5 2l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
