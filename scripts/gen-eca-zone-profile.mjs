/**
 * Precompute, for every port-pair leg the fleet actually sails, the
 * fraction-of-transit intervals during which the vessel's charted position
 * sits inside a shaded ECA/DECA zone.
 *
 *   node scripts/gen-eca-zone-profile.mjs
 *
 * Why this exists: gen-vessel-movement.mjs decides Active_Fuel from being
 * *near a call* at an ECA-listed port (a fixed lead/trail window). The map
 * draws a vessel's position by interpolating along the routed sea-lane path
 * (src/lib/vesselPosition.ts), independent of that window. The zone polygons
 * (src/lib/ecaZones.ts) are drawn as generous envelopes — the Mediterranean
 * SOx ring alone spans Gibraltar to Port Said — so a multi-day crossing sits
 * inside the shaded zone far longer than the ~1-day call window covers,
 * and the map visibly shows a vessel burning VLSFO/HSFO while inside yellow.
 *
 * This script closes that gap by computing ECA status from the same geometry
 * the map renders, not from call proximity. gen-vessel-movement.mjs reads its
 * JSON output and ORs it into transit steps alongside the existing (and still
 * needed, for berthed steps) port-list window.
 *
 * Duplicates SEA_NODES/SEA_EDGES/PORT_APPROACH/seaRoute (src/lib/searoutes.ts),
 * greatCircleArc/multiPointArc/pointAlong (src/lib/geo.ts) and the ECA_ZONES
 * ring data (src/lib/ecaZones.ts) as plain .mjs — Node's --experimental-strip-types
 * cannot import those files directly, since their internal imports omit
 * extensions ("./ports", not "./ports.ts"), which the ESM resolver rejects.
 * This is the same "generator can't import src/, so duplicate and document"
 * trade-off ECA_PORTS and MGO_TANK_RATIO already make.
 *
 * RE-RUN THIS before gen-vessel-movement.mjs whenever src/lib/searoutes.ts,
 * src/lib/ports.ts or src/lib/ecaZones.ts change — the geometry here goes
 * stale the same way a modelled price column does after a hub refresh.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const PORT_CALLS = path.join(DATA, "schedules", "PIL_Intra_Asia_Port_Calls.csv");
const PORTS_TS = path.join(ROOT, "src", "lib", "ports.ts");
const OUT = path.join(DATA, "derived", "eca_zone_windows.json");

// --- Geometry, duplicated from src/lib/geo.ts -----------------------------

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function greatCircleArc(from, to, steps = 64) {
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );

  if (!Number.isFinite(d) || d === 0) return [from, to];

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    points.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return points;
}

function multiPointArc(points, stepsPerLeg = 64) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCircleArc(points[i], points[i + 1], stepsPerLeg);
    out.push(...leg.slice(1));
  }
  return out;
}

function pointAlong(coords, t) {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return coords[0];

  const segLength = (a, b) => {
    const dx = (b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2));
    const dy = b[1] - a[1];
    return Math.hypot(dx, dy);
  };

  const lengths = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = segLength(coords[i], coords[i + 1]);
    lengths.push(d);
    total += d;
  }
  if (total === 0) return coords[0];

  const target = Math.min(Math.max(t, 0), 1) * total;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= target) {
      const a = coords[i];
      const b = coords[i + 1];
      const f = lengths[i] === 0 ? 0 : (target - walked) / lengths[i];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    walked += lengths[i];
  }
  return coords[coords.length - 1];
}

// --- Sea-lane graph, duplicated from src/lib/searoutes.ts -----------------

const SEA_NODES = {
  BENGAL_DELTA: [90.3, 20.4],
  BENGAL_W: [83.5, 15.5],
  BENGAL_S: [86.0, 8.5],
  ANDAMAN_N: [94.0, 14.5],
  MARTABAN: [96.4, 15.9],
  MALACCA_MOUTH: [95.35, 5.85],
  MALACCA_N: [98.2, 5.4],
  MALACCA_C: [99.7, 3.9],
  MALACCA_S: [101.9, 2.0],
  SG_WEST: [103.4, 1.15],
  SG_STRAIT: [104.5, 1.25],
  SCS_SW: [105.5, 4.5],
  SCS_SC: [110.0, 9.5],
  SCS_C: [111.5, 14.5],
  SCS_NE: [114.5, 20.5],
  CA_MAU_S: [104.7, 8.3],
  MEKONG_E: [107.0, 9.3],
  VUNG_TAU: [107.2, 10.2],
  VN_SE: [109.2, 11.2],
  CAM_RANH_E: [109.8, 12.4],
  GULF_MID: [102.2, 9.4],
  GULF_HEAD: [100.9, 12.6],
  HAINAN_E: [111.8, 18.2],
  HAINAN_S: [109.6, 17.5],
  TONKIN_MOUTH: [108.3, 18.4],
  TONKIN_HEAD: [107.3, 20.4],
  TONKIN_N: [108.5, 21.2],
  PEARL_MOUTH: [113.8, 21.9],
  TAIWAN_SW: [118.3, 23.3],
  TAIWAN_STRAIT: [120.4, 25.6],
  ECS_S: [122.5, 27.5],
  ZHOUSHAN_E: [123.0, 30.2],
  ZHOUSHAN_W: [122.2, 30.4],
  YELLOW_S: [123.0, 33.5],
  SHANDONG_SE: [122.2, 35.7],
  CHENGSHAN_CAPE: [123.0, 37.35],
  BOHAI_STRAIT: [121.0, 38.3],
  INCHEON_APPR: [125.9, 37.2],
  JINDO_WEST: [125.8, 34.4],
  KOREA_SOUTH: [128.4, 34.2],
  KARIMATA: [108.5, -2.2],
  JAVA_NW: [106.9, -5.6],
  JAVA_NC: [110.4, -6.4],
  JAVA_NE: [112.7, -6.5],
  CEYLON_S: [80.7, 5.2],
  ARABIAN_MID: [72.0, 12.0],
  INDIA_W_S: [70.0, 19.5],
  SAURASHTRA_OFFSHORE: [67.0, 20.5],
  INDIA_W_N: [67.5, 23.0],
  PAKISTAN_S: [65.5, 24.5],
  ARABIAN_W: [58.0, 13.5],
  GULF_ADEN: [50.0, 12.5],
  BAB_EL_MANDEB: [43.4, 12.6],
  RED_SEA_S: [40.5, 15.5],
  RED_SEA_MID: [37.5, 20.0],
  RED_SEA_N: [36.2, 24.0],
  GUBAL: [34.0, 27.7],
  SUEZ_S: [32.55, 29.93],
  SUEZ_N: [32.35, 31.5],
  MED_E: [28.0, 33.0],
  CRETE_S: [25.0, 34.0],
  AEGEAN: [23.4, 37.6],
  CAPE_MATAPAN: [22.0, 36.2],
  IONIAN: [19.0, 37.0],
  MED_C: [15.5, 36.0],
  MED_W: [3.0, 38.5],
  GIB_E: [-4.5, 36.0],
  GIB_W: [-6.0, 35.9],
  ATLANTIC_IBERIA: [-10.0, 38.0],
  FINISTERRE_W: [-10.5, 43.0],
  BISCAY: [-7.5, 46.5],
  CHANNEL_W: [-5.5, 48.7],
  SOLENT: [-1.6, 50.5],
  SEINE_BAY: [0.0, 49.6],
  DOVER_STRAIT: [1.8, 51.0],
  NORTH_SEA_S: [3.0, 51.9],
  GERMAN_BIGHT: [7.0, 54.3],
};

const SEA_EDGES = [
  ["BENGAL_DELTA", "BENGAL_W"],
  ["BENGAL_DELTA", "BENGAL_S"],
  ["BENGAL_W", "BENGAL_S"],
  ["BENGAL_DELTA", "ANDAMAN_N"],
  ["ANDAMAN_N", "MARTABAN"],
  ["ANDAMAN_N", "MALACCA_MOUTH"],
  ["BENGAL_S", "MALACCA_MOUTH"],
  ["MALACCA_MOUTH", "MALACCA_N"],
  ["MALACCA_N", "MALACCA_C"],
  ["MALACCA_C", "MALACCA_S"],
  ["MALACCA_S", "SG_WEST"],
  ["SG_WEST", "SG_STRAIT"],
  ["SG_STRAIT", "SCS_SW"],
  ["SCS_SW", "CA_MAU_S"],
  ["SCS_SW", "SCS_SC"],
  ["SCS_SW", "KARIMATA"],
  ["SCS_SC", "CA_MAU_S"],
  ["SCS_SC", "SCS_C"],
  ["CA_MAU_S", "MEKONG_E"],
  ["MEKONG_E", "VUNG_TAU"],
  ["VUNG_TAU", "VN_SE"],
  ["VN_SE", "CAM_RANH_E"],
  ["CAM_RANH_E", "SCS_C"],
  ["SCS_C", "SCS_NE"],
  ["SCS_C", "HAINAN_E"],
  ["SCS_NE", "HAINAN_E"],
  ["SCS_NE", "PEARL_MOUTH"],
  ["SCS_NE", "TAIWAN_SW"],
  ["PEARL_MOUTH", "TAIWAN_SW"],
  ["CA_MAU_S", "GULF_MID"],
  ["GULF_MID", "GULF_HEAD"],
  ["HAINAN_E", "HAINAN_S"],
  ["HAINAN_S", "TONKIN_MOUTH"],
  ["HAINAN_S", "CAM_RANH_E"],
  ["TONKIN_MOUTH", "TONKIN_HEAD"],
  ["TONKIN_MOUTH", "TONKIN_N"],
  ["TONKIN_HEAD", "TONKIN_N"],
  ["TAIWAN_SW", "TAIWAN_STRAIT"],
  ["TAIWAN_STRAIT", "ECS_S"],
  ["ECS_S", "ZHOUSHAN_E"],
  ["ZHOUSHAN_E", "ZHOUSHAN_W"],
  ["ZHOUSHAN_E", "YELLOW_S"],
  ["YELLOW_S", "SHANDONG_SE"],
  ["SHANDONG_SE", "CHENGSHAN_CAPE"],
  ["CHENGSHAN_CAPE", "BOHAI_STRAIT"],
  ["CHENGSHAN_CAPE", "INCHEON_APPR"],
  ["YELLOW_S", "JINDO_WEST"],
  ["YELLOW_S", "INCHEON_APPR"],
  ["INCHEON_APPR", "JINDO_WEST"],
  ["INCHEON_APPR", "SHANDONG_SE"],
  ["JINDO_WEST", "KOREA_SOUTH"],
  ["KARIMATA", "JAVA_NW"],
  ["KARIMATA", "JAVA_NC"],
  ["JAVA_NW", "JAVA_NC"],
  ["JAVA_NC", "JAVA_NE"],
  ["BENGAL_S", "CEYLON_S"],
  ["CEYLON_S", "ARABIAN_MID"],
  ["ARABIAN_MID", "INDIA_W_S"],
  ["INDIA_W_S", "SAURASHTRA_OFFSHORE"],
  ["SAURASHTRA_OFFSHORE", "INDIA_W_N"],
  ["INDIA_W_N", "PAKISTAN_S"],
  ["ARABIAN_MID", "ARABIAN_W"],
  ["ARABIAN_W", "GULF_ADEN"],
  ["GULF_ADEN", "BAB_EL_MANDEB"],
  ["BAB_EL_MANDEB", "RED_SEA_S"],
  ["RED_SEA_S", "RED_SEA_MID"],
  ["RED_SEA_MID", "RED_SEA_N"],
  ["RED_SEA_N", "GUBAL"],
  ["GUBAL", "SUEZ_S"],
  ["SUEZ_S", "SUEZ_N"],
  ["SUEZ_N", "MED_E"],
  ["MED_E", "CRETE_S"],
  ["CRETE_S", "AEGEAN"],
  ["AEGEAN", "CAPE_MATAPAN"],
  ["CAPE_MATAPAN", "IONIAN"],
  ["IONIAN", "MED_C"],
  ["MED_C", "MED_W"],
  ["MED_W", "GIB_E"],
  ["GIB_E", "GIB_W"],
  ["GIB_W", "ATLANTIC_IBERIA"],
  ["ATLANTIC_IBERIA", "FINISTERRE_W"],
  ["FINISTERRE_W", "BISCAY"],
  ["BISCAY", "CHANNEL_W"],
  ["CHANNEL_W", "SOLENT"],
  ["SOLENT", "SEINE_BAY"],
  ["SEINE_BAY", "DOVER_STRAIT"],
  ["DOVER_STRAIT", "NORTH_SEA_S"],
  ["NORTH_SEA_S", "GERMAN_BIGHT"],
];

const PORT_APPROACH = {
  SGSIN: ["SG_STRAIT", "SG_WEST"],
  MYPKG: ["MALACCA_C", "MALACCA_S"],
  BDCGP: ["BENGAL_DELTA"],
  BDMGL: ["BENGAL_DELTA"],
  INCCU: ["BENGAL_DELTA"],
  INMAA: ["BENGAL_W"],
  INGAV: ["BENGAL_W"],
  MMRGN: ["MARTABAN"],
  VNHPH: ["TONKIN_HEAD"],
  CNQZH: ["TONKIN_N"],
  VNUIH: ["CAM_RANH_E"],
  VNSGN: ["VUNG_TAU"],
  THLCH: ["GULF_HEAD"],
  THBKK: ["GULF_HEAD"],
  CNSHK: ["PEARL_MOUTH"],
  CNNSA: ["PEARL_MOUTH"],
  CNXMN: ["TAIWAN_SW"],
  CNSHA: ["ZHOUSHAN_W"],
  CNNGB: ["ZHOUSHAN_W"],
  CNTAO: ["SHANDONG_SE", "YELLOW_S"],
  CNTSN: ["BOHAI_STRAIT"],
  KRINC: ["INCHEON_APPR"],
  KRPUS: ["KOREA_SOUTH"],
  IDJKT: ["JAVA_NW"],
  IDSRG: ["JAVA_NC"],
  IDSUB: ["JAVA_NE"],
  VNCMP: ["VUNG_TAU"],
  TWKHH: ["TAIWAN_SW"],
  CNYTN: ["PEARL_MOUTH"],
  PKKHI: ["PAKISTAN_S"],
  INMUN: ["INDIA_W_N"],
  INHZA: ["INDIA_W_S"],
  INNSA: ["INDIA_W_S"],
  LKCMB: ["CEYLON_S"],
  EGPSD: ["SUEZ_N"],
  GRPIR: ["AEGEAN"],
  MTMLA: ["MED_C"],
  ESVLC: ["MED_W"],
  ESALG: ["GIB_E", "GIB_W"],
  FRLEH: ["SEINE_BAY"],
  GBSOU: ["SOLENT"],
  GBFXT: ["DOVER_STRAIT"],
  BEANR: ["NORTH_SEA_S"],
  NLRTM: ["NORTH_SEA_S"],
  DEHAM: ["GERMAN_BIGHT"],
};

const EARTH_KM = 6371;

function distanceKm(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ADJACENCY = (() => {
  const out = new Map();
  const link = (a, b) => {
    const list = out.get(a);
    if (list) list.push(b);
    else out.set(a, [b]);
  };
  for (const [a, b] of SEA_EDGES) {
    link(a, b);
    link(b, a);
  }
  return out;
})();

function seaRoute(fromKey, toKey, portLonLat) {
  const starts = PORT_APPROACH[fromKey];
  const ends = PORT_APPROACH[toKey];
  if (!starts?.length || !ends?.length) return null;

  const origin = portLonLat(fromKey);
  const target = portLonLat(toKey);
  if (!origin || !target) return null;

  const dist = new Map();
  const prev = new Map();
  for (const s of starts) {
    if (!SEA_NODES[s]) continue;
    const d = distanceKm(origin, SEA_NODES[s]);
    if (d < (dist.get(s) ?? Infinity)) {
      dist.set(s, d);
      prev.set(s, null);
    }
  }

  const visited = new Set();
  for (;;) {
    let node = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < best) {
        node = k;
        best = d;
      }
    }
    if (node === null) break;
    visited.add(node);

    for (const next of ADJACENCY.get(node) ?? []) {
      const d = best + distanceKm(SEA_NODES[node], SEA_NODES[next]);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, node);
      }
    }
  }

  let exit = null;
  let bestTotal = Infinity;
  for (const e of ends) {
    const d = dist.get(e);
    if (d === undefined) continue;
    const total = d + distanceKm(SEA_NODES[e], target);
    if (total < bestTotal) {
      bestTotal = total;
      exit = e;
    }
  }
  if (exit === null) return null;

  const path = [];
  for (let k = exit; k !== null; k = prev.get(k) ?? null) {
    path.unshift(SEA_NODES[k]);
  }
  return path;
}

// --- ECA zone rings, duplicated from src/lib/ecaZones.ts -------------------

const ECA_ZONES = [
  {
    id: "north-sea-channel",
    rings: [
      [
        [-5.5, 48.2], [-5.5, 51.5], [-3.6, 55.7], [4.25, 59.0], [12.1, 55.7],
        [12.5, 51.5], [12.1, 47.3], [4.25, 47.0], [-5.5, 48.2],
      ],
    ],
  },
  {
    id: "mediterranean-sox",
    rings: [
      [
        [-6.5, 35.2], [-6.5, 37.2], [-1.5, 40.3], [4.0, 44.0], [9.5, 44.5],
        [15.0, 45.0], [19.5, 41.5], [24.0, 41.0], [29.0, 37.5], [34.8, 33.8],
        [34.3, 30.0], [31.0, 30.5], [27.0, 32.2], [24.0, 32.7], [19.0, 31.7],
        [14.0, 32.2], [9.0, 32.7], [3.0, 34.7], [-2.5, 34.7], [-6.5, 35.2],
      ],
    ],
  },
  {
    id: "china-deca",
    rings: [
      [
        [118.429, 39.559], [120.99, 36.48], [122.532, 31.529], [122.72, 29.694],
        [118.678, 23.799], [114.593, 21.74], [113.674, 21.603], [113.384, 21.863],
        [108.794, 20.799], [108.426, 22.561], [113.886, 23.591], [114.116, 23.347],
        [113.947, 23.42], [117.5, 25.161], [120.97, 30.116], [120.774, 31.143],
        [119.41, 35.62], [117.051, 38.401], [118.429, 39.559],
      ],
    ],
  },
  {
    id: "korea-deca",
    rings: [
      [
        [128.4, 34.5], [129.8, 34.5], [129.8, 35.7], [128.4, 35.7], [128.4, 34.5],
      ],
      [
        [125.9, 36.85], [127.3, 36.85], [127.3, 38.05], [125.9, 38.05], [125.9, 36.85],
      ],
    ],
  },
];

/** Ray-casting point-in-polygon over a single ring. */
function inRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** A zone's rings are independent polygons (Korea's two boxes), never holes. */
function insideAnyZone(point) {
  for (const zone of ECA_ZONES) {
    for (const ring of zone.rings) {
      if (inRing(point, ring)) return zone.id;
    }
  }
  return null;
}

