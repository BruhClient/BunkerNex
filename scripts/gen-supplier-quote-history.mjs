/**
 * Regenerate the per-supplier quote history.
 *
 *   node scripts/gen-supplier-quote-history.mjs
 *
 * A year of weekly quotes for every supplier×port×grade in supplier_offers.csv,
 * against the port's own benchmark on the same date:
 *
 *   Quote(t) = Benchmark(t) + Offer_Basis_USD_Per_MT + deviation(t)
 *
 * supplier_offers.csv carries no Date column at all — one static differential
 * per market. That is fine for "what is quoted today" and useless for judging a
 * supplier, which is a question about behaviour over time. This file is that
 * missing axis.
 *
 * THE DEVIATION IS THE WHOLE POINT. Emitting the static differential unchanged
 * across 52 weeks would draw N perfectly parallel lines, which says nothing
 * that the single current number does not already say. Each supplier-market
 * gets a mean-reverting shock process plus a slow competitiveness swing, so
 * suppliers cross each other, open and close gaps to the benchmark, and can be
 * read as more or less aggressive over the year.
 *
 * deviation(t) is normalised to be EXACTLY ZERO on the last date, so the final
 * row of this file reconciles to the live offer in supplier_offers.csv. That is
 * asserted below. Without it the chart's right-hand edge would disagree with
 * the price the port panel quotes, two screens apart.
 *
 * NONE OF THIS IS SOURCED. No supplier price history exists in any source
 * document. Only the benchmark column underneath is real — and at the 28
 * modelled ports even that is a hub plus a judgment differential, not an
 * assessment. Anything presenting these figures must say so.
 *
 * Randomness is seeded on `Port_Code|Grade|Supplier`, so the output is stable
 * and reviewable in git. Idempotent.
 *
 * Run order: after gen-supplier-offers.mjs and after any price refresh —
 * the benchmark column is copied in here, so it goes stale exactly the way a
 * modelled price column does.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data");
const PRICING = path.join(DATA, "pricing");
const OFFERS = path.join(DATA, "contracts", "supplier_offers.csv");
const OUT = path.join(DATA, "contracts", "supplier_quote_history.csv");

/** Weeks of history. One trading year. */
const WEEKS = 52;

/**
 * Below this many weekly buckets inside the window there is nothing to read a
 * trend off at all, and the market is excluded — named on stdout, never quietly
 * dropped.
 *
 * Deliberately low. A SHORT series is not a bad one: Ningbo's methanol market
 * opened on the port's first supply licence in January 2026 and carries 30 of
 * the 52 weeks, which is the real answer for a young market rather than a
 * reason to hide it. The weekly methanol columns land at 50 for the same
 * benign reason — one point per week cannot fill 52 buckets exactly. Only
 * SANTOS HSFO, last assessed 2019-11-14, actually falls out at zero.
 *
 * Consumers must therefore read the covered window off the rows themselves and
 * not assume 52 weeks.
 */
const MIN_WEEKS = 12;

/**
 * More than this many excluded markets means the sampling broke, not that the
 * data has a hole. One dead column is known and expected; a flood is a bug.
 */
const MAX_EXCLUDED_MARKETS = 4;

/** Mirrors PRICE_FILES / GRADE_SUFFIXES in src/lib/prices.ts — longest first. */
const PRICE_FILES = [
  "VLSFO Prices.csv",
  "HSGO Prices.csv",
  "MGO Prices.csv",
  "MDO Prices.csv",
  "LNG Prices.csv",
  "Biofuel Prices.csv",
  "Methanol Prices.csv",
];

const GRADE_SUFFIXES = [
  ["MEOH VLSFOE", "MEOH_VLSFOe"],
  ["MEOH MGOE", "MEOH_MGOe"],
  ["MEOH", "MEOH"],
  ["HSFO", "HSFO"],
  ["VLSFO", "VLSFO"],
  ["MGO", "MGO"],
  ["MDO", "MDO"],
  ["LNG", "LNG"],
  ["B24", "B24"],
  ["B40", "B40"],
];

