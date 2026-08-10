export interface PortMeta {
  name: string;
  country: string;
  lon: number;
  lat: number;
}

/**
 * Hand-authored coordinate table. The source CSVs carry no lat/lon at all, so
 * this is the only place port geometry exists. Keyed by UN/LOCODE, which is
 * also the canonical join key between the schedule and pricing datasets.
 */
export const PORT_COORDS: Record<string, PortMeta> = {
  // --- Ports called by PIL services (from Port_Calls.Port_Code) ---
  SGSIN: { name: "Singapore", country: "Singapore", lon: 103.84, lat: 1.264 },
  BDCGP: { name: "Chittagong", country: "Bangladesh", lon: 91.812, lat: 22.316 },
  BDMGL: { name: "Mongla", country: "Bangladesh", lon: 89.594, lat: 22.492 },
  INCCU: { name: "Kolkata", country: "India", lon: 88.312, lat: 22.545 },
  CNXMN: { name: "Xiamen", country: "China", lon: 118.089, lat: 24.48 },
  CNSHK: { name: "Shekou", country: "China", lon: 113.895, lat: 22.475 },
  VNHPH: { name: "Haiphong", country: "Vietnam", lon: 106.735, lat: 20.856 },
  CNSHA: { name: "Shanghai", country: "China", lon: 121.653, lat: 31.336 },
  CNNGB: { name: "Ningbo", country: "China", lon: 121.845, lat: 29.905 },
  CNNSA: { name: "Nansha", country: "China", lon: 113.635, lat: 22.727 },
  INMAA: { name: "Chennai", country: "India", lon: 80.3, lat: 13.1 },
  INGAV: { name: "Gangavaram", country: "India", lon: 83.23, lat: 17.63 },
  MYPKG: {
    name: "Port Klang Westport",
    country: "Malaysia",
    lon: 101.315,
    lat: 3.0,
  },
  MMRGN: { name: "Yangon", country: "Myanmar", lon: 96.17, lat: 16.77 },
  CNTSN: { name: "Tianjin", country: "China", lon: 117.74, lat: 38.98 },
  CNTAO: { name: "Qingdao", country: "China", lon: 120.2, lat: 36.05 },
  CNQZH: { name: "Qinzhou", country: "China", lon: 108.61, lat: 21.68 },
  KRINC: { name: "Incheon", country: "South Korea", lon: 126.6, lat: 37.45 },
  VNSGN: { name: "Ho Chi Minh", country: "Vietnam", lon: 106.79, lat: 10.76 },
  VNUIH: { name: "Qui Nhon", country: "Vietnam", lon: 109.24, lat: 13.77 },
  THLCH: { name: "Laem Chabang", country: "Thailand", lon: 100.88, lat: 13.08 },
  THBKK: { name: "Bangkok", country: "Thailand", lon: 100.58, lat: 13.7 },
  IDJKT: { name: "Jakarta", country: "Indonesia", lon: 106.88, lat: -6.1 },
  IDSUB: { name: "Surabaya", country: "Indonesia", lon: 112.73, lat: -7.2 },
  IDSRG: { name: "Semarang", country: "Indonesia", lon: 110.42, lat: -6.94 },

  // Busan is both — a KCS/KCI route port and a quoted bunker hub. It is the
  // third port (with Singapore and Shanghai) where the two datasets meet.
  KRPUS: { name: "Busan", country: "South Korea", lon: 129.075, lat: 35.101 },

  // --- Asia-Europe service ports (AE1-AE7, MEDI, EUROMED) ---
  VNCMP: { name: "Cai Mep", country: "Vietnam", lon: 107.02, lat: 10.58 },
  TWKHH: { name: "Kaohsiung", country: "Taiwan", lon: 120.28, lat: 22.61 },
  CNYTN: { name: "Yantian", country: "China", lon: 114.27, lat: 22.58 },
  PKKHI: { name: "Karachi", country: "Pakistan", lon: 66.98, lat: 24.85 },
  INHZA: { name: "Hazira", country: "India", lon: 72.85, lat: 21.1 },
  INMUN: { name: "Mundra", country: "India", lon: 69.72, lat: 22.84 },
  INNSA: { name: "Nhava Sheva", country: "India", lon: 72.95, lat: 18.95 },
  FRLEH: { name: "Le Havre", country: "France", lon: 0.1, lat: 49.49 },
  GBSOU: { name: "Southampton", country: "United Kingdom", lon: -1.4, lat: 50.9 },
  GBFXT: { name: "Felixstowe", country: "United Kingdom", lon: 1.32, lat: 51.96 },
  EGPSD: { name: "Port Said", country: "Egypt", lon: 32.3, lat: 31.26 },
  ESVLC: { name: "Valencia", country: "Spain", lon: -0.32, lat: 39.44 },

  // --- Bunker pricing hubs (from the pricing CSV column headers) ---
  HKHKG: { name: "Hong Kong", country: "Hong Kong", lon: 114.152, lat: 22.32 },
  JPTYO: { name: "Tokyo", country: "Japan", lon: 139.79, lat: 35.617 },
  NLRTM: { name: "Rotterdam", country: "Netherlands", lon: 4.4, lat: 51.905 },
  BEANR: { name: "Antwerp", country: "Belgium", lon: 4.298, lat: 51.26 },
  USNYC: { name: "New York", country: "United States", lon: -74.045, lat: 40.67 },
  USHOU: { name: "Houston", country: "United States", lon: -95.1, lat: 29.72 },
  USLGB: {
    name: "LA / Long Beach",
    country: "United States",
    lon: -118.216,
    lat: 33.754,
  },
  USSEA: { name: "Seattle", country: "United States", lon: -122.34, lat: 47.6 },
  USORF: { name: "Norfolk", country: "United States", lon: -76.33, lat: 36.9 },
  PABLB: { name: "Balboa", country: "Panama", lon: -79.567, lat: 8.95 },
  PAPAM: { name: "Panama", country: "Panama", lon: -79.92, lat: 9.35 },
  CLVAP: { name: "Valparaiso", country: "Chile", lon: -71.63, lat: -33.03 },
  BRSSZ: { name: "Santos", country: "Brazil", lon: -46.31, lat: -23.96 },
  PECLL: { name: "Callao", country: "Peru", lon: -77.15, lat: -12.05 },
  AEFJR: {
    name: "Fujairah",
    country: "United Arab Emirates",
    lon: 56.36,
    lat: 25.17,
  },
  ESALG: { name: "Algeciras", country: "Spain", lon: -5.44, lat: 36.13 },
  GRPIR: { name: "Piraeus", country: "Greece", lon: 23.63, lat: 37.94 },
  TRIST: { name: "Istanbul", country: "Turkiye", lon: 28.98, lat: 41.02 },
  MTMLA: { name: "Malta", country: "Malta", lon: 14.51, lat: 35.89 },
  ITGOA: { name: "Genoa", country: "Italy", lon: 8.92, lat: 44.4 },
  ZADUR: { name: "Durban", country: "South Africa", lon: 31.03, lat: -29.87 },
  LKCMB: { name: "Colombo", country: "Sri Lanka", lon: 79.85, lat: 6.95 },
  RULED: { name: "St Petersburg", country: "Russia", lon: 30.24, lat: 59.9 },
  DEHAM: { name: "Hamburg", country: "Germany", lon: 9.93, lat: 53.54 },
};

