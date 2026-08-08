"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { serviceColor } from "@/lib/colors";
import { greatCircleArc, multiPointArc, type LonLat } from "@/lib/geo";
import { formatPrice } from "@/lib/format";
import type { Port, PortCall } from "@/lib/types";

// CARTO's Dark Matter needs no API key.
const STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const PORTS_SOURCE = "ports";

/**
 * A handful of legs run from Singapore toward the Bay of Bengal or down the
 * Vietnamese coast; a direct great-circle arc between those endpoints cuts
 * straight across the Malay Peninsula or Vietnam/Cambodia. These open-water
 * waypoints bend the affected legs around the landmass instead. Everything
 * not listed in ROUTE_VIA already tracks open water as a direct arc.
 */
const MALACCA_MOUTH: LonLat = [95.35, 5.85]; // NW mouth of the Malacca Strait, off Aceh
const CAM_RANH_EAST: LonLat = [109.5, 11.9]; // South China Sea, off Vietnam's Cam Ranh bulge
const CA_MAU_SOUTH: LonLat = [104.7, 8.3]; // South China Sea, south of Vietnam's Ca Mau cape

const ROUTE_VIA: Record<string, LonLat[]> = {
  "BDCGP|SGSIN": [MALACCA_MOUTH],
  "BDMGL|SGSIN": [MALACCA_MOUTH],
  "INCCU|SGSIN": [MALACCA_MOUTH],
  "MMRGN|SGSIN": [MALACCA_MOUTH],
  // Ordered north (Haiphong) to south (Singapore) — Vietnam's coast bulges
  // east around Cam Ranh, so a single waypoint near Ca Mau still cuts
  // across the country; this needs both to stay offshore the whole way.
  "SGSIN|VNHPH": [CAM_RANH_EAST, CA_MAU_SOUTH],
};

function routeViaWaypoints(a: string, b: string): LonLat[] | null {
  return ROUTE_VIA[[a, b].sort().join("|")] ?? null;
}

/**
 * Must name font stacks the style actually serves glyphs for, or MapLibre
 * renders nothing and reports no error. These three are present in Dark
 * Matter's glyph set (tiles.basemaps.cartocdn.com/fonts/...).
 */
const LABEL_FONT = ["Montserrat Medium", "Open Sans Bold", "Noto Sans Regular"];

const sharedLabelLayout: maplibregl.SymbolLayerSpecification["layout"] = {
  "text-field": ["get", "name"],
  "text-font": LABEL_FONT,
  // Lets MapLibre slide each label to whichever side is free. This is what
  // makes the tight clusters readable — Nansha/Shekou/Hong Kong sit within
  // 0.5 degrees, and Kolkata/Mongla/Chittagong are barely further apart.
  "text-variable-anchor": ["top", "bottom", "left", "right"],
  // Far enough out to clear the DOM marker, which floats above the canvas
  // and would otherwise cover a label placed on centre.
  "text-radial-offset": 1.2,
  "text-justify": "auto",
  "text-padding": 3,
  "text-max-width": 9,
};

/** Ports whose markers and labels should read as live rather than dimmed. */
function activePortKeys(ports: Port[], visible: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const port of ports) {
    // Pricing-only ports belong to no service, so they are never dimmed.
    if (!port.isRoutePort || port.serviceCodes.some((c) => visible.has(c))) {
      out.add(port.key);
    }
  }
  return out;
}

function portsGeoJson(
  ports: Port[],
  activeKeys: Set<string>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ports.map((port) => ({
      type: "Feature",
      properties: {
        key: port.key,
        name: port.name,
        isRoute: port.isRoutePort,
        callCount: port.callCount,
        active: activeKeys.has(port.key),
      },
      geometry: { type: "Point", coordinates: [port.lon, port.lat] },
    })),
  };
}

interface Props {
  ports: Port[];
  portCalls: PortCall[];
  visibleServices: string[];
  selectedKey: string | null;
  onSelectPort: (key: string | null) => void;
}

/**
 * Bow an arc sideways so services sharing a port pair (CAS and CCS both run
 * Singapore-Kolkata) do not draw exactly on top of each other. The map is
 * already schematic, so a small deterministic offset costs nothing in accuracy
 * and makes overlapping services readable.
 */
