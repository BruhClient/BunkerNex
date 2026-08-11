"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { serviceColor, THEME } from "@/lib/colors";
import { ecaZonesGeoJson } from "@/lib/ecaZones";
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
 * Roughly 270 km across a laptop pane — close enough that the hull is the
 * subject, with nearby coast still in frame on a coastal leg.
 *
 * A fixed zoom, deliberately. Framing the vessel together with the berth it is
 * sailing to was the first attempt and it barely zoomed at all: Singapore
 * to Kolkata is ~2,900 km, which fits at about 5.6 against a starting
 * trade-lane view of about 4.4.
 */
const FOCUS_ZOOM = 9;
const FOCUS_MS = 700;

/**
 * How a service's line is drawn in each of the three focus states.
 *
 * With eleven services on at once, drawing them all at full strength is what
 * made the map hard to read. Nothing is focused until the user hovers or
 * selects a service in the sidebar; then that one service comes forward and
 * the rest recede far enough to read as context.
 */
const FOCUS_STYLE = {
  /** Nothing focused: every visible service drawn equally. */
  neutral: { widthScale: 1, lineOpacity: 0.85, glowOpacity: 0.1 },
  focused: { widthScale: 1.6, lineOpacity: 1, glowOpacity: 0.22 },
  dimmed: { widthScale: 0.7, lineOpacity: 0.18, glowOpacity: 0 },
} as const;

/**
 * Route lines were a flat 1.8px at every zoom, which is heavy across a
 * regional view and thin once you are inside a port cluster.
 */
function lineWidth(scale: number): maplibregl.ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 3, 1.2 * scale, 8, 2.4 * scale];
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
  vesselTracks: VesselTrack[];
  visibleServices: string[];
  /** From the filter sidebar's region/search/fuel axes. null = no restriction. */
  visiblePortKeys: Set<string> | null;
  visibleVesselNames: Set<string> | null;
  selectedKey: string | null;
  /**
   * The one service brought forward on the map — hovered or selected in the
   * sidebar. `null` draws every visible service at equal weight.
   */
  focusedService: string | null;
  /** Index into every track's step arrays; all tracks share one time grid. */
  stepIndex: number;
  selectedVesselName: string | null;
  /**
   * Vessel the camera holds while the spot bunker form is open. `null` hands
   * the view back and eases to wherever it was before focus was entered.
   */
  focusVesselName: string | null;
  /**
   * Horizontal pixel bias for the focus camera, so a panel overlaying the map
   * does not end up sitting on top of the vessel it is about. 0 when nothing
   * overlays.
   */
  focusOffsetX: number;
  onSelectPort: (key: string | null) => void;
  onSelectVessel: (name: string | null) => void;
}

/** CSS pixels; `icon-size` stays at 1 so this is the size actually drawn. */
const CHEVRON_SIZE = 13;
/** Drawn at 2x and tagged `pixelRatio: 2`, or the mark is soft on HiDPI. */
const CHEVRON_RATIO = 2;

/**
 * An *open, stroked* chevron — deliberately not a filled triangle.
 *
 * The vessel marker is a solid hull silhouette (see `buildVesselElement`), so
 * a filled triangle here read as a second kind of ship rather than as a
 * direction hint. Keeping direction marks hollow and ships solid is what
 * separates the two at a glance.
 *
 * MapLibre rotates line-placed icons so the image's local +x axis (the apex,
 * here) follows the line's direction of travel — since arcs are built
 * from-stop to to-stop in sailing order, this points the way the ship
 * actually sails without any extra bearing math.
 */
function chevronIconImage(color: string): ImageData {
  const s = CHEVRON_SIZE * CHEVRON_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.17);
    ctx.lineTo(s * 0.75, s * 0.5);
    ctx.lineTo(s * 0.3, s * 0.83);
  };

  // A dark casing underneath, so the mark still reads where a route crosses a
  // pale basemap patch.
  trace();
  ctx.strokeStyle = THEME.bg;
  ctx.lineWidth = 3.2 * CHEVRON_RATIO;
  ctx.stroke();

  trace();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * CHEVRON_RATIO;
  ctx.stroke();

  return ctx.getImageData(0, 0, s, s);
}

