import { portMeta } from "./ports";
import type { LonLat } from "./geo";

/**
 * A small hand-authored sea-lane network, used to route legs through water
 * instead of straight across land.
 *
 * The previous design drew every leg as a direct great-circle arc and kept a
 * table of per-leg exceptions. With 26 route ports there are ~45 distinct port
 * pairs, and the exception table could not keep up — Kolkata to Xiamen was
 * being drawn straight across Myanmar, Thailand, Laos and Vietnam.
 *
 * Here the geography is stated once, as facts that are individually checkable:
 *
 *   SEA_NODES     - named points that sit in navigable water
 *   SEA_EDGES     - node pairs whose straight segment is water end to end
 *   PORT_APPROACH - the first open water a ship reaches leaving each berth
 *
 * A leg is then the shortest path through that graph, so a leg nobody has ever
 * looked at still routes sensibly. Adding a port needs one PORT_APPROACH entry
 * and nothing else.
 *
 * These are still indicative corridors, not surveyed tracks: no depth, no
 * traffic separation schemes, no seasonal routeing.
 */
const SEA_NODES: Record<string, LonLat> = {
  // --- Bay of Bengal and the Andaman Sea ---
  // Clear of the Sundarbans and the Meghna delta, which the Chittagong,
  // Mongla and Kolkata approaches all have to stand off from.
  BENGAL_DELTA: [90.3, 20.4],
  BENGAL_W: [83.5, 15.5], // off the Andhra coast, for Chennai and Gangavaram
  BENGAL_S: [86.0, 8.5], // open bay east of Sri Lanka
  // West of the Andamans, in the Preparis Channel approach. Reached from the
  // delta, never from the south — that line would cross North Andaman.
  ANDAMAN_N: [94.0, 14.5],
  MARTABAN: [96.4, 15.9], // Gulf of Martaban, off the Yangon river bar

  // --- Malacca Strait ---
  MALACCA_MOUTH: [95.35, 5.85], // NW mouth, off Aceh
  MALACCA_N: [98.2, 5.4],
  MALACCA_C: [99.7, 3.9],
  MALACCA_S: [101.9, 2.0],
  SG_WEST: [103.4, 1.15], // Singapore Strait, west end
  SG_STRAIT: [104.5, 1.25], // east end, off Horsburgh

  // --- South China Sea ---
  SCS_SW: [105.5, 4.5], // between the Malay peninsula and Borneo
  SCS_SC: [110.0, 9.5], // south-central, the direct crossing to Ca Mau
  SCS_C: [111.5, 14.5],
  SCS_NE: [114.5, 20.5], // north basin, between Hainan and the Luzon strait
  CA_MAU_S: [104.7, 8.3], // south of Vietnam's Ca Mau cape
  MEKONG_E: [107.0, 9.3], // standing off the Mekong delta
  VUNG_TAU: [107.2, 10.2], // sea approach to the Saigon river
  VN_SE: [109.2, 11.2], // off Cape Padaran, clear of the Phan Thiet coast
  CAM_RANH_E: [109.8, 12.4], // off Cape Varella, Vietnam's furthest east point

  // --- Gulf of Thailand ---
  GULF_MID: [102.2, 9.4],
  GULF_HEAD: [100.9, 12.6], // the bight, serving Laem Chabang and Bangkok

  // --- Hainan and the Gulf of Tonkin ---
  // Hainan is 2.5 degrees across and sits squarely between the South China Sea
  // and the gulf, so every Tonkin leg rounds it to the south.
  HAINAN_E: [111.8, 18.2],
  HAINAN_S: [109.6, 17.5],
  TONKIN_MOUTH: [108.3, 18.4],
  TONKIN_HEAD: [107.3, 20.4], // Ha Long, for Haiphong
  TONKIN_N: [108.5, 21.2], // Beibu Gulf, for Qinzhou

  // --- Pearl River estuary ---
  PEARL_MOUTH: [113.8, 21.9], // Shekou and Nansha both lie up this estuary

  // --- Taiwan Strait and the East China Sea ---
  TAIWAN_SW: [118.3, 23.3], // SW approach, off Dongshan
  TAIWAN_STRAIT: [120.4, 25.6], // mid-strait, inside the Penghu channel
  ECS_S: [122.5, 27.5],
  ZHOUSHAN_E: [123.0, 30.2], // outside the archipelago
  ZHOUSHAN_W: [122.2, 30.4], // inside it, shared by Shanghai and Ningbo

  // --- Yellow Sea, Bohai and Korea ---
  YELLOW_S: [123.0, 33.5],
  SHANDONG_SE: [122.2, 35.7],
  CHENGSHAN_CAPE: [123.0, 37.35], // east tip of Shandong
  BOHAI_STRAIT: [121.0, 38.3], // between the Liaodong and Shandong peninsulas
  INCHEON_APPR: [125.9, 37.2], // outside Incheon's island cluster
  JINDO_WEST: [125.8, 34.4], // Korea's SW corner
  KOREA_SOUTH: [128.4, 34.2], // Korea Strait

  // --- Java Sea ---
  // East of Belitung: the island runs to 108.3E, so the strait is threaded on
  // its Borneo side.
  KARIMATA: [108.5, -2.2],
  JAVA_NW: [106.9, -5.6], // offshore Jakarta
  JAVA_NC: [110.4, -6.4], // offshore Semarang
  JAVA_NE: [112.7, -6.5], // west mouth of the Madura Strait, for Surabaya

  // --- Arabian Sea, continuing west from BENGAL_S ---
  // South of Sri Lanka's southern tip (Dondra Head, ~5.9N) so the leg in from
  // BENGAL_S doesn't clip the island.
  CEYLON_S: [80.7, 5.2],
  ARABIAN_MID: [72.0, 12.0], // open Arabian Sea, west of the Karnataka/Goa coast
  INDIA_W_S: [70.0, 19.5], // off Mumbai/Diu, for Nhava Sheva and Hazira
  // West of Dwarka (~69E), the Kathiawar peninsula's tip, so the leg north to
  // the Gulf of Kutch doesn't cut the corner.
  SAURASHTRA_OFFSHORE: [67.0, 20.5],
  INDIA_W_N: [67.5, 23.0], // Gulf of Kutch approach, for Mundra
  PAKISTAN_S: [65.5, 24.5], // for Karachi
  ARABIAN_W: [58.0, 13.5], // mid Arabian Sea, well south of the Omani coast

  // --- Gulf of Aden and the Red Sea ---
  GULF_ADEN: [50.0, 12.5],
  BAB_EL_MANDEB: [43.4, 12.6], // the strait itself: Yemen and the Horn close in on both sides
  RED_SEA_S: [40.5, 15.5],
  // Two more nodes rather than one straight shot to Suez: the Farasan and
  // Dahlak island chains sit either side of the direct line.
  RED_SEA_MID: [37.5, 20.0],
  RED_SEA_N: [36.2, 24.0],
  GUBAL: [34.0, 27.7], // Strait of Gubal, where the sea funnels into the Gulf of Suez
  SUEZ_S: [32.55, 29.93], // Suez city, south end of the canal
  SUEZ_N: [32.35, 31.5], // Port Said, north end of the canal / Mediterranean mouth

  // --- Mediterranean ---
  MED_E: [28.0, 33.0],
  CRETE_S: [25.0, 34.0], // south of Crete, clear of the island for the run into the Aegean
  AEGEAN: [23.4, 37.6], // Saronic Gulf approach, for Piraeus
  CAPE_MATAPAN: [22.0, 36.2], // south of the Peloponnese's southern tip
  IONIAN: [19.0, 37.0],
  MED_C: [15.5, 36.0], // central Med, for Malta
  MED_W: [3.0, 38.5], // western Med, for Valencia

  // --- Gibraltar and the Atlantic approach to the Channel ---
  GIB_E: [-4.5, 36.0], // Med-side approach to the strait, for Algeciras
  GIB_W: [-6.0, 35.9], // Atlantic-side approach, same port
  ATLANTIC_IBERIA: [-10.0, 38.0], // off Cape St Vincent
  FINISTERRE_W: [-10.5, 43.0], // well west of Cape Finisterre, Iberia's NW corner
  BISCAY: [-7.5, 46.5],

  // --- English Channel and North Sea ---
  CHANNEL_W: [-5.5, 48.7], // western entrance, off Ushant
  SOLENT: [-1.6, 50.5], // for Southampton
  SEINE_BAY: [0.0, 49.6], // for Le Havre
  DOVER_STRAIT: [1.8, 51.0], // for Felixstowe, and the gateway to the North Sea
  NORTH_SEA_S: [3.0, 51.9], // southern North Sea, for Antwerp and Rotterdam
  GERMAN_BIGHT: [7.0, 54.3], // Elbe approach, for Hamburg
};

