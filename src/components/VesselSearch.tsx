"use client";

import { useMemo } from "react";
import { TextInput } from "./FormControls";
import type { VesselSpec, VesselTrack } from "@/lib/types";

interface Props {
  vesselTracks: VesselTrack[];
  vesselSpecs: VesselSpec[];
  vesselQuery: string;
  onVesselQueryChange: (query: string) => void;
  /** Opens the vessel's detail sheet and pans the map toward it. */
  onSelectVessel: (name: string) => void;
}

/**
 * Vessel name search, pinned at the top of the filter sidebar rather than
 * under the route list it used to sit beneath — search is how you jump to a
 * ship, not a property of the route toggle list below it.
 *
 * Picking a suggestion navigates there and clears the query: the search's
 * job ends once it has opened the vessel's panel, same as PortFilters'.
 */
export default function VesselSearch({
  vesselTracks,
  vesselSpecs,
  vesselQuery,
  onVesselQueryChange,
  onSelectVessel,
}: Props) {
  const vq = vesselQuery.trim().toLowerCase();
  const vesselMatches = useMemo(() => {
    if (!vq) return [];
    return vesselTracks
      .filter((t) => t.name.toLowerCase().includes(vq))
      .slice(0, 25)
      .map((track) => ({
        track,
        spec: vesselSpecs.find((v) => v.name === track.name) ?? null,
      }));
  }, [vq, vesselTracks, vesselSpecs]);

  return (
    <div className="border-b border-line/60">
      <div className="px-4 py-2.5">
        <TextInput
          value={vesselQuery || null}
          onChange={(v) => onVesselQueryChange(v ?? "")}
          placeholder='Search vessels, e.g. "KOTA EAGLE"'
        />
      </div>
      {vesselMatches.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-t border-line/60">
          {vesselMatches.map(({ track, spec }) => (
            <button
              key={track.name}
              type="button"
              onClick={() => {
                onSelectVessel(track.name);
                onVesselQueryChange("");
              }}
              className="flex w-full items-baseline justify-between gap-2 px-4 py-1.5 text-left transition-colors hover:bg-surface-2"
            >
              <span className="truncate text-[11px] text-fg">
                {track.name}
              </span>
              <span className="tnum shrink-0 text-[10px] text-faint">
                {track.serviceCode}
                {spec?.nominalTeu ? ` · ${spec.nominalTeu} TEU` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