/**
 * Maps the port prefix of a pricing CSV column header to a PORT_COORDS key.
 *
 * Keys are the raw prefixes upper-cased. The source spells several ports
 * inconsistently across files (ROTERDAM in VLSFO/HSGO/LSMGO vs ROTTERDAM in
 * Methanol) and misspells others (Norfork, STPETERS) — every variant is listed
 * here so they collapse onto one port.
 *
 * Singapore and Shanghai deliberately resolve to the same keys the schedule
 * data uses, so a route port and a pricing port become a single marker.
 */
export const PRICE_PORT_ALIASES: Record<string, string> = {
  SINGAPORE: "SGSIN",
  SHANGHAI: "CNSHA",
  BUSAN: "KRPUS",
  HONGKONG: "HKHKG",
  "HONG KONG": "HKHKG",
  TOKYO: "JPTYO",
  ROTERDAM: "NLRTM",
  ROTTERDAM: "NLRTM",
  ANTWERP: "BEANR",
  NEWYORK: "USNYC",
  "NEW YORK": "USNYC",
  HOUSTON: "USHOU",
  "LA LONGBEACH": "USLGB",
  SEATTLE: "USSEA",
  NORFORK: "USORF",
  NORFOLK: "USORF",
  BALBOA: "PABLB",
  PANAMA: "PAPAM",
  VALPARAISO: "CLVAP",
  SANTOS: "BRSSZ",
  CALLAO: "PECLL",
  FUJAIRAH: "AEFJR",
  ALGECIRAS: "ESALG",
  PIRAEUS: "GRPIR",
  ISTANBUL: "TRIST",
  MALTA: "MTMLA",
  GENOA: "ITGOA",
  DURBAN: "ZADUR",
  COLOMBO: "LKCMB",
  STPETERS: "RULED",
  "ST PETERSBURG": "RULED",
  HAMBURG: "DEHAM",

  // --- Modelled ports (see data/pricing/bunker_basis.csv) ---
  // These columns are not assessments. They are an assessed hub series plus a
  // documented basis, generated by scripts/gen-modelled-prices.mjs, and they
  // sit in the same files under the same header convention — so they resolve,
  // chart and value stems exactly like a quoted port. Nothing downstream can
  // tell the two apart; data/README.md is the only record of which is which.
  PORTKLANG: "MYPKG",
  CHITTAGONG: "BDCGP",
  MONGLA: "BDMGL",
  KOLKATA: "INCCU",
  CHENNAI: "INMAA",
  GANGAVARAM: "INGAV",
  YANGON: "MMRGN",
  XIAMEN: "CNXMN",
  SHEKOU: "CNSHK",
  NANSHA: "CNNSA",
  NINGBO: "CNNGB",
  TIANJIN: "CNTSN",
  QINGDAO: "CNTAO",
  QINZHOU: "CNQZH",
  INCHEON: "KRINC",
  HAIPHONG: "VNHPH",
  HOCHIMINH: "VNSGN",
  QUINHON: "VNUIH",
  LAEMCHABANG: "THLCH",
  BANGKOK: "THBKK",
  JAKARTA: "IDJKT",
  SURABAYA: "IDSUB",
  SEMARANG: "IDSRG",

  // Five more modelled ports added with the Asia-Europe services: no Chief
  // Engineer sheet coverage exists for these, so the basis in bunker_basis.csv
  // is editorial judgment off the nearest assessed European hub, not sourced.
  LEHAVRE: "FRLEH",
  SOUTHAMPTON: "GBSOU",
  FELIXSTOWE: "GBFXT",
  PORTSAID: "EGPSD",
  VALENCIA: "ESVLC",
};

/** Resolve a raw CSV column port prefix to a canonical key, or null. */
export function resolvePricePort(rawPrefix: string): string | null {
  const normalized = rawPrefix.trim().toUpperCase().replace(/\s+/g, " ");
  return PRICE_PORT_ALIASES[normalized] ?? null;
}

export function portMeta(key: string): PortMeta | null {
  return PORT_COORDS[key] ?? null;
}