/**
 * Undirected connections. Each pair asserts one thing: a vessel can run
 * straight between these two points without touching land.
 */
const SEA_EDGES: [string, string][] = [
  // Bay of Bengal
  ["BENGAL_DELTA", "BENGAL_W"],
  ["BENGAL_DELTA", "BENGAL_S"],
  ["BENGAL_W", "BENGAL_S"],
  ["BENGAL_DELTA", "ANDAMAN_N"],
  ["ANDAMAN_N", "MARTABAN"],
  ["ANDAMAN_N", "MALACCA_MOUTH"],
  ["BENGAL_S", "MALACCA_MOUTH"],

  // Malacca Strait, north to south
  ["MALACCA_MOUTH", "MALACCA_N"],
  ["MALACCA_N", "MALACCA_C"],
  ["MALACCA_C", "MALACCA_S"],
  ["MALACCA_S", "SG_WEST"],
  ["SG_WEST", "SG_STRAIT"],

  // South China Sea
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

  // Gulf of Thailand
  ["CA_MAU_S", "GULF_MID"],
  ["GULF_MID", "GULF_HEAD"],

  // Round Hainan into the Gulf of Tonkin
  ["HAINAN_E", "HAINAN_S"],
  ["HAINAN_S", "TONKIN_MOUTH"],
  // Straight down the Vietnamese coast at ~109.7E, which stays offshore of
  // Da Nang and Quang Ngai. Without it, gulf traffic bound south doglegs out
  // to HAINAN_E and back.
  ["HAINAN_S", "CAM_RANH_E"],
  ["TONKIN_MOUTH", "TONKIN_HEAD"],
  ["TONKIN_MOUTH", "TONKIN_N"],
  ["TONKIN_HEAD", "TONKIN_N"],

  // Taiwan Strait and up the Chinese coast
  ["TAIWAN_SW", "TAIWAN_STRAIT"],
  ["TAIWAN_STRAIT", "ECS_S"],
  ["ECS_S", "ZHOUSHAN_E"],
  ["ZHOUSHAN_E", "ZHOUSHAN_W"],
  ["ZHOUSHAN_E", "YELLOW_S"],

  // Yellow Sea, Bohai and Korea
  ["YELLOW_S", "SHANDONG_SE"],
  ["SHANDONG_SE", "CHENGSHAN_CAPE"],
  ["CHENGSHAN_CAPE", "BOHAI_STRAIT"],
  ["CHENGSHAN_CAPE", "INCHEON_APPR"],
  ["YELLOW_S", "JINDO_WEST"],
  ["YELLOW_S", "INCHEON_APPR"],
  ["INCHEON_APPR", "JINDO_WEST"],
  // The direct Yellow Sea crossing, passing south of the Shandong peninsula
  // tip. Without it Incheon-Qingdao detours north around Chengshan Cape.
  ["INCHEON_APPR", "SHANDONG_SE"],
  ["JINDO_WEST", "KOREA_SOUTH"],

  // Java Sea
  ["KARIMATA", "JAVA_NW"],
  ["KARIMATA", "JAVA_NC"],
  ["JAVA_NW", "JAVA_NC"],
  ["JAVA_NC", "JAVA_NE"],

  // Arabian Sea, continuing the chain west from the Bay of Bengal
  ["BENGAL_S", "CEYLON_S"],
  ["CEYLON_S", "ARABIAN_MID"],
  ["ARABIAN_MID", "INDIA_W_S"],
  ["INDIA_W_S", "SAURASHTRA_OFFSHORE"],
  ["SAURASHTRA_OFFSHORE", "INDIA_W_N"],
  ["INDIA_W_N", "PAKISTAN_S"],
  ["ARABIAN_MID", "ARABIAN_W"],

  // Gulf of Aden and the Red Sea
  ["ARABIAN_W", "GULF_ADEN"],
  ["GULF_ADEN", "BAB_EL_MANDEB"],
  ["BAB_EL_MANDEB", "RED_SEA_S"],
  ["RED_SEA_S", "RED_SEA_MID"],
  ["RED_SEA_MID", "RED_SEA_N"],
  ["RED_SEA_N", "GUBAL"],
  ["GUBAL", "SUEZ_S"],
  ["SUEZ_S", "SUEZ_N"],

  // Mediterranean
  ["SUEZ_N", "MED_E"],
  ["MED_E", "CRETE_S"],
  ["CRETE_S", "AEGEAN"],
  ["AEGEAN", "CAPE_MATAPAN"],
  ["CAPE_MATAPAN", "IONIAN"],
  ["IONIAN", "MED_C"],
  ["MED_C", "MED_W"],

  // Gibraltar and the Atlantic approach to the Channel
  ["MED_W", "GIB_E"],
  ["GIB_E", "GIB_W"],
  ["GIB_W", "ATLANTIC_IBERIA"],
  ["ATLANTIC_IBERIA", "FINISTERRE_W"],
  ["FINISTERRE_W", "BISCAY"],
  ["BISCAY", "CHANNEL_W"],

  // English Channel and North Sea
  ["CHANNEL_W", "SOLENT"],
  ["SOLENT", "SEINE_BAY"],
  ["SEINE_BAY", "DOVER_STRAIT"],
  ["DOVER_STRAIT", "NORTH_SEA_S"],
  ["NORTH_SEA_S", "GERMAN_BIGHT"],
];

