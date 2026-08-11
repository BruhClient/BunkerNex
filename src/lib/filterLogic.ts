import type { Port, VesselTrack } from "./types";

/**
 * Derived, not sourced — Port carries no region field. Covers every country
 * literal in PORT_COORDS (src/lib/ports.ts); anything missing falls back to
 * "Other" rather than silently dropping the port from every region filter.
 */
export type PortRegion = "Asia" | "Europe" | "Middle East" | "Other";

const COUNTRY_REGION: Record<string, PortRegion> = {
  Singapore: "Asia",
  Bangladesh: "Asia",
  India: "Asia",
  China: "Asia",
  "Hong Kong": "Asia",
  Vietnam: "Asia",
  Malaysia: "Asia",
  Myanmar: "Asia",
  "South Korea": "Asia",
  Thailand: "Asia",
  Indonesia: "Asia",
  Taiwan: "Asia",
  Japan: "Asia",
  "Sri Lanka": "Asia",

  Netherlands: "Europe",
  Belgium: "Europe",
  France: "Europe",
  "United Kingdom": "Europe",
  Spain: "Europe",
  Greece: "Europe",
  Malta: "Europe",
  Italy: "Europe",
  Russia: "Europe",
  Germany: "Europe",
  Turkiye: "Europe",

  "United Arab Emirates": "Middle East",
  Pakistan: "Middle East",
  Egypt: "Middle East",

  "United States": "Other",
  Panama: "Other",
  Chile: "Other",
  Brazil: "Other",
  Peru: "Other",
  "South Africa": "Other",
};

export function portRegion(port: Port): PortRegion {
  return COUNTRY_REGION[port.country] ?? "Other";
}

export interface FilterState {
  vesselQuery: string;
  portRegions: Set<PortRegion>;
  portQuery: string;
}

export interface FilterResult {
  /** null = no restriction beyond RouteMap's own service-visibility check. */
  visiblePortKeys: Set<string> | null;
  visibleVesselNames: Set<string> | null;
}

/**
 * Service-code visibility stays RouteMap's own existing axis (visibleServices)
 * — this only computes the two new ones (region/search), so a filter left at
 * its default never restricts anything (null, not an empty Set).
 */
export function computeFilterResult(
  state: FilterState,
  ports: Port[],
  vesselTracks: VesselTrack[],
): FilterResult {
  const { vesselQuery, portRegions, portQuery } = state;
  const vq = vesselQuery.trim().toLowerCase();
  const pq = portQuery.trim().toLowerCase();

  const visiblePortKeys =
    portRegions.size === 0 && pq === ""
      ? null
      : new Set(
          ports
            .filter((p) => {
              if (portRegions.size > 0 && !portRegions.has(portRegion(p))) {
                return false;
              }
              if (
                pq &&
                !p.name.toLowerCase().includes(pq) &&
                !p.key.toLowerCase().includes(pq)
              ) {
                return false;
              }
              return true;
            })
            .map((p) => p.key),
        );

  const visibleVesselNames =
    vq === ""
      ? null
      : new Set(
          vesselTracks
            .filter((t) => t.name.toLowerCase().includes(vq))
            .map((t) => t.name),
        );

  return { visiblePortKeys, visibleVesselNames };
}