/** A copy of PRICE_PORT_ALIASES in src/lib/ports.ts, misspellings included. */
const PORT_ALIASES = {
  SINGAPORE: "SGSIN", SHANGHAI: "CNSHA", BUSAN: "KRPUS", HONGKONG: "HKHKG",
  "HONG KONG": "HKHKG", TOKYO: "JPTYO", ROTERDAM: "NLRTM", ROTTERDAM: "NLRTM",
  ANTWERP: "BEANR", NEWYORK: "USNYC", "NEW YORK": "USNYC", HOUSTON: "USHOU",
  "LA LONGBEACH": "USLGB", SEATTLE: "USSEA", NORFORK: "USORF", NORFOLK: "USORF",
  BALBOA: "PABLB", PANAMA: "PAPAM", VALPARAISO: "CLVAP", SANTOS: "BRSSZ",
  CALLAO: "PECLL", FUJAIRAH: "AEFJR", ALGECIRAS: "ESALG", PIRAEUS: "GRPIR",
  ISTANBUL: "TRIST", MALTA: "MTMLA", GENOA: "ITGOA", DURBAN: "ZADUR",
  COLOMBO: "LKCMB", STPETERS: "RULED", "ST PETERSBURG": "RULED",
  HAMBURG: "DEHAM", PORTKLANG: "MYPKG", CHITTAGONG: "BDCGP", MONGLA: "BDMGL",
  KOLKATA: "INCCU", CHENNAI: "INMAA", GANGAVARAM: "INGAV", YANGON: "MMRGN",
  XIAMEN: "CNXMN", SHEKOU: "CNSHK", NANSHA: "CNNSA", NINGBO: "CNNGB",
  TIANJIN: "CNTSN", QINGDAO: "CNTAO", QINZHOU: "CNQZH", INCHEON: "KRINC",
  HAIPHONG: "VNHPH", HOCHIMINH: "VNSGN", QUINHON: "VNUIH",
  LAEMCHABANG: "THLCH", BANGKOK: "THBKK", JAKARTA: "IDJKT", SURABAYA: "IDSUB",
  SEMARANG: "IDSRG", LEHAVRE: "FRLEH", SOUTHAMPTON: "GBSOU",
  FELIXSTOWE: "GBFXT", PORTSAID: "EGPSD", VALENCIA: "ESVLC",
};

// --- seeded randomness -----------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = hash32(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- inputs ----------------------------------------------------------------

function parse(file) {
  const { data, meta } = Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: (meta.fields ?? []).map((h) => h.trim()), rows: data };
}

/** Days since epoch, for 7-day bucketing. Dates are plain YYYY-MM-DD. */
function dayNumber(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

/**
 * portKey -> grade -> [{date, value}] ascending, nulls dropped.
 *
 * Source rows are newest-first (see src/lib/prices.ts) and get reversed here,
 * the same way the runtime loader does.
 */
function readPriceSeries() {
  const index = new Map();

  for (const file of PRICE_FILES) {
    const { headers, rows } = parse(path.join(PRICING, file));
    const ordered = [...rows].reverse();

    for (const header of headers) {
      if (header === "Date") continue;

      const upper = header.toUpperCase().replace(/\s+/g, " ").trim();
      const match = GRADE_SUFFIXES.find(
        ([suffix]) => upper === suffix || upper.endsWith(` ${suffix}`),
      );
      if (!match) {
        throw new Error(`${file}: header "${header}" has no known grade suffix`);
      }

      const [suffix, grade] = match;
      const prefix = upper.slice(0, upper.length - suffix.length).trim();
      const portKey = PORT_ALIASES[prefix];
      if (!portKey) {
        throw new Error(
          `${file}: no LOCODE for column prefix "${prefix}" — add it to ` +
            "PORT_ALIASES here and to PRICE_PORT_ALIASES in src/lib/ports.ts",
        );
      }

      const points = [];
      for (const row of ordered) {
        const date = (row.Date ?? "").trim();
        const raw = (row[header] ?? "").trim();
        if (!date || raw === "") continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        points.push({ date, value });
      }
      if (points.length === 0) continue;

      if (!index.has(portKey)) index.set(portKey, new Map());
      index.get(portKey).set(grade, points);
    }
  }

  return index;
}

/**
 * The last quoted point in each 7-day bucket, across the dataset's own trailing
 * year.
 *
 * The window is anchored to the NEWEST date in data/pricing/, not to each
 * series' own last point. Anchoring per-series would silently relabel a dead
 * column as current: SANTOS HSFO stopped being quoted in November 2019, and
 * taking "its last 52 buckets" would have drawn 2019 prices on a chart headed
 * "past year". Anchored globally it correctly falls out of the window entirely.
 *
 * Bucketing on the dates the series actually carries rather than on a synthetic
 * calendar means cadence is handled by the data: a business-daily series
 * collapses ~5 points to 1, and the weekly methanol series passes through
 * unchanged instead of being resampled onto a grid it never had.
 */
function weeklySample(points, newestBucket) {
  const firstBucket = newestBucket - WEEKS + 1;
  const buckets = new Map();

  for (const p of points) {
    const bucket = Math.floor(dayNumber(p.date) / 7);
    if (bucket < firstBucket || bucket > newestBucket) continue;
    buckets.set(bucket, p);
  }

  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, p]) => p);
}

