"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { serviceColor } from "@/lib/colors";
import { greatCircleArc, multiPointArc, type LonLat } from "@/lib/geo";
import { seaRoute } from "@/lib/searoutes";
import { createTrackResolver, type VesselFix } from "@/lib/vesselPosition";
import { formatPrice } from "@/lib/format";
import type { Port, PortCall, VesselTrack } from "@/lib/types";

// CARTO's Dark Matter needs no API key.
const STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const PORTS_SOURCE = "ports";

/**
 * Screen-space gap between neighbouring services, in pixels. Services sharing
 * a port pair (CAS and CCS both run Singapore-Kolkata) would otherwise draw
 * exactly on top of each other.
 */
const SERVICE_LINE_GAP = 2.5;

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
  vesselTracks: VesselTrack[];
  visibleServices: string[];
  selectedKey: string | null;
  /** Index into every track's step arrays; all tracks share one time grid. */
  stepIndex: number;
  selectedVesselName: string | null;
  onSelectPort: (key: string | null) => void;
  onSelectVessel: (name: string | null) => void;
}

/**
 * A small right-pointing triangle, tinted per service. MapLibre rotates
 * line-placed icons so the image's local +x axis (the tip, here) follows
 * the line's direction of travel — since arcs are built from-stop to
 * to-stop in sailing order, this makes the arrows point the way the ship
 * actually sails without any extra bearing math.
 */
function arrowIconImage(color: string, size = 24): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.2, size * 0.1);
  ctx.lineTo(size * 0.2, size * 0.9);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

