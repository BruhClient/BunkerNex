"use client";

import { useMemo } from "react";
import { CheckRow, TextInput } from "./FormControls";
import type { PortRegion } from "@/lib/filterLogic";
import { portRegion } from "@/lib/filterLogic";
import type { Port } from "@/lib/types";

const REGIONS: PortRegion[] = ["Asia", "Europe", "Middle East", "Other"];

interface Props {
  ports: Port[];
  portRegions: Set<PortRegion>;
  onToggleRegion: (region: PortRegion) => void;
  portQuery: string;
  onPortQueryChange: (query: string) => void;
}

/** "Ports" section: region multi-select + a name/code search. */
export default function PortFilters({
  ports,
  portRegions,
  onToggleRegion,
  portQuery,
  onPortQueryChange,
}: Props) {
  const pq = portQuery.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!pq) return [];
    return ports
      .filter(
        (p) =>
          p.name.toLowerCase().includes(pq) || p.key.toLowerCase().includes(pq),
      )
      .slice(0, 25);
  }, [pq, ports]);

  return (
    <div className="border-b border-line">
      <div className="px-4 py-2.5">
        <span className="label">Ports</span>
      </div>

      <div className="pb-1">
        {REGIONS.map((region) => (
          <CheckRow
            key={region}
            checked={portRegions.has(region)}
            onChange={() => onToggleRegion(region)}
            label={region}
          />
        ))}
      </div>

      <div className="border-t border-line/60 px-4 py-2.5">
        <TextInput
          value={portQuery || null}
          onChange={(v) => onPortQueryChange(v ?? "")}
          placeholder='Search ports, e.g. "Singapore"'
        />
      </div>
      {matches.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-t border-line/60">
          {matches.map((port) => (
            <button
              key={port.key}
              type="button"
              onClick={() => onPortQueryChange(port.name)}
              className="flex w-full items-baseline justify-between gap-2 px-4 py-1.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="truncate text-[11px] text-fg">
                {port.name}
              </span>
              <span className="tnum shrink-0 text-[10px] text-faint">
                {port.key} · {portRegion(port)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