// --- Ports: scraped from src/lib/ports.ts, same convention as scrapeLocodes -

function loadPortCoords() {
  const text = fs.readFileSync(PORTS_TS, "utf8");
  const start = text.indexOf("const PORT_COORDS");
  const end = text.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("ports.ts: PORT_COORDS not found or unclosed");
  const body = text.slice(start, end);

  const coords = new Map();
  const re = /^\s{2}([A-Z]{5}):\s*\{[^}]*?lon:\s*(-?[\d.]+),\s*lat:\s*(-?[\d.]+)/gm;
  let m;
  while ((m = re.exec(body))) {
    coords.set(m[1], [Number(m[2]), Number(m[3])]);
  }
  if (coords.size < 26) throw new Error(`PORT_COORDS: scraped only ${coords.size} ports, the shape changed`);
  return coords;
}

// --- Legs actually sailed, from the port-calls CSV --------------------------

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const { data, errors } = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  if (errors.length) throw new Error(`${path.basename(file)}: ${errors[0].message} on row ${errors[0].row}`);
  return data;
}

function legsByService(rows) {
  const byService = new Map();
  for (const row of rows) {
    const code = (row.Service_Code ?? "").trim();
    if (!code) continue;
    if (!byService.has(code)) byService.set(code, []);
    byService.get(code).push(row);
  }

  const pairs = new Set();
  for (const [, calls] of byService) {
    const sorted = [...calls].sort(
      (a, b) => Number(a.Sequence_No) - Number(b.Sequence_No),
    );
    for (let i = 1; i < sorted.length; i++) {
      const from = (sorted[i - 1].Port_Code ?? "").trim();
      const to = (sorted[i].Port_Code ?? "").trim();
      if (from && to && from !== to) pairs.add(`${from}>${to}`);
    }
  }
  return [...pairs];
}