/**
 * Where each port meets the network. Several ports share one node, which is
 * correct — Shekou and Nansha really do share the Pearl River estuary, and
 * Bangkok and Laem Chabang really do share the bight, so a leg between them
 * runs out to the common node and back in.
 *
 * Listing two nodes leaves the choice to the shortest path: Singapore heads
 * west up the strait or east into the South China Sea depending on where the
 * leg is going.
 *
 * A port missing from this table still draws — as a direct arc, which may
 * cross land. Any new Port_Code needs an entry here as well as in PORT_COORDS.
 */
const PORT_APPROACH: Record<string, string[]> = {
  // East Coast India and the Bay of Bengal
  SGSIN: ["SG_STRAIT", "SG_WEST"],
  MYPKG: ["MALACCA_C", "MALACCA_S"],
  BDCGP: ["BENGAL_DELTA"],
  BDMGL: ["BENGAL_DELTA"],
  INCCU: ["BENGAL_DELTA"],
  INMAA: ["BENGAL_W"],
  INGAV: ["BENGAL_W"],
  MMRGN: ["MARTABAN"],

  // Indochina
  VNHPH: ["TONKIN_HEAD"],
  CNQZH: ["TONKIN_N"],
  VNUIH: ["CAM_RANH_E"],
  VNSGN: ["VUNG_TAU"],
  THLCH: ["GULF_HEAD"],
  THBKK: ["GULF_HEAD"],

  // China
  CNSHK: ["PEARL_MOUTH"],
  CNNSA: ["PEARL_MOUTH"],
  CNXMN: ["TAIWAN_SW"],
  CNSHA: ["ZHOUSHAN_W"],
  CNNGB: ["ZHOUSHAN_W"],
  CNTAO: ["SHANDONG_SE", "YELLOW_S"],
  CNTSN: ["BOHAI_STRAIT"],

  // Korea
  KRINC: ["INCHEON_APPR"],
  KRPUS: ["KOREA_SOUTH"],

  // Indonesia
  IDJKT: ["JAVA_NW"],
  IDSRG: ["JAVA_NC"],
  IDSUB: ["JAVA_NE"],

  // Asia-side ports added with the Europe services, close enough to an
  // existing cluster that no new node is needed
  VNCMP: ["VUNG_TAU"], // Cai Mep sits right by Ho Chi Minh's approach
  TWKHH: ["TAIWAN_SW"], // Kaohsiung, Taiwan's SW coast
  CNYTN: ["PEARL_MOUTH"], // Yantian, the same Pearl River estuary as Shekou/Nansha

  // Indian subcontinent and Sri Lanka
  PKKHI: ["PAKISTAN_S"],
  INMUN: ["INDIA_W_N"],
  INHZA: ["INDIA_W_S"],
  INNSA: ["INDIA_W_S"],
  LKCMB: ["CEYLON_S"],

  // Mediterranean
  EGPSD: ["SUEZ_N"],
  GRPIR: ["AEGEAN"],
  MTMLA: ["MED_C"],
  ESVLC: ["MED_W"],
  // Algeciras sits at the strait itself and is reached from either side.
  ESALG: ["GIB_E", "GIB_W"],

  // Channel and North Sea
  FRLEH: ["SEINE_BAY"],
  GBSOU: ["SOLENT"],
  GBFXT: ["DOVER_STRAIT"],
  BEANR: ["NORTH_SEA_S"],
  NLRTM: ["NORTH_SEA_S"],
  DEHAM: ["GERMAN_BIGHT"],
};