function bowArc(points: LonLat[], bow: number): LonLat[] {
  if (bow === 0 || points.length < 2) return points;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return points;
  // Unit normal to the chord.
  const nx = -dy / len;
  const ny = dx / len;
  const amp = len * bow;

  return points.map(([x, y], i) => {
    const f = i / (points.length - 1);
    const k = Math.sin(Math.PI * f) * amp;
    return [x + nx * k, y + ny * k] as LonLat;
  });
}

export default function RouteMap({
  ports,
  portCalls,
  visibleServices,
  selectedKey,
  onSelectPort,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, HTMLElement>>(new Map());
  const readyRef = useRef(false);
  // Re-fits the current view; re-pointed whenever visibility changes.
  const fitRef = useRef<(() => void) | null>(null);
  // Once the user pans or zooms, stop re-framing the map for them.
  const userMovedRef = useRef(false);
  // Keeps the map's click handler pointing at the latest callback.
  const onSelectRef = useRef(onSelectPort);
  onSelectRef.current = onSelectPort;

  const portsByKey = useMemo(
    () => new Map(ports.map((p) => [p.key, p])),
    [ports],
  );

  const serviceCodes = useMemo(
    () => [...new Set(portCalls.map((c) => c.serviceCode))].sort(),
    [portCalls],
  );

  /** One GeoJSON FeatureCollection of arcs per service. */
  const routeGeoJson = useMemo(() => {
    const out = new Map<string, GeoJSON.FeatureCollection>();

    const n = serviceCodes.length;
    // Fan the services symmetrically about the true great-circle path, and
    // keep the total spread small so an arc still reads as its real route.
    const spread = n > 1 ? 0.11 / (n - 1) : 0;

    serviceCodes.forEach((code, serviceIndex) => {
      const calls = portCalls
        .filter((c) => c.serviceCode === code)
        .sort((a, b) => a.sequenceNo - b.sequenceNo);

      const bow = (serviceIndex - (n - 1) / 2) * spread;

      const features: GeoJSON.Feature[] = [];
      for (let i = 0; i < calls.length - 1; i++) {
        const from = portsByKey.get(calls[i].portCode);
        const to = portsByKey.get(calls[i + 1].portCode);
        if (!from || !to) continue;
        if (from.key === to.key) continue; // no arc for a same-port leg

        const via = routeViaWaypoints(from.key, to.key);
        const rawArc = via
          ? multiPointArc([
              [from.lon, from.lat],
              ...via,
              [to.lon, to.lat],
            ])
          : greatCircleArc([from.lon, from.lat], [to.lon, to.lat]);
        const arc = bowArc(rawArc, bow);
        features.push({
          type: "Feature",
          properties: { service: code },
          geometry: { type: "LineString", coordinates: arc },
        });
      }
      out.set(code, { type: "FeatureCollection", features });
    });

    return out;
  }, [portCalls, portsByKey, serviceCodes]);

  // --- Map creation, once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [100, 15],
      zoom: 3.2,
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    map.on("load", () => {
      // MapLibre resolves symbol collisions in layer order: whatever is
      // placed first wins. The basemap ships 27 symbol layers of its own, so
      // port names appended on top would silently lose to "CHINA" and
      // "MALAYSIA". Everything below is inserted *before* the style's first
      // symbol layer, which gives our labels placement priority. Inserting
      // successively before the same id preserves the order of these calls.
      const firstSymbolId = map
        .getStyle()
        .layers.find((l) => l.type === "symbol")?.id;

      for (const code of serviceCodes) {
        const data = routeGeoJson.get(code);
        if (!data) continue;
        const color = serviceColor(code);

        map.addSource(`route-${code}`, { type: "geojson", data });
        map.addLayer(
          {
            id: `route-${code}-glow`,
            type: "line",
            source: `route-${code}`,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": color,
              "line-width": 7,
              "line-opacity": 0.13,
              "line-blur": 3,
            },
          },
          firstSymbolId,
        );
        map.addLayer(
          {
            id: `route-${code}-line`,
            type: "line",
            source: `route-${code}`,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": color,
              "line-width": 1.8,
              "line-opacity": 0.92,
            },
          },
          firstSymbolId,
        );
      }

      // --- Port name labels ---
      map.addSource(PORTS_SOURCE, {
        type: "geojson",
        data: portsGeoJson(ports, activePortKeys(ports, new Set(serviceCodes))),
      });

      // The 14 service ports, named at every zoom.
      map.addLayer(
        {
          id: "port-label-route",
          type: "symbol",
          source: PORTS_SOURCE,
          filter: ["==", ["get", "isRoute"], true],
          layout: {
            ...sharedLabelLayout,
            "text-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              10.5,
              5,
              12,
              8,
              14,
            ],
            // Busier ports win collisions: lower sort key is placed first.
            "symbol-sort-key": ["-", 0, ["get", "callCount"]],
          },
          paint: {
            "text-color": "#E6EAF0",
            "text-halo-color": "#0B0E13",
            "text-halo-width": 1.4,
            "text-halo-blur": 0.4,
            "text-opacity": ["case", ["get", "active"], 1, 0.4],
          },
        },
        firstSymbolId,
      );

      // The ~25 pricing-only hubs, held back until past the regional view so
      // the default map stays about the trade lane.
      map.addLayer(
        {
          id: "port-label-hub",
          type: "symbol",
          source: PORTS_SOURCE,
          filter: ["!", ["get", "isRoute"]],
          minzoom: 4.6,
          layout: {
            ...sharedLabelLayout,
            "text-size": ["interpolate", ["linear"], ["zoom"], 4.6, 10, 8, 12],
          },
          paint: {
            "text-color": "#9AA6B8",
            "text-halo-color": "#0B0E13",
            "text-halo-width": 1.4,
            "text-halo-blur": 0.4,
          },
        },
        firstSymbolId,
      );

      // The selected port is always named, even inside a dense cluster.
      map.addLayer(
        {
          id: "port-label-selected",
          type: "symbol",
          source: PORTS_SOURCE,
          filter: ["==", ["get", "key"], ""],
          layout: {
            ...sharedLabelLayout,
            "text-size": 13,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          },
          paint: {
            "text-color": "#22D3EE",
            "text-halo-color": "#0B0E13",
            "text-halo-width": 1.6,
          },
        },
        firstSymbolId,
      );

      // Subdue the basemap's own place names so port names read as the
      // primary layer rather than competing for attention.
      const portNames = ports.map((p) => p.name);
      for (const layer of map.getStyle().layers) {
        if (layer.type !== "symbol" || !layer.id.startsWith("place_")) continue;
        map.setPaintProperty(layer.id, "text-opacity", 0.5);

        // The basemap also labels the settlement at many of these ports, so
        // "Hong Kong" would render twice — once from us, once from CARTO.
        // Drop the basemap's copy for exactly the names we draw ourselves,
        // keeping country/state/continent labels for geographic context.
        // These layers use legacy filter syntax keyed on name_en.
        if (!/^place_(city|town|village|hamlet|suburbs|capital)/.test(layer.id)) {
          continue;
        }
        const existing = map.getFilter(layer.id);
        const exclude = [
          "all",
          ["!in", "name_en", ...portNames],
          ["!in", "name", ...portNames],
        ];
        map.setFilter(
          layer.id,
          (existing ? ["all", existing, exclude] : exclude) as never,
        );
      }

      for (const port of ports) {
        const el = buildMarkerElement(port);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectRef.current(port.key);
        });
        markersRef.current.set(port.key, el);
        new maplibregl.Marker({ element: el })
          .setLngLat([port.lon, port.lat])
          .addTo(map);
      }

      readyRef.current = true;
      map.resize();
    });

    map.on("click", () => onSelectRef.current(null));
    map.on("dragstart", () => (userMovedRef.current = true));
    map.on("zoomstart", (e) => {
      // Programmatic fitBounds also fires zoomstart; only count real input.
      if (e.originalEvent) userMovedRef.current = true;
    });

    // The flex layout settles after the map is constructed, so MapLibre's
    // initial canvas is the wrong size — which also throws off fitBounds.
    // Re-fit on every size change until the user takes over the view.
    const observer = new ResizeObserver(() => {
      map.resize();
      if (!userMovedRef.current) fitRef.current?.();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      readyRef.current = false;
    };
    // Built once — the underlying schedule data does not change at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Toggle route visibility + refit ---
  const visibleKey = [...visibleServices].sort().join(",");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const visible = new Set(visibleKey ? visibleKey.split(",") : []);

      for (const code of serviceCodes) {
        const v = visible.has(code) ? "visible" : "none";
        for (const suffix of ["glow", "line"]) {
          const id = `route-${code}-${suffix}`;
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
        }
      }

      // Dim route ports whose services are all switched off. Markers and
      // labels share one rule so they cannot drift apart.
      const active = activePortKeys(ports, visible);
      for (const port of ports) {
        markersRef.current
          .get(port.key)
          ?.classList.toggle("is-dimmed", !active.has(port.key));
      }
      map
        .getSource<maplibregl.GeoJSONSource>(PORTS_SOURCE)
        ?.setData(portsGeoJson(ports, active));

      // Frame the visible trade lane. Pricing-only ports are excluded so the
      // view does not zoom out to the whole world.
      const inView = ports.filter(
        (p) => p.isRoutePort && p.serviceCodes.some((c) => visible.has(c)),
      );

      fitRef.current =
        inView.length === 0
          ? null
          : () => {
              const bounds = new maplibregl.LngLatBounds();
              for (const p of inView) bounds.extend([p.lon, p.lat]);
              map.fitBounds(bounds, {
                padding: 110,
                maxZoom: 6,
                duration: 600,
              });
            };
      fitRef.current?.();
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [visibleKey, ports, serviceCodes]);

  // --- Selected marker styling + always-on label ---
  useEffect(() => {
    for (const [key, el] of markersRef.current) {
      el.classList.toggle("is-selected", key === selectedKey);
    }

    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const key = selectedKey ?? "";
      if (map.getLayer("port-label-selected")) {
        map.setFilter("port-label-selected", ["==", ["get", "key"], key]);
      }
      // Drop the selected port from the base label layers, or its name would
      // render twice — once normally, once from the always-on accent layer.
      if (map.getLayer("port-label-route")) {
        map.setFilter("port-label-route", [
          "all",
          ["==", ["get", "isRoute"], true],
          ["!=", ["get", "key"], key],
        ]);
      }
      if (map.getLayer("port-label-hub")) {
        map.setFilter("port-label-hub", [
          "all",
          ["!", ["get", "isRoute"]],
          ["!=", ["get", "key"], key],
        ]);
      }
    };
    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [selectedKey]);

  // Sized with height rather than absolute insets: MapLibre ships unlayered
  // CSS (.maplibregl-map { position: relative }) which outranks any Tailwind
  // utility, since Tailwind's live in @layer. It sets no height, so h-full wins.
  return <div ref={containerRef} className="h-full w-full" />;
}

