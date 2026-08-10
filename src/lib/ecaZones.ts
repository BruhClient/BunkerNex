import type { LonLat } from "./geo";

/**
 * Hand-authored ECA/DECA boundary polygons for the map's shaded overlay.
 *
 * There is no coastline or geo-boundary data anywhere in this repo (no turf,
 * no shapefile) — same trade-off PORT_COORDS and searoutes.ts already make.
 * These rings are simplified schematic sea-area outlines, not surveyed
 * regulatory boundaries; light overlap onto land is expected and harmless,
 * the same tolerance the schematic route arcs already carry.
 *
 * This overlay is informational only. `rings` supports multi-part zones
 * (South Korea's two localized port-area zones); everything else is one ring.
 */
export interface EcaZone {
  id: string;
  name: string;
  rings: LonLat[][];
}

export const ECA_ZONES: EcaZone[] = [
  {
    id: "north-sea-channel",
    name: "North Sea & English Channel ECA",
    // A generous envelope around NLRTM/DEHAM/FRLEH/GBSOU/GBFXT/BEANR — several
    // of those sit up an estuary well inland of the open coastline, so this is
    // padded well past their PORT_COORDS points rather than hugging the coast.
    rings: [
      [
        [-5.5, 48.2],
        [-5.5, 51.5],
        [-3.6, 55.7],
        [4.25, 59.0],
        [12.1, 55.7],
        [12.5, 51.5],
        [12.1, 47.3],
        [4.25, 47.0],
        [-5.5, 48.2],
      ],
    ],
  },
  {
    id: "mediterranean-sox",
    name: "Mediterranean SOx ECA",
    // Covers EGPSD/GRPIR/MTMLA/ESALG/ESVLC with margin to spare.
    rings: [
      [
        [-6.5, 35.2],
        [-6.5, 37.2],
        [-1.5, 40.3],
        [4.0, 44.0],
        [9.5, 44.5],
        [15.0, 45.0],
        [19.5, 41.5],
        [24.0, 41.0],
        [29.0, 37.5],
        [34.8, 33.8],
        [34.3, 30.0],
        [31.0, 30.5],
        [27.0, 32.2],
        [24.0, 32.7],
        [19.0, 31.7],
        [14.0, 32.2],
        [9.0, 32.7],
        [3.0, 34.7],
        [-2.5, 34.7],
        [-6.5, 35.2],
      ],
    ],
  },
  {
    id: "china-deca",
    name: "China Coastal DECA (12nm)",
    // A ~0.9 deg buffer ribbon around the actual ECA_PORTS anchors (Tianjin
    // through Qinzhou, north to south), not a hand-traced coastline: computed
    // once by offsetting each port point perpendicular to its local coastal
    // heading, which is the only way to guarantee every port in ECA_PORTS
    // (src/lib/eca.ts) actually falls inside the shaded ribbon rather than
    // landing just outside a hand-guessed coastal line.
    rings: [
      [
        [118.429, 39.559],
        [120.99, 36.48],
        [122.532, 31.529],
        [122.72, 29.694],
        [118.678, 23.799],
        [114.593, 21.74],
        [113.674, 21.603],
        [113.384, 21.863],
        [108.794, 20.799],
        [108.426, 22.561],
        [113.886, 23.591],
        [114.116, 23.347],
        [113.947, 23.42],
        [117.5, 25.161],
        [120.97, 30.116],
        [120.774, 31.143],
        [119.41, 35.62],
        [117.051, 38.401],
        [118.429, 39.559],
      ],
    ],
  },
  {
    id: "korea-deca",
    name: "South Korea Coastal ECA",
    // "Port areas at berth/anchorage" per the CE reference, not a coastline
    // strip like China's — small boxes around KRPUS and KRINC only.
    rings: [
      // Busan
      [
        [128.4, 34.5],
        [129.8, 34.5],
        [129.8, 35.7],
        [128.4, 35.7],
        [128.4, 34.5],
      ],
      // Incheon
      [
        [125.9, 36.85],
        [127.3, 36.85],
        [127.3, 38.05],
        [125.9, 38.05],
        [125.9, 36.85],
      ],
    ],
  },
];

/** ECA_ZONES as a MapLibre-ready FeatureCollection, one feature per zone. */
export function ecaZonesGeoJson(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ECA_ZONES.map((zone) => ({
      type: "Feature",
      properties: { id: zone.id, name: zone.name },
      geometry:
        zone.rings.length === 1
          ? { type: "Polygon", coordinates: zone.rings }
          : {
              type: "MultiPolygon",
              coordinates: zone.rings.map((ring) => [ring]),
            },
    })),
  };
}