function readOffers() {
  const offers = [];
  for (const [i, row] of parse(OFFERS).rows.entries()) {
    const line = i + 2;
    const portKey = (row.Port_Code ?? "").trim();
    const grade = (row.Grade ?? "").trim();
    const supplier = (row.Supplier ?? "").trim();
    const raw = (row.Offer_Basis_USD_Per_MT ?? "").trim();

    // A blank differential is not parity, and Number("") is 0. Same rule
    // src/lib/suppliers.ts applies at read time.
    if (!portKey || !grade || !supplier || raw === "") {
      throw new Error(`supplier_offers.csv line ${line}: incomplete offer row`);
    }
    const diff = Number(raw);
    if (!Number.isFinite(diff)) {
      throw new Error(`supplier_offers.csv line ${line}: bad differential`);
    }

    offers.push({ portKey, grade, supplier, diff });
  }
  return offers;
}

// --- the deviation process -------------------------------------------------

/**
 * One supplier's wander around its own standing differential.
 *
 * Two components, because one is not enough to look real: a mean-reverting
 * shock (this week's quote remembers last week's, then decays back) carries the
 * short-run noise, and a slow sinusoid plus a linear term carries the thing a
 * desk actually wants to see — a supplier getting steadily keener or steadily
 * more expensive across the year.
 *
 * Normalised so the final element is exactly 0. See the file header.
 */
function deviationSeries(seed, n) {
  const r = rng(seed);

  const shockScale = 0.8 + r() * 2.4;
  const persistence = 0.62 + r() * 0.24;
  const swingAmp = 0.8 + r() * 4.2;
  const swingCycles = 0.5 + r() * 1.5;
  const swingPhase = r() * Math.PI * 2;
  const yearSlope = (r() * 2 - 1) * 2.5;

  const raw = [];
  let shock = 0;
  for (let i = 0; i < n; i++) {
    shock = shock * persistence + (r() * 2 - 1) * shockScale;
    const swing =
      swingAmp * Math.sin((2 * Math.PI * swingCycles * i) / n + swingPhase);
    const trend = n > 1 ? yearSlope * (i / (n - 1)) : 0;
    raw.push(shock + swing + trend);
  }

  const last = raw[raw.length - 1];
  return raw.map((v) => v - last);
}

// --- run -------------------------------------------------------------------

const prices = readPriceSeries();
const offers = readOffers();
const rows = [];
const excluded = [];

// The window every market is sampled against. One anchor for the whole file, so
// a chart's x-axis means the same thing at every port.
let newestDate = "";
for (const byGrade of prices.values()) {
  for (const series of byGrade.values()) {
    const last = series[series.length - 1].date;
    if (last > newestDate) newestDate = last;
  }
}
const newestBucket = Math.floor(dayNumber(newestDate) / 7);

for (const offer of offers) {
  const series = prices.get(offer.portKey)?.get(offer.grade);
  if (!series) {
    throw new Error(
      `${offer.portKey} ${offer.grade}: quoted by ${offer.supplier} but has ` +
        "no price series in data/pricing/",
    );
  }

  const weekly = weeklySample(series, newestBucket);
  if (weekly.length < MIN_WEEKS) {
    // Not an error: a column can stop being assessed. Excluded rather than
    // emitted short, and named on stdout so it is never a silent drop.
    excluded.push(
      `${offer.portKey} ${offer.grade} (${weekly.length} wk in window, ` +
        `series ends ${series[series.length - 1].date})`,
    );
    continue;
  }

  const deviation = deviationSeries(
    `${offer.portKey}|${offer.grade}|${offer.supplier}`,
    weekly.length,
  );

  for (const [i, point] of weekly.entries()) {
    const diff = Math.round((offer.diff + deviation[i]) * 100) / 100;
    rows.push({
      date: point.date,
      portKey: offer.portKey,
      grade: offer.grade,
      supplier: offer.supplier,
      quote: Math.round((point.value + diff) * 100) / 100,
      benchmark: Math.round(point.value * 100) / 100,
      diff,
      anchorDiff: offer.diff,
      isLast: i === weekly.length - 1,
    });
  }
}