export default function RouteMap({
  ports,
  portCalls,
  vesselTracks,
  visibleServices,
  selectedKey,
  stepIndex,
  selectedVesselName,
  onSelectPort,
  onSelectVessel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, HTMLElement>>(new Map());
  const vesselMarkersRef = useRef<
    Map<string, { marker: maplibregl.Marker; el: HTMLElement }>
  >(new Map());
  const readyRef = useRef(false);
  // Re-fits the current view; re-pointed whenever visibility changes.
  const fitRef = useRef<(() => void) | null>(null);
  // Once the user pans or zooms, stop re-framing the map for them.
  const userMovedRef = useRef(false);
  // Keeps the map's click handler pointing at the latest callback.
  const onSelectRef = useRef(onSelectPort);
  onSelectRef.current = onSelectPort;
  const onSelectVesselRef = useRef(onSelectVessel);
  onSelectVesselRef.current = onSelectVessel;

  const portsByKey = useMemo(
    () => new Map(ports.map((p) => [p.key, p])),
    [ports],
  );

  /**
   * One position resolver per vessel. The synthetic lat/lon in the source sit
   * thousands of km from the ports they are labelled with, so positions come
   * from the port index instead, interpolated along the same sea lanes the
   * route arcs are drawn from.
   */
  const resolvers = useMemo(() => {
    const portLonLat = (key: string): LonLat | null => {
      const port = portsByKey.get(key);
      return port ? [port.lon, port.lat] : null;
    };
    return new Map(
      vesselTracks.map((t) => [t.name, createTrackResolver(t, portLonLat)]),
    );
  }, [vesselTracks, portsByKey]);

  const trackByName = useMemo(
    () => new Map(vesselTracks.map((t) => [t.name, t])),
    [vesselTracks],
  );

  const serviceCodes = useMemo(
    () => [...new Set(portCalls.map((c) => c.serviceCode))].sort(),
    [portCalls],
  );

  /** One GeoJSON FeatureCollection of arcs per service. */
  const routeGeoJson = useMemo(() => {
    const out = new Map<string, GeoJSON.FeatureCollection>();

    for (const code of serviceCodes) {
      const calls = portCalls
        .filter((c) => c.serviceCode === code)
        .sort((a, b) => a.sequenceNo - b.sequenceNo);

      const features: GeoJSON.Feature[] = [];
      for (let i = 0; i < calls.length - 1; i++) {
        const from = portsByKey.get(calls[i].portCode);
        const to = portsByKey.get(calls[i + 1].portCode);
        if (!from || !to) continue;
        if (from.key === to.key) continue; // no arc for a same-port leg

        // A routed path is already several short hops, so it needs far fewer
        // steps per hop than one ocean-spanning arc does.
        const via = seaRoute(from.key, to.key);
        const arc = via
          ? multiPointArc(
              [[from.lon, from.lat], ...via, [to.lon, to.lat]],
              24,
            )
          : greatCircleArc([from.lon, from.lat], [to.lon, to.lat]);

        features.push({
          type: "Feature",
          properties: { service: code },
          geometry: { type: "LineString", coordinates: arc },
        });
      }
      out.set(code, { type: "FeatureCollection", features });
    }

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

      serviceCodes.forEach((code, serviceIndex) => {
        const data = routeGeoJson.get(code);
        if (!data) return;
        const color = serviceColor(code);

        // Fan the services apart in *screen* space rather than by displacing
        // the geometry. The arcs now follow real sea lanes, so bending them
        // sideways to separate them would push them straight back onto land.
        const offset =
          (serviceIndex - (serviceCodes.length - 1) / 2) * SERVICE_LINE_GAP;

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
              "line-offset": offset,
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
              "line-offset": offset,
            },
          },
          firstSymbolId,
        );

        const arrowIcon = `arrow-${code}`;
        if (!map.hasImage(arrowIcon)) {
          map.addImage(arrowIcon, arrowIconImage(color));
        }
        map.addLayer(
          {
            id: `route-${code}-arrow`,
            type: "symbol",
            source: `route-${code}`,
            layout: {
              "symbol-placement": "line",
              "symbol-spacing": 110,
              "icon-image": arrowIcon,
              "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.45, 8, 0.8],
              "icon-rotation-alignment": "map",
              // Symbol layers have no line-offset, so the arrows would sit on
              // the un-offset centreline. icon-offset rotates with the icon,
              // so a y-shift moves each arrow perpendicular to its direction
              // of travel — onto its own service's line.
              "icon-offset": [0, offset],
              // Arrows are a direction hint, not a navigational label — they
              // should never fight port labels for collision space.
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: { "icon-opacity": 0.85 },
          },
          firstSymbolId,
        );
      });

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

      // Vessel markers are created once and then *moved* on every scrub —
      // rebuilding them per step would churn DOM 480 times per playback.
      for (const track of vesselTracks) {
        const el = buildVesselElement(track);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectVesselRef.current(track.name);
        });
        const marker = new maplibregl.Marker({
          element: el,
          // Rotation is applied to our own inner chevron so the tooltip stays
          // upright; the marker itself must not spin.
          rotationAlignment: "viewport",
        })
          .setLngLat([0, 0])
          .addTo(map);
        vesselMarkersRef.current.set(track.name, { marker, el });
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
      vesselMarkersRef.current.clear();
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
        for (const suffix of ["glow", "line", "arrow"]) {
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

  // --- Move vessels to the scrubbed time ---
  // Runs on every scrubber tick, so it only mutates existing markers: a
  // setLngLat plus a transform per vessel, no React re-render and no new DOM.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visible = new Set(visibleServices);

    const apply = () => {
      for (const [name, { marker, el }] of vesselMarkersRef.current) {
        const track = trackByName.get(name);
        const fix = resolvers.get(name)?.(stepIndex) ?? null;
        if (!track || !fix) {
          el.style.display = "none";
          continue;
        }

        // A vessel hides with its own route line, so switching a service off
        // clears both together.
        el.style.display = visible.has(track.serviceCode) ? "" : "none";
        marker.setLngLat(fix.position);

        const chevron = el.querySelector<HTMLElement>(".bn-vessel-icon");
        if (chevron) {
          // Berthed vessels have no heading to show, so the chevron squares up
          // rather than pointing in whatever direction it last sailed.
          chevron.style.transform = fix.berthed
            ? "rotate(0deg)"
            : `rotate(${fix.bearing}deg)`;
        }
        el.classList.toggle("is-berthed", fix.berthed);
        el.classList.toggle("is-bunkering", fix.bunkeredMt !== null);

        updateVesselTip(el, track, fix);
      }
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [stepIndex, resolvers, trackByName, visibleServices]);

  // --- Selected vessel styling ---
  useEffect(() => {
    for (const [name, { el }] of vesselMarkersRef.current) {
      el.classList.toggle("is-selected", name === selectedVesselName);
    }
  }, [selectedVesselName]);

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

/**
 * Vessel marker DOM: a chevron tinted to match its service's route line, so a
 * vessel reads as belonging to the line it sits on. Built once per vessel and
 * mutated thereafter — see the scrub effect above.
 */
function buildVesselElement(track: VesselTrack): HTMLElement {
  const color = serviceColor(track.serviceCode);

  const el = document.createElement("div");
  el.className = "bn-vessel";
  el.style.setProperty("--vessel-color", color);
  el.title = track.name;

  const icon = document.createElement("span");
  icon.className = "bn-vessel-icon";
  // A north-pointing chevron: the scrub effect rotates it by the leg bearing,
  // which is also measured clockwise from north, so the two agree with no
  // offset term.
  icon.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 1 L13.5 14.5 L8 11.5 L2.5 14.5 Z" /></svg>';
  el.appendChild(icon);

  // Tooltip rows are created once and only their text changes on scrub, so a
  // playback pass never rebuilds DOM.
  const tip = document.createElement("div");
  tip.className = "bn-tip bn-vessel-tip";

  const name = document.createElement("div");
  name.className = "bn-tip-name";
  name.textContent = track.name;
  tip.appendChild(name);

  const where = document.createElement("div");
  where.className = "bn-tip-meta";
  tip.appendChild(where);

  const rob = document.createElement("div");
  rob.className = "bn-tip-meta tnum";
  tip.appendChild(rob);

  const stem = document.createElement("div");
  stem.className = "bn-tip-price tnum";
  tip.appendChild(stem);

  el.appendChild(tip);
  return el;
}

/** Refresh a vessel tooltip in place; called on every scrub tick. */
function updateVesselTip(
  el: HTMLElement,
  track: VesselTrack,
  fix: VesselFix,
): void {
  const [, where, rob, stem] = el.querySelectorAll<HTMLElement>(
    ".bn-vessel-tip > div",
  );
  if (!where || !rob || !stem) return;

  where.textContent = fix.berthed
    ? `${track.serviceCode} · Berthed ${fix.portCode}`
    : `${track.serviceCode} · ${fix.fromPortCode} → ${fix.portCode}`;
  rob.textContent = `${track.grade} ${Math.round(fix.robMt).toLocaleString()} MT`;

  stem.textContent =
    fix.bunkeredMt !== null
      ? `Bunkering ${Math.round(fix.bunkeredMt).toLocaleString()} MT`
      : "";
  stem.style.display = fix.bunkeredMt !== null ? "" : "none";
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
