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
 * DEVIATION AMPLITUDE IS SCALED PER MARKET, NOT A FLAT $ RANGE. A flat
 * ~$0.8-5/mt wander (the original figure) is invisible against a benchmark
 * that swings hundreds of dollars over a year — the chart reads as flat lines
 * even though the underlying differential genuinely moves. `targetSpreadFor()`
 * sizes each market's amplitude off two things: 5% of that market's own
 * trailing-year benchmark range (so it scales with how volatile the commodity
 * actually is), floored and capped at a multiple of the supplier's TIER_BAND
 * width (so a Tier 1 major doesn't get scaled into swinging like a trader).
 * Both bounds matter — for the volatile grades (VLSFO/HSFO/MGO) the tier cap
 * binds, since 5% of their range would dwarf what a tier-bounded differential
 * can plausibly do; for calmer/thinner markets the tier floor binds, keeping
 * suppliers visibly distinct even off a quiet benchmark. `scale` (applied to
 * shockScale/swingAmp/yearSlope only — persistence/swingCycles/swingPhase are
 * shape, not amplitude) is `targetSpread / 10`, where 10 $/mt is the
 * approximate midpoint of the original flat-range output — a calibration
 * constant so `scale ≈ 1` reproduces roughly the old behaviour, not a value
 * anything else depends on.
 *
 * deviation(t) is normalised to be EXACTLY ZERO on the last date, so the final
 * row of this file reconciles to the live offer in supplier_offers.csv. That is
 * asserted below. Without it the chart's right-hand edge would disagree with
 * the price the port panel quotes, two screens apart.
 *
 * THIS FILE ALSO CARRIES FORWARD-LOOKING ROWS, tagged
 * `Source_Basis = "simulated-forecast"`. The HQ desk's chart forecasts each
 * supplier's own line 10-30 days out; without per-supplier future data the
 * chart could only add the live benchmark forecast to a flat static offset,
 * which draws every supplier as a parallel copy of the same curve. Each
 * market gets FORECAST_DAYS daily rows continuing from the live offer
 * (`dailyForecastSeries`) — a gentler, slower-reverting daily walk than the
 * historical weekly one, so it still looks like a real (if quiet) forward
 * path rather than noise. `Benchmark_USD_Per_MT` on these rows is a simple
 * linear extension of the trailing benchmark slope (`projectBenchmark`) —
 * it exists only so `Quote = Benchmark + Diff` stays internally consistent in
 * the raw file, and deliberately does not try to match
 * `computeSeasonalForecast` (src/lib/priceForecast.ts), which is what the
 * live chart's own benchmark forecast line actually uses.
 *
 * NONE OF THIS IS SOURCED. No supplier price history exists in any source
 * document. Only the benchmark column underneath is real — and at the 28
 * modelled ports even that is a hub plus a judgment differential, not an
 * assessment. Anything presenting these figures must say so.
 *
 * Randomness is seeded on `Port_Code|Grade|Supplier` (forecast rows additionally
 * on `|forecast`), so the output is stable and reviewable in git. Idempotent.
 *
 * Run order: after gen-supplier-offers.mjs and after any price refresh —
 * the benchmark column is copied in here, so it goes stale exactly the way a
 * modelled price column does. gen-supplier-transactions.mjs runs after this
 * and ignores the `simulated-forecast` rows (filters on Source_Basis).
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
 * Days of forward-looking rows appended after the historical window, per
 * supplier-market. Must stay >= the largest forecast horizon HqDesk.tsx
 * offers (currently 30) — nothing at runtime enforces that coupling, so if
 * the app ever adds a longer horizon this needs to grow too.
 */
const FORECAST_DAYS = 30;

/**
 * A copy of TIER_BAND in gen-supplier-offers.mjs — the flat $/mt range each
 * tier's static differential is drawn from. Used here only for its WIDTH, to
 * bound how far a supplier's weekly/daily wander is allowed to scale: a
 * Tier 1 major anchored around an $11-wide band shouldn't swing like a
 * Tier 3 renewable specialist just because the underlying commodity is
 * volatile. Duplicated rather than imported for the same reason every other
 * cross-script constant here is — .mjs cannot import the TS source, and
 * gen-supplier-offers.mjs is itself a script, not a shared module.
 */
const TIER_BAND_WIDTH = { 1: 11, 2: 12, 3: 45, 4: 11 };

/**
 * scale ≈ 1 reproduces roughly the pre-amplitude-fix output. Not load-bearing
 * anywhere else — see targetSpreadFor() and the file header.
 */
const REFERENCE_SPREAD = 10;

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
    const tier = Number((row.Tier ?? "").trim());

    // A blank differential is not parity, and Number("") is 0. Same rule
    // src/lib/suppliers.ts applies at read time.
    if (!portKey || !grade || !supplier || raw === "") {
      throw new Error(`supplier_offers.csv line ${line}: incomplete offer row`);
    }
    const diff = Number(raw);
    if (!Number.isFinite(diff)) {
      throw new Error(`supplier_offers.csv line ${line}: bad differential`);
    }
    if (!TIER_BAND_WIDTH[tier]) {
      throw new Error(`supplier_offers.csv line ${line}: unknown tier ${tier}`);
    }

    offers.push({ portKey, grade, supplier, diff, tier });
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
 * `scale` sizes the amplitude to the market (see targetSpreadFor and the file
 * header) — applied to shockScale/swingAmp/yearSlope only, since persistence,
 * swingCycles and swingPhase are shape, not magnitude.
 *
 * Normalised so the final element is exactly 0. See the file header.
 */
function deviationSeries(seed, n, scale) {
  const r = rng(seed);

  const shockScale = (0.8 + r() * 2.4) * scale;
  const persistence = 0.62 + r() * 0.24;
  const swingAmp = (0.8 + r() * 4.2) * scale;
  const swingCycles = 0.5 + r() * 1.5;
  const swingPhase = r() * Math.PI * 2;
  const yearSlope = (r() * 2 - 1) * 2.5 * scale;

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

/**
 * How far a market's weekly wander is allowed to swing across the year.
 *
 * 5% of the market's own trailing-year benchmark range, so amplitude scales
 * with how volatile the commodity actually is — floored and capped at a
 * multiple of the supplier's own TIER_BAND width, so a Tier 1 major can't get
 * scaled into swinging like a trader just because e.g. MGO is a volatile
 * grade. See the file header for which bound binds where.
 */
function targetSpreadFor(tier, weekly) {
  const values = weekly.map((p) => p.value);
  const benchmarkRange = Math.max(...values) - Math.min(...values);
  const width = TIER_BAND_WIDTH[tier];
  const raw = benchmarkRange * 0.05;
  return Math.min(Math.max(raw, width * 1.5), width * 4);
}

/**
 * A supplier's forward-looking daily path, continuing from the live offer.
 *
 * Deliberately gentler and slower-reverting than the historical weekly walk
 * (higher persistence, smaller per-step shock) — a 10-30 day forecast should
 * wander less per day than a 52-week history does per week. Starts from
 * anchorDiff (the live offer, i.e. the same value the last historical row
 * already reconciles to) so the dashed line has no opening jump; own seed
 * suffix so the forward path isn't just a mirror of the historical one.
 */
function dailyForecastSeries(seed, days, anchorDiff, targetSpread) {
  const r = rng(`${seed}|forecast`);
  const dailyShock = targetSpread * 0.05;
  const persistence = 0.9 + r() * 0.06;

  let diff = anchorDiff;
  const out = [];
  for (let d = 1; d <= days; d++) {
    diff = anchorDiff + (diff - anchorDiff) * persistence + (r() * 2 - 1) * dailyShock;
    out.push(diff);
  }
  return out;
}

/**
 * A plain linear extension of the trailing benchmark slope, for the
 * forecast rows' Benchmark_USD_Per_MT column.
 *
 * This exists only so Quote = Benchmark + Diff stays consistent within this
 * file — it is NOT what the live chart's benchmark forecast line uses (that
 * is computeSeasonalForecast in src/lib/priceForecast.ts, a materially
 * better model). Deliberately kept simple rather than reimplementing that
 * model here a second time.
 */
function projectBenchmark(weekly, days) {
  const tail = weekly.slice(-8);
  const first = tail[0].value;
  const last = tail[tail.length - 1].value;
  const slopePerWeek = tail.length > 1 ? (last - first) / (tail.length - 1) : 0;
  const slopePerDay = slopePerWeek / 7;

  const out = [];
  for (let d = 1; d <= days; d++) {
    out.push(Math.max(0.01, last + slopePerDay * d));
  }
  return out;
}

/** YYYY-MM-DD, `days` after `date`. */
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- run -------------------------------------------------------------------

const prices = readPriceSeries();
const offers = readOffers();
const rows = [];
const excluded = [];
const targetSpreads = new Map();

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

  const marketKey = `${offer.portKey}|${offer.grade}|${offer.supplier}`;
  const targetSpread = targetSpreadFor(offer.tier, weekly);
  targetSpreads.set(marketKey, targetSpread);
  const scale = targetSpread / REFERENCE_SPREAD;

  const deviation = deviationSeries(marketKey, weekly.length, scale);

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
      sourceBasis: "simulated",
    });
  }

  // Forward-looking rows. Anchored to this market's own last historical date
  // (not the global newestDate) so a market that lags the anchor by a few
  // days — a less-liquid series — still gets true day-1 continuity from its
  // own last point, not a gap or overlap.
  const lastPoint = weekly[weekly.length - 1];
  const forecastDiffs = dailyForecastSeries(
    marketKey,
    FORECAST_DAYS,
    offer.diff,
    targetSpread,
  );
  const forecastBenchmarks = projectBenchmark(weekly, FORECAST_DAYS);

  for (let d = 0; d < FORECAST_DAYS; d++) {
    const diff = Math.round(forecastDiffs[d] * 100) / 100;
    const benchmark = Math.round(forecastBenchmarks[d] * 100) / 100;
    rows.push({
      date: addDays(lastPoint.date, d + 1),
      portKey: offer.portKey,
      grade: offer.grade,
      supplier: offer.supplier,
      quote: Math.round((benchmark + diff) * 100) / 100,
      benchmark,
      diff,
      anchorDiff: offer.diff,
      isLast: false,
      sourceBasis: "simulated-forecast",
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

  // Only historical rows count toward the per-market bookkeeping below —
  // forecast rows are a fixed FORECAST_DAYS per market and checked separately.
  if (row.sourceBasis === "simulated") {
    const market = `${row.portKey}|${row.grade}|${row.supplier}`;
    marketWeeks.set(market, (marketWeeks.get(market) ?? 0) + 1);
  }
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
// stack of identical shapes and tells the desk nothing. Threshold is relative
// to each market's own targetSpread (see targetSpreadFor) rather than a flat
// figure, since amplitude is now tier/volatility-scaled per market. 0.2 rather
// than something closer to 1 because the realised spread of a mean-reverting
// AR(1) + sinusoid is a random variable around targetSpread, not a guarantee —
// a threshold too close to the target itself throws on ordinary variance.
const flat = [];
for (const [market] of marketWeeks) {
  const series = rows.filter(
    (r) =>
      r.sourceBasis === "simulated" &&
      `${r.portKey}|${r.grade}|${r.supplier}` === market,
  );
  const spread =
    Math.max(...series.map((r) => r.diff)) -
    Math.min(...series.map((r) => r.diff));
  const minSpread = targetSpreads.get(market) * 0.2;
  if (spread < minSpread) {
    flat.push(
      `${market} (${spread.toFixed(2)} $/mt, wanted >= ${minSpread.toFixed(2)})`,
    );
  }
}
if (flat.length > 0) {
  throw new Error(
    `${flat.length} supplier-market(s) barely move across the year, so the ` +
      `chart would draw them parallel: ${flat.slice(0, 3).join(", ")}`,
  );
}

// Forecast rows: each surviving market gets exactly FORECAST_DAYS of them,
// starting close to the live offer (a loose bound, not equality — day 1 is
// already one AR(1) step away from the anchor).
const forecastRows = rows.filter((r) => r.sourceBasis === "simulated-forecast");
const forecastCounts = new Map();
for (const row of forecastRows) {
  const market = `${row.portKey}|${row.grade}|${row.supplier}`;
  forecastCounts.set(market, (forecastCounts.get(market) ?? 0) + 1);
}
for (const [market, count] of forecastCounts) {
  if (count !== FORECAST_DAYS) {
    throw new Error(
      `${market}: ${count} forecast rows, expected ${FORECAST_DAYS}`,
    );
  }
}
if (forecastCounts.size !== marketWeeks.size) {
  throw new Error(
    `${forecastCounts.size} markets carry forecast rows but ${marketWeeks.size} ` +
      "carry historical rows — every surviving market needs both",
  );
}
const badContinuity = [];
for (const [market] of forecastCounts) {
  const first = forecastRows.find(
    (r) => `${r.portKey}|${r.grade}|${r.supplier}` === market,
  );
  const bound = targetSpreads.get(market) * 0.15;
  if (Math.abs(first.diff - first.anchorDiff) >= bound) {
    badContinuity.push(market);
  }
}
if (badContinuity.length > 0) {
  throw new Error(
    `${badContinuity.length} market(s) open their forecast too far from the ` +
      `live offer: ${badContinuity.slice(0, 3).join(", ")}`,
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

const HISTORICAL_NOTE =
  "Benchmark is real; the supplier spread is not. See data/README.md";
const FORECAST_NOTE =
  "Illustrative forward continuation, not a quote or a market forecast. " +
  "See data/README.md";

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
      row.sourceBasis,
      csvCell(
        row.sourceBasis === "simulated" ? HISTORICAL_NOTE : FORECAST_NOTE,
      ),
    ].join(","),
  );
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const historicalRows = rows.filter((r) => r.sourceBasis === "simulated");
const weeks = new Set(historicalRows.map((r) => r.date)).size;
console.log(
  `supplier_quote_history.csv: ${historicalRows.length} historical quotes ` +
    `across ${marketWeeks.size} supplier-markets over ${weeks} distinct ` +
    `dates, window ending ${newestDate}; plus ${forecastRows.length} ` +
    `forecast rows (${FORECAST_DAYS}/market across ${forecastCounts.size} ` +
    `markets)`,
);

for (const market of excludedMarkets) {
  console.log(`  excluded: ${market} — no assessment in the trailing year`);
}