rows.sort(
  (a, b) =>
    a.portKey.localeCompare(b.portKey) ||
    a.grade.localeCompare(b.grade) ||
    a.supplier.localeCompare(b.supplier) ||
    a.date.localeCompare(b.date),
);

// --- asserts ---------------------------------------------------------------

const seen = new Set();
const marketWeeks = new Map();

for (const row of rows) {
  const key = `${row.portKey}|${row.grade}|${row.supplier}|${row.date}`;
  if (seen.has(key)) throw new Error(`duplicate quote: ${key}`);
  seen.add(key);

  // The reconciliation invariant. The last row of every supplier-market must
  // equal the live offer, or this chart and the port panel disagree.
  if (row.isLast && row.diff !== row.anchorDiff) {
    throw new Error(
      `${row.portKey} ${row.grade} ${row.supplier}: final differential ` +
        `${row.diff} does not reconcile to supplier_offers.csv ` +
        `(${row.anchorDiff})`,
    );
  }
  if (!(row.quote > 0)) {
    throw new Error(
      `${row.portKey} ${row.grade} ${row.supplier} ${row.date}: ` +
        `non-positive quote ${row.quote}`,
    );
  }

  const market = `${row.portKey}|${row.grade}|${row.supplier}`;
  marketWeeks.set(market, (marketWeeks.get(market) ?? 0) + 1);
}

if (marketWeeks.size !== offers.length - excluded.length) {
  throw new Error(
    `${marketWeeks.size} supplier-markets emitted from ${offers.length} ` +
      `offers with ${excluded.length} excluded — the counts do not reconcile`,
  );
}

// A handful of dead columns is the data; a flood of them is this script.
const excludedMarkets = new Set(excluded.map((e) => e.split(" (")[0]));
if (excludedMarkets.size > MAX_EXCLUDED_MARKETS) {
  throw new Error(
    `${excludedMarkets.size} port-grade markets fell outside the window — ` +
      "that is a sampling bug, not a data hole",
  );
}

// Parallel lines are the failure this file exists to avoid: if no supplier at a
// market ever changes its standing relative to the benchmark, the chart is a
// stack of identical shapes and tells the desk nothing.
const flat = [];
for (const [market] of marketWeeks) {
  const series = rows.filter(
    (r) => `${r.portKey}|${r.grade}|${r.supplier}` === market,
  );
  const spread =
    Math.max(...series.map((r) => r.diff)) -
    Math.min(...series.map((r) => r.diff));
  if (spread < 1) flat.push(`${market} (${spread.toFixed(2)} $/mt)`);
}
if (flat.length > 0) {
  throw new Error(
    `${flat.length} supplier-market(s) barely move across the year, so the ` +
      `chart would draw them parallel: ${flat.slice(0, 3).join(", ")}`,
  );
}

// --- write -----------------------------------------------------------------

const HEADER = [
  "Date",
  "Port_Code",
  "Grade",
  "Supplier",
  "Quote_USD_Per_MT",
  "Benchmark_USD_Per_MT",
  "Diff_USD_Per_MT",
  "Source_Basis",
  "Data_Notes",
];

const csvCell = (v) => (String(v).includes(",") ? `"${v}"` : String(v));

const lines = [HEADER.join(",")];
for (const row of rows) {
  lines.push(
    [
      row.date,
      row.portKey,
      row.grade,
      csvCell(row.supplier),
      row.quote,
      row.benchmark,
      row.diff,
      "simulated",
      csvCell("Benchmark is real; the supplier spread is not. See data/README.md"),
    ].join(","),
  );
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const weeks = new Set(rows.map((r) => r.date)).size;
console.log(
  `supplier_quote_history.csv: ${rows.length} quotes across ` +
    `${marketWeeks.size} supplier-markets over ${weeks} distinct dates, ` +
    `window ending ${newestDate}`,
);

for (const market of excludedMarkets) {
  console.log(`  excluded: ${market} — no assessment in the trailing year`);
}