/** Marker DOM. Tooltip is a CSS-only hover child, so no extra React state. */
function buildMarkerElement(port: Port): HTMLElement {
  const el = document.createElement("div");
  el.className = "bn-marker";
  if (port.isRoutePort) el.classList.add("is-route");
  if (port.isPricePort) el.classList.add("is-priced");
  if (port.isRoutePort && port.isPricePort) el.classList.add("is-both");

  // Busier ports read larger.
  const size = port.isRoutePort ? 14 + Math.min(port.callCount, 6) : 11;
  el.style.setProperty("--marker-size", `${size}px`);

  const pulse = document.createElement("span");
  pulse.className = "bn-pulse";
  el.appendChild(pulse);

  const dot = document.createElement("span");
  dot.className = "bn-dot";
  el.appendChild(dot);

  const tip = document.createElement("div");
  tip.className = "bn-tip";

  const name = document.createElement("div");
  name.className = "bn-tip-name";
  name.textContent = port.name;
  tip.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "bn-tip-meta";
  meta.textContent = `${port.country} · ${port.key}`;
  tip.appendChild(meta);

  if (port.isPricePort) {
    const price = document.createElement("div");
    price.className = "bn-tip-price tnum";
    price.textContent =
      port.latestVlsfo !== null
        ? `VLSFO ${formatPrice(port.latestVlsfo)} $/mt`
        : "Bunker prices available";
    tip.appendChild(price);
  } else if (port.isRoutePort) {
    const none = document.createElement("div");
    none.className = "bn-tip-none";
    none.textContent = "No bunker pricing";
    tip.appendChild(none);
  }

  if (port.serviceCodes.length > 0) {
    const services = document.createElement("div");
    services.className = "bn-tip-services";
    for (const code of port.serviceCodes) {
      const chip = document.createElement("span");
      chip.textContent = code;
      chip.style.color = serviceColor(code);
      chip.style.borderColor = serviceColor(code);
      services.appendChild(chip);
    }
    tip.appendChild(services);
  }

  el.appendChild(tip);
  return el;
}
