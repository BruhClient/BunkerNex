"use client";

import { useMemo } from "react";
import { TextInput } from "./FormControls";
import { portRegion } from "@/lib/filterLogic";
import type { Port } from "@/lib/types";

interface Props {
  ports: Port[];
  portQuery: string;
  onPortQueryChange: (query: string) => void;
  /** Opens the port's detail sheet and pans the map toward it. */
  onSelectPort: (key: string) => void;
}

/**
 * Port name/code search, pinned at the top of the filter sidebar alongside
 * VesselSearch. Picking a suggestion navigates there and clears the query —
 * the search's job ends once it has opened the port's panel.
 */
export default function PortFilters({
  ports,
  portQuery,
  onPortQueryChange,
  onSelectPort,
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
              onClick={() => {
                onSelectPort(port.key);
                onPortQueryChange("");
              }}
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