export default function RouteMap({
  ports,
  portCalls,
  vesselTracks,
  visibleServices,
  visiblePortKeys,
  visibleVesselNames,
  selectedKey,
  focusedService,
  stepIndex,
  selectedVesselName,
  focusVesselName,
  focusOffsetX,
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
  /**
   * Current screen-space fan offset per service, keyed by code. Recomputed
   * whenever visibility changes and read back by the vessel effect, so ships
   * ride the same offset line their service is drawn on.
   */
  const offsetsRef = useRef<Map<string, number>>(new Map());
  // Re-fits the current view; re-pointed whenever visibility changes.
  const fitRef = useRef<(() => void) | null>(null);
  // Once the user pans or zooms, stop re-framing the map for them.
  const userMovedRef = useRef(false);
  /** The view to hand back on exit. Stashed on entry, cleared on restore. */
  const preFocusCameraRef = useRef<{
    center: maplibregl.LngLat;
    zoom: number;
  } | null>(null);
  // Keeps the map's click handler pointing at the latest callback.
  const onSelectRef = useRef(onSelectPort);
  onSelectRef.current = onSelectPort;
  const onSelectVesselRef = useRef(onSelectVessel);
  onSelectVesselRef.current = onSelectVessel;
  /**
   * Focus state for the ResizeObserver, assigned during render like the
   * callbacks above rather than inside the focus effect below.
   *
   * The ordering matters and is not obvious: unmounting the services sidebar is
   * a size change, and a ResizeObserver callback fires after layout but *before*
   * passive effects. A ref written by the effect would therefore still read
   * stale on the one tick that counts, and the observer would refit the trade
   * lane over the vessel the form is about.
   */
  const focusVesselRef = useRef(focusVesselName);
  focusVesselRef.current = focusVesselName;

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

      // Shaded ECA/DECA reference zones — schematic sea-area outlines, not
      // surveyed boundaries (see ecaZones.ts). Added first among our own
      // layers so it renders beneath every route line and port label.
      map.addSource("eca-zones", { type: "geojson", data: ecaZonesGeoJson() });
      map.addLayer(
        {
          id: "eca-zones-fill",
          type: "fill",
          source: "eca-zones",
          paint: { "fill-color": THEME.warn, "fill-opacity": 0.08 },
        },
        firstSymbolId,
      );
      map.addLayer(
        {
          id: "eca-zones-outline",
          type: "line",
          source: "eca-zones",
          paint: {
            "line-color": THEME.warn,
            "line-opacity": 0.25,
            "line-width": 1,
          },
        },
        firstSymbolId,
      );

      // Offsets and focus styling are both applied by their own effects,
      // which run straight after load — these layers start at neutral, on the
      // centreline, with their direction marks switched off.
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
              "line-opacity": FOCUS_STYLE.neutral.glowOpacity,
              "line-blur": 3,
              "line-offset": 0,
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
              "line-width": lineWidth(FOCUS_STYLE.neutral.widthScale),
              "line-opacity": FOCUS_STYLE.neutral.lineOpacity,
              "line-offset": 0,
            },
          },
          firstSymbolId,
        );

        const chevronIcon = `chevron-${code}`;
        if (!map.hasImage(chevronIcon)) {
          map.addImage(chevronIcon, chevronIconImage(color), {
            pixelRatio: CHEVRON_RATIO,
          });
        }
        map.addLayer(
          {
            id: `route-${code}-chevron`,
            type: "symbol",
            source: `route-${code}`,
            // Direction marks only ever appear on the focused service; the
            // focus effect turns exactly one of these on.
            layout: {
              visibility: "none",
              "symbol-placement": "line",
              // Sparse, because they are never competing with ten other
              // services' marks any more.
              "symbol-spacing": 190,
              "icon-image": chevronIcon,
              // Must stay 1. icon-offset is *multiplied* by icon-size, so any
              // other value silently scales the fan offset below and the
              // chevrons drift off their own line as you zoom.
              "icon-size": 1,
              "icon-rotation-alignment": "map",
              "icon-offset": [0, 0],
              // A direction hint, not a navigational label — it should never
              // fight port labels for collision space.
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: { "icon-opacity": 0.7 },
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
            "text-color": THEME.fg,
            "text-halo-color": THEME.bg,
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
            "text-color": THEME.muted,
            "text-halo-color": THEME.bg,
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
            "text-color": THEME.accent,
            "text-halo-color": THEME.bg,
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
      // rebuilding them per step would churn DOM 744 times per playback.
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
      // Focus mode owns the camera. Unmounting the services sidebar is itself a
      // size change, so without this guard entering focus would refit the whole
      // trade lane on the very tick the zoom is being set up. resize() preserves
      // the centre, so nothing needs re-centring here.
      if (focusVesselRef.current !== null) return;
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

      // Fan the services apart in *screen* space rather than by displacing the
      // geometry. The arcs follow real sea lanes, so bending them sideways to
      // separate them would push them straight back onto land.
      //
      // Spread only the services actually on screen: fanning across all
      // eleven regardless left a lone visible service drawn up to 12.5px off
      // its own lane, with nothing beside it to justify the gap.
      const shown = [...visible].sort();
      const offsets = new Map<string, number>(
        shown.map((code, i) => [
          code,
          (i - (shown.length - 1) / 2) * SERVICE_LINE_GAP,
        ]),
      );
      offsetsRef.current = offsets;

      for (const code of serviceCodes) {
        const on = visible.has(code);
        const offset = offsets.get(code) ?? 0;

        for (const suffix of ["glow", "line"]) {
          const id = `route-${code}-${suffix}`;
          if (!map.getLayer(id)) continue;
          map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
          map.setPaintProperty(id, "line-offset", offset);
        }

        // Chevron visibility belongs to the focus effect — a hidden service
        // must stay hidden whether or not it is focused — but the offset is
        // this effect's to keep in step with the line it sits on.
        const chevronId = `route-${code}-chevron`;
        if (map.getLayer(chevronId)) {
          // Symbol layers have no line-offset. icon-offset rotates with the
          // icon, so a y-shift moves each chevron perpendicular to its
          // direction of travel — onto its own service's line.
          map.setLayoutProperty(chevronId, "icon-offset", [0, offset]);
        }
      }

      // Dim route ports whose services are all switched off, then AND in the
      // filter sidebar's region/search/fuel restriction (null = no further
      // restriction). Markers and labels share one rule so they cannot drift
      // apart.
      const serviceActive = activePortKeys(ports, visible);
      const active = visiblePortKeys
        ? new Set(
            [...serviceActive].filter((key) => visiblePortKeys.has(key)),
          )
        : serviceActive;
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

      // Focus mode owns the camera, and entering it narrows visibleServices to
      // the one service — which lands here. Refitting the lane would fight the
      // vessel zoom the focus effect is setting up.
      if (focusVesselRef.current === null) fitRef.current?.();
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [visibleKey, ports, serviceCodes, visiblePortKeys]);

  // --- Bring the focused service forward, push the rest back ---
  // Also owns chevron visibility: direction marks belong to one service at a
  // time, which is what keeps them from being mistaken for vessels.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const visible = new Set(visibleKey ? visibleKey.split(",") : []);

      for (const code of serviceCodes) {
        const style = !focusedService
          ? FOCUS_STYLE.neutral
          : code === focusedService
            ? FOCUS_STYLE.focused
            : FOCUS_STYLE.dimmed;

        const lineId = `route-${code}-line`;
        if (map.getLayer(lineId)) {
          map.setPaintProperty(lineId, "line-opacity", style.lineOpacity);
          map.setPaintProperty(lineId, "line-width", lineWidth(style.widthScale));
        }

        const glowId = `route-${code}-glow`;
        if (map.getLayer(glowId)) {
          map.setPaintProperty(glowId, "line-opacity", style.glowOpacity);
        }

        const chevronId = `route-${code}-chevron`;
        if (map.getLayer(chevronId)) {
          const on = visible.has(code) && code === focusedService;
          map.setLayoutProperty(
            chevronId,
            "visibility",
            on ? "visible" : "none",
          );
        }
      }
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [focusedService, visibleKey, serviceCodes]);

  // --- Vessels recede with their service's line ---
  useEffect(() => {
    for (const [name, { el }] of vesselMarkersRef.current) {
      const code = trackByName.get(name)?.serviceCode;
      el.classList.toggle(
        "is-dimmed",
        focusedService !== null && code !== focusedService,
      );
    }
  }, [focusedService, trackByName]);

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
        // clears both together. Focus mode narrows further, to the single hull
        // the requirement is about — visibleServices cannot express that, since
        // a service may have several tracked vessels on it. Focus mode also
        // bypasses the filter sidebar's own vessel restriction, same reason.
        el.style.display = (
          focusVesselName
            ? name === focusVesselName
            : visible.has(track.serviceCode) &&
              (visibleVesselNames === null || visibleVesselNames.has(name))
        )
          ? ""
          : "none";
        marker.setLngLat(fix.position);

        const hull = el.querySelector<HTMLElement>(".bn-vessel-icon");
        if (hull) {
          // Berthed vessels have no heading to show, so the hull squares up
          // rather than pointing in whatever direction it last sailed, and
          // shrinks back behind the port marker it is sitting on. Both live
          // here rather than in CSS because an inline transform would
          // otherwise override the class rule and drop the scale silently.
          hull.style.transform = fix.berthed
            ? "rotate(0deg) scale(0.72)"
            : `rotate(${fix.bearing}deg)`;
        }

        // Ride the same fanned line the service is drawn on, instead of the
        // shared centreline every service's geometry actually runs down.
        // MapLibre offsets a line to the *right* of travel; with screen y
        // pointing down and bearing measured clockwise from north, right of
        // travel is (cos, sin).
        const fan = el.querySelector<HTMLElement>(".bn-vessel-fan");
        if (fan) {
          const offset = fix.berthed
            ? 0
            : (offsetsRef.current.get(track.serviceCode) ?? 0);
          if (offset === 0) {
            fan.style.transform = "";
          } else {
            const rad = (fix.bearing * Math.PI) / 180;
            const dx = (offset * Math.cos(rad)).toFixed(2);
            const dy = (offset * Math.sin(rad)).toFixed(2);
            fan.style.transform = `translate(${dx}px, ${dy}px)`;
          }
        }

        el.classList.toggle("is-berthed", fix.berthed);
        el.classList.toggle("is-bunkering", fix.bunkeredMt !== null);

        updateVesselTip(el, track, fix);
      }
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [
    stepIndex,
    resolvers,
    trackByName,
    visibleServices,
    visibleVesselNames,
    focusVesselName,
  ]);

  // --- Selected vessel styling ---
  useEffect(() => {
    for (const [name, { el }] of vesselMarkersRef.current) {
      el.classList.toggle("is-selected", name === selectedVesselName);
    }
  }, [selectedVesselName]);

  // --- Focus mode: hold the camera on one vessel ---
  // Programmatic moves never set userMovedRef — zoomstart checks
  // e.originalEvent, and easeTo fires no dragstart — so entering focus does not
  // permanently disable the trade-lane refit for the rest of the session.
  // stepIndex is frozen while focused, so this settles after one pass.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (!focusVesselName) {
        const previous = preFocusCameraRef.current;
        if (previous) {
          preFocusCameraRef.current = null;
          map.easeTo({ ...previous, duration: FOCUS_MS });
        }
        return;
      }

      const fix = resolvers.get(focusVesselName)?.(stepIndex) ?? null;
      // No fix means no position to hold. Leave the camera alone rather than
      // easing somewhere arbitrary.
      if (!fix) return;

      if (!preFocusCameraRef.current) {
        preFocusCameraRef.current = {
          center: map.getCenter(),
          zoom: map.getZoom(),
        };
      }

      map.easeTo({
        center: fix.position,
        zoom: FOCUS_ZOOM,
        // Places the vessel this many pixels from the container centre, which
        // is how it ends up centred in the strip an overlaying panel leaves.
        offset: [focusOffsetX, 0],
        duration: FOCUS_MS,
      });
    };

    if (readyRef.current) apply();
    else map.once("load", apply);
  }, [focusVesselName, focusOffsetX, stepIndex, resolvers]);

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
 * Vessel marker DOM: a solid hull silhouette tinted to match its service's
 * route line, so a vessel reads as belonging to the line it sits on. Built
 * once per vessel and mutated thereafter — see the scrub effect above.
 *
 * Shape carries the ship/direction distinction and colour carries the
 * service: ships are solid hulls, direction marks are hollow chevrons. A
 * chevron here read as an arrow, which is exactly what made the two
 * indistinguishable.
 *
 * Two nested spans, because the two transforms change on different
 * schedules: `.bn-vessel-fan` holds the service's screen-space fan offset,
 * `.bn-vessel-icon` holds the heading rotation and its easing.
 */
function buildVesselElement(track: VesselTrack): HTMLElement {
  const color = serviceColor(track.serviceCode);

  const el = document.createElement("div");
  el.className = "bn-vessel";
  el.style.setProperty("--vessel-color", color);
  el.title = track.name;

  const fan = document.createElement("span");
  fan.className = "bn-vessel-fan";

  const icon = document.createElement("span");
  icon.className = "bn-vessel-icon";
  // A north-pointing hull — tapered bow, flat stern. The scrub effect rotates
  // it by the leg bearing, which is also measured clockwise from north, so
  // the two agree with no offset term.
  icon.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 1 C9.7 3 11 4.7 11 6.3 L11 13 L5 13 L5 6.3 C5 4.7 6.3 3 8 1 Z" />' +
    "</svg>";
  fan.appendChild(icon);
  el.appendChild(fan);

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
  // fix.grade is what is burning now, not the vessel's primary grade — a ship
  // in a China or Korea ECA reads MGO here and switches back on departure.
  rob.textContent = `${fix.grade} ${Math.round(fix.robMt).toLocaleString()} MT`;

  stem.textContent =
    fix.bunkeredMt !== null
      ? `Bunkering ${Math.round(fix.bunkeredMt).toLocaleString()} MT ${fix.grade}`
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