const EARTH_KM = 6371;

/** Great-circle distance, used only to weight the graph. */
function distanceKm(a: LonLat, b: LonLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ADJACENCY: Map<string, string[]> = (() => {
  const out = new Map<string, string[]>();
  const link = (a: string, b: string) => {
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

/**
 * Open-water waypoints to sail between two ports, excluding the ports
 * themselves, or null if either port has no approach node.
 *
 * Both ports sharing a single approach node yields a one-element path, which
 * is what an out-and-back leg like Bangkok to Laem Chabang should look like.
 */
export function seaRoute(fromKey: string, toKey: string): LonLat[] | null {
  const starts = PORT_APPROACH[fromKey];
  const ends = PORT_APPROACH[toKey];
  if (!starts?.length || !ends?.length) return null;

  const a = portMeta(fromKey);
  const b = portMeta(toKey);
  if (!a || !b) return null;
  const origin: LonLat = [a.lon, a.lat];
  const target: LonLat = [b.lon, b.lat];

  // Dijkstra seeded from every approach node at once, each already carrying
  // the cost of sailing out to it. 40-odd nodes, so a linear scan for the
  // nearest unvisited one is cheaper than maintaining a heap.
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const s of starts) {
    if (!SEA_NODES[s]) continue;
    const d = distanceKm(origin, SEA_NODES[s]);
    if (d < (dist.get(s) ?? Infinity)) {
      dist.set(s, d);
      prev.set(s, null);
    }
  }

  const visited = new Set<string>();
  for (;;) {
    let node: string | null = null;
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

  let exit: string | null = null;
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

  const path: LonLat[] = [];
  for (let k: string | null = exit; k !== null; k = prev.get(k) ?? null) {
    path.unshift(SEA_NODES[k]);
  }
  return path;
}

/** Exported for the graph-integrity check; not used at render time. */
export const SEA_GRAPH = { SEA_NODES, SEA_EDGES, PORT_APPROACH, ADJACENCY };