// --- Main --------------------------------------------------------------

const portCoords = loadPortCoords();
const portLonLat = (key) => portCoords.get(key) ?? null;

const portCalls = readCsv(PORT_CALLS);
const pairs = legsByService(portCalls);

const SAMPLES = 200;
const profile = {};
const overlapWarnings = [];

// Reference list, for the sanity check only — not used to decide anything.
const KNOWN_ECA_PORTS = new Set([
  "CNNGB", "CNNSA", "CNQZH", "CNSHA", "CNSHK", "CNTAO", "CNTSN", "CNXMN", "CNYTN",
  "KRINC", "KRPUS",
  "NLRTM", "BEANR", "DEHAM", "FRLEH", "GBSOU", "GBFXT",
  "ESALG", "GRPIR", "MTMLA", "EGPSD", "ESVLC",
]);

for (const pair of pairs) {
  const [fromKey, toKey] = pair.split(">");
  const from = portLonLat(fromKey);
  const to = portLonLat(toKey);
  if (!from || !to) throw new Error(`${pair}: missing PORT_COORDS for ${!from ? fromKey : toKey}`);

  const via = seaRoute(fromKey, toKey, portLonLat);
  const path_ = via ? multiPointArc([from, ...via, to], 24) : greatCircleArc(from, to);

  const inside = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    inside.push(insideAnyZone(pointAlong(path_, t)) !== null);
  }

  const intervals = [];
  let runStart = null;
  for (let i = 0; i < SAMPLES; i++) {
    if (inside[i] && runStart === null) runStart = i;
    if (!inside[i] && runStart !== null) {
      intervals.push([
        Number((runStart / (SAMPLES - 1)).toFixed(4)),
        Number((i / (SAMPLES - 1)).toFixed(4)),
      ]);
      runStart = null;
    }
  }
  if (runStart !== null) {
    intervals.push([Number((runStart / (SAMPLES - 1)).toFixed(4)), 1]);
  }

  profile[pair] = intervals;

  if (intervals.length > 0 && !KNOWN_ECA_PORTS.has(fromKey) && !KNOWN_ECA_PORTS.has(toKey)) {
    overlapWarnings.push(
      `${pair}: ${intervals.length} zone interval(s) but neither endpoint is a known ECA port`,
    );
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const text = JSON.stringify(profile, Object.keys(profile).sort(), 2) + "\n";
const unchanged = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
if (!unchanged) fs.writeFileSync(OUT, text, "utf8");

const withZone = Object.values(profile).filter((v) => v.length > 0).length;
console.log(
  `${unchanged ? "unchanged" : "wrote"} ${path.relative(ROOT, OUT)}\n` +
    `  ${pairs.length} distinct leg pairs, ${withZone} pass through a shaded zone\n`,
);
if (overlapWarnings.length > 0) {
  console.log("Sanity check — zone overlap on a leg with no known-ECA endpoint:");
  for (const w of overlapWarnings) console.log(`  ${w}`);
} else {
  console.log("Sanity check: every zone-overlapping leg touches a known ECA port at one end.");
}
