/**
 * Regenerate the bunker transaction ledger.
 *
 *   node scripts/gen-supplier-transactions.mjs
 *
 * What the desk actually paid, per stem: the supplier's quote, the price the
 * contract was signed at, the benchmark on the day, and what a forecast made
 * ten days earlier had said it would be.
 *
 *   Contracted = Quoted - concession(supplier, rounds, parcel)
 *
 * This is the file the whole supplier-evaluation surface rests on. Without it
 * a supplier can only be judged on today's screen price, which answers "who is
 * cheapest to ask" and not "who is cheapest to buy from" — and those are
 * different suppliers whenever one of them negotiates harder than the other.
 *
 * CONCESSION IS A SUPPLIER PROPERTY, NOT A MARKET ONE. The negotiability draw
 * is seeded on the supplier NAME ALONE, so a house that gives ground at
 * Singapore gives comparable ground at Rotterdam. That is what makes the
 * benchmark-vs-contract tile a statement about the counterparty rather than
 * about the port, and it is what the recommendation engine reads.
 *
 * Where the fleet movement series records a real stem inside its own window
 * (2026-05-05 -> 2026-08-05), the vessel name and lifted quantity are taken
 * from it rather than drawn, so the ledger lines up with the bunker log the
 * rest of the app already renders. The remaining ~39 weeks are backfilled.
 *
 * NONE OF THE COMMERCIAL FIGURES ARE SOURCED. data/README.md is explicit that
 * neither contract document carries a price: the MSA is unexecuted with a blank
 * `Price Basis: ____`. No negotiation outcome, concession or award exists in any
 * source. Only the benchmark column and the real stems underneath are real.
 * Anything presenting these figures must say so.
 *
 * Randomness is seeded on `Port_Code|Grade|Supplier` (and the supplier name
 * alone for negotiability), so the output is stable and reviewable in git.
 * Idempotent.
 *
 * Run order: AFTER gen-supplier-quote-history.mjs, which writes the quote and
 * benchmark columns this reads. Running it before will fail on a missing file
 * rather than emit a stale ledger.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data");
const OFFERS = path.join(DATA, "contracts", "supplier_offers.csv");
const HISTORY = path.join(DATA, "contracts", "supplier_quote_history.csv");
const MOVEMENT = path.join(DATA, "vessels", "PIL_Fleet_Live_Movement.csv");
const OUT = path.join(DATA, "contracts", "supplier_transactions.csv");

/** Transactions per supplier-market across the year. */
const TX_PER_MARKET = [8, 20];

/**
 * Every supplier-market must reach this many transactions, or its scorecard
 * tiles would be an average of one or two deals presented as a track record.
 */
const MIN_TX = 6;

/**
 * Weeks of benchmark history a forecast needs behind it before a transaction
 * can carry a Forecast_At_Time figure. The projection below reads back five
 * weeks, so the first five weeks of any market are not eligible.
 */
const FORECAST_WARMUP_WEEKS = 5;

/**
 * How much ground each tier gives, as a fraction of the quoted price.
 *
 * A major discounts least: the premium is the brand, the ISO 8217 assurance and
 * the credit line, and conceding it away defeats the quote. A trader is
 * reselling someone else's cargo on a thin margin but wants the volume, so it
 * moves furthest. The renewable specialists barely move — the product is scarce
 * and they are not competing on price.
 */
const TIER_NEGOTIABILITY = {
  1: [0.002, 0.010],
  2: [0.006, 0.028],
  3: [0.001, 0.006],
  4: [0.004, 0.018],
};

/** Ports whose distillate market is 0.10% LSMGO. Mirrors src/lib/bunkerEvents.ts. */
const LSMGO_PORTS = new Set([
  "CNNGB", "CNNSA", "CNSHA", "CNSHK", "CNTAO", "CNTSN", "CNXMN", "CNYTN",
  "IDSUB", "KRINC", "KRPUS", "MYPKG", "SGSIN", "VNUIH",
  "NLRTM", "BEANR", "DEHAM", "FRLEH", "GBSOU", "GBFXT",
]);

/** Movement-sheet tank column -> the tank it represents. */
const TANK_COLUMNS = [
  ["VLSFO_Bunkered_MT", "VLSFO"],
  ["HSFO_Bunkered_MT", "HSFO"],
  ["MGO_Bunkered_MT", "MGO"],
  ["MEOH_Bunkered_MT", "MEOH"],
  ["LNG_Bunkered_MT", "LNG"],
  ["B40_Bunkered_MT", "B40"],
];

/** The price column a tank's stem is valued against. Mirrors priceSeriesFor(). */
function priceSeriesFor(tank, portCode) {
  if (tank === "MGO") return LSMGO_PORTS.has(portCode) ? "LSMGO" : "MGO";
  return tank;
}

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

function pickInt(r, lo, hi) {
  return lo + Math.floor(r() * (hi - lo + 1));
}

// --- inputs ----------------------------------------------------------------

function parse(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${path.relative(process.cwd(), file)} does not exist — run ` +
        "scripts/gen-supplier-quote-history.mjs first",
    );
  }
  const { data, meta } = Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: (meta.fields ?? []).map((h) => h.trim()), rows: data };
}

/** `Port|Grade|Supplier` -> { tier, minMt, maxMt }. */
function readOffers() {
  const index = new Map();
  for (const [i, row] of parse(OFFERS).rows.entries()) {
    const portKey = (row.Port_Code ?? "").trim();
    const grade = (row.Grade ?? "").trim();
    const supplier = (row.Supplier ?? "").trim();
    const tier = Number((row.Tier ?? "").trim());
    const minMt = Number((row.Min_Lifting_MT ?? "").trim());
    const maxMt = Number((row.Max_Lifting_MT ?? "").trim());

    if (!portKey || !grade || !supplier) {
      throw new Error(`supplier_offers.csv line ${i + 2}: incomplete row`);
    }
    if (!TIER_NEGOTIABILITY[tier]) {
      throw new Error(`supplier_offers.csv line ${i + 2}: unknown tier ${tier}`);
    }
    if (!(minMt < maxMt)) {
      throw new Error(
        `supplier_offers.csv line ${i + 2}: ${minMt}-${maxMt} is not a band`,
      );
    }

    index.set(`${portKey}|${grade}|${supplier}`, { tier, minMt, maxMt });
  }
  return index;
}

/** `Port|Grade|Supplier` -> [{ date, quote, benchmark }] ascending. */
function readQuoteHistory() {
  const index = new Map();
  for (const [i, row] of parse(HISTORY).rows.entries()) {
    const date = (row.Date ?? "").trim();
    const portKey = (row.Port_Code ?? "").trim();
    const grade = (row.Grade ?? "").trim();
    const supplier = (row.Supplier ?? "").trim();
    const quote = Number((row.Quote_USD_Per_MT ?? "").trim());
    const benchmark = Number((row.Benchmark_USD_Per_MT ?? "").trim());

    if (!date || !portKey || !grade || !supplier) {
      throw new Error(`supplier_quote_history.csv line ${i + 2}: incomplete row`);
    }
    if (!Number.isFinite(quote) || !Number.isFinite(benchmark)) {
      throw new Error(
        `supplier_quote_history.csv line ${i + 2}: non-numeric quote/benchmark`,
      );
    }

    const key = `${portKey}|${grade}|${supplier}`;
    const list = index.get(key) ?? [];
    list.push({ date, quote, benchmark });
    index.set(key, list);
  }

  for (const list of index.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return index;
}

/**
 * Real stems from the fleet movement series, indexed `Port|Grade` -> stems.
 *
 * The sheet carries one *_Bunkered_MT column per tank and they are sparse — a
 * handful of non-zero cells per vessel across 744 steps — so this walks every
 * row but keeps almost nothing.
 */
function readRealStems() {
  const byMarket = new Map();
  const vesselsByPort = new Map();

  for (const row of parse(MOVEMENT).rows) {
    const vessel = (row.Vessel_Name ?? "").trim();
    const portCode = (row.Port_Code ?? "").trim();
    const timestamp = (row.Timestamp ?? "").trim();
    if (!vessel || !portCode || !timestamp) continue;

    const date = timestamp.slice(0, 10);

    if (!vesselsByPort.has(portCode)) vesselsByPort.set(portCode, new Set());
    vesselsByPort.get(portCode).add(vessel);

    for (const [column, tank] of TANK_COLUMNS) {
      const raw = (row[column] ?? "").trim();
      if (raw === "" || raw === "0") continue;
      const mt = Number(raw);
      if (!Number.isFinite(mt) || mt <= 0) continue;

      const grade = priceSeriesFor(tank, portCode);
      const key = `${portCode}|${grade}`;
      const list = byMarket.get(key) ?? [];
      list.push({ date, vessel, mt: Math.round(mt) });
      byMarket.set(key, list);
    }
  }

  for (const list of byMarket.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return { byMarket, vesselsByPort };
}

// --- the ledger ------------------------------------------------------------

/**
 * How far this supplier moves off its own quote, as a fraction of it.
 *
 * Seeded on the supplier name alone — see the file header. This is the single
 * most load-bearing draw in the file.
 */
function negotiabilityFor(supplier, tier) {
  const [lo, hi] = TIER_NEGOTIABILITY[tier];
  const r = rng(`negotiability|${supplier}`);
  return lo + r() * (hi - lo);
}

const OUTCOMES = [
  "First offer accepted",
  "Countered once",
  "Matched rival quote",
  "Volume discount agreed",
];

/**
 * What a forecast run ten days before the stem would have projected for it.
 *
 * Deliberately naive and deliberately made from PAST data only: it reads the
 * benchmark as it stood two weeks before, extends the slope of the three weeks
 * before that, and stops. A forecast column built with hindsight would make the
 * desk's forecasting look better than it is, which is the one thing this column
 * exists to measure.
 */
function forecastAtTime(series, i) {
  const base = series[i - 2].benchmark;
  const slopePerWeek = (series[i - 2].benchmark - series[i - 5].benchmark) / 3;
  return Math.round((base + slopePerWeek * 2) * 100) / 100;
}

// --- run -------------------------------------------------------------------

const offers = readOffers();
const history = readQuoteHistory();
const { byMarket: realStems, vesselsByPort } = readRealStems();

const fleetVessels = [...new Set([...vesselsByPort.values()].flatMap((s) => [...s]))].sort();
if (fleetVessels.length === 0) {
  throw new Error("no vessels found in the movement sheet");
}

const transactions = [];

for (const [key, series] of [...history.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const [portKey, grade, supplier] = key.split("|");
  const offer = offers.get(key);
  if (!offer) {
    throw new Error(`${key}: has quote history but no offer row`);
  }

  const eligible = series.length - FORECAST_WARMUP_WEEKS;
  if (eligible < MIN_TX) {
    throw new Error(
      `${key}: only ${eligible} eligible week(s) after the forecast warm-up, ` +
        `need ${MIN_TX}`,
    );
  }

  const r = rng(`tx|${key}`);
  const want = Math.min(pickInt(r, TX_PER_MARKET[0], TX_PER_MARKET[1]), eligible);

  // Choose distinct weeks by shuffling the eligible indices, so a market never
  // draws the same week twice and the count is exact.
  const indices = [];
  for (let i = FORECAST_WARMUP_WEEKS; i < series.length; i++) indices.push(i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const chosen = indices.slice(0, want).sort((a, b) => a - b);

  const negotiability = negotiabilityFor(supplier, offer.tier);
  const stems = realStems.get(`${portKey}|${grade}`) ?? [];
  const portVessels = [...(vesselsByPort.get(portKey) ?? [])].sort();

  for (const i of chosen) {
    const point = series[i];
    const t = rng(`${key}|${point.date}`);

    // Prefer a real stem within a week of this date: same port, same grade,
    // actually recorded in the movement series.
    const match = stems.find((s) => {
      const gap = Math.abs(Date.parse(s.date) - Date.parse(point.date));
      return gap <= 7 * 86400000;
    });

    let vessel;
    let quantityMt;
    let basis;

    if (match) {
      vessel = match.vessel;
      // Still has to be a parcel this supplier would quote for.
      quantityMt = Math.min(Math.max(match.mt, offer.minMt), offer.maxMt);
      basis = "fleet stem";
    } else {
      const pool = portVessels.length > 0 ? portVessels : fleetVessels;
      vessel = pool[Math.floor(t() * pool.length)];
      quantityMt =
        Math.round((offer.minMt + t() * (offer.maxMt - offer.minMt)) / 50) * 50;
      quantityMt = Math.min(Math.max(quantityMt, offer.minMt), offer.maxMt);
      basis = "backfilled";
    }

    // A bigger parcel is worth more rounds of haggling, and earns more of the
    // supplier's available ground.
    const parcelShare = (quantityMt - offer.minMt) / (offer.maxMt - offer.minMt);
    const rounds = Math.min(4, 1 + Math.floor(t() * 2 + parcelShare * 2));
    const concessionRate = negotiability * (0.45 + rounds * 0.22) * (0.8 + t() * 0.4);

    const quoted = point.quote;
    const contracted = Math.round(quoted * (1 - concessionRate) * 100) / 100;

    transactions.push({
      date: point.date,
      portKey,
      grade,
      supplier,
      vessel,
      quantityMt,
      quoted,
      contracted,
      benchmark: point.benchmark,
      forecast: forecastAtTime(series, i),
      rounds,
      outcome: OUTCOMES[rounds - 1],
      basis,
    });
  }
}

transactions.sort(
  (a, b) =>
    a.portKey.localeCompare(b.portKey) ||
    a.grade.localeCompare(b.grade) ||
    a.supplier.localeCompare(b.supplier) ||
    a.date.localeCompare(b.date),
);

// --- asserts ---------------------------------------------------------------

const seen = new Set();
const byMarket = new Map();

for (const tx of transactions) {
  const key = `${tx.portKey}|${tx.grade}|${tx.supplier}`;
  const dedupe = `${key}|${tx.date}`;
  if (seen.has(dedupe)) throw new Error(`duplicate transaction: ${dedupe}`);
  seen.add(dedupe);

  // The desk never signs above the quote. If this ever fails, the concession
  // model has gone negative and every variance tile inverts.
  if (tx.contracted > tx.quoted) {
    throw new Error(
      `${dedupe}: contracted ${tx.contracted} exceeds quoted ${tx.quoted}`,
    );
  }
  if (!(tx.contracted > 0) || !(tx.quoted > 0) || !(tx.benchmark > 0)) {
    throw new Error(`${dedupe}: non-positive price on the ledger`);
  }

  const offer = offers.get(key);
  if (tx.quantityMt < offer.minMt || tx.quantityMt > offer.maxMt) {
    throw new Error(
      `${dedupe}: ${tx.quantityMt} MT is outside ${tx.supplier}'s ` +
        `${offer.minMt}-${offer.maxMt} MT band`,
    );
  }

  byMarket.set(key, (byMarket.get(key) ?? 0) + 1);
}

for (const [key, count] of byMarket) {
  if (count < MIN_TX) {
    throw new Error(`${key}: ${count} transaction(s), need ${MIN_TX}`);
  }
}

if (byMarket.size !== history.size) {
  throw new Error(
    `${byMarket.size} markets on the ledger from ${history.size} in the quote ` +
      "history — every quoted market should trade",
  );
}

// The concession must actually separate suppliers, or the tile it feeds ranks
// everyone equally and the recommendation has nothing to say.
const bySupplier = new Map();
for (const tx of transactions) {
  const saving = (tx.quoted - tx.contracted) / tx.quoted;
  const entry = bySupplier.get(tx.supplier) ?? { sum: 0, n: 0 };
  entry.sum += saving;
  entry.n += 1;
  bySupplier.set(tx.supplier, entry);
}
const rates = [...bySupplier.values()].map((e) => e.sum / e.n);
const spread = Math.max(...rates) - Math.min(...rates);
if (spread < 0.005) {
  throw new Error(
    `every supplier concedes within ${(spread * 100).toFixed(2)}% of every ` +
      "other — the negotiation tile would not discriminate",
  );
}

// --- write -----------------------------------------------------------------

const HEADER = [
  "Date",
  "Port_Code",
  "Grade",
  "Supplier",
  "Vessel",
  "Quantity_MT",
  "Quoted_USD_Per_MT",
  "Contracted_USD_Per_MT",
  "Benchmark_USD_Per_MT",
  "Forecast_At_Time_USD_Per_MT",
  "Negotiation_Rounds",
  "Outcome",
  "Source_Basis",
  "Data_Notes",
];

const csvCell = (v) => (String(v).includes(",") ? `"${v}"` : String(v));

const lines = [HEADER.join(",")];
for (const tx of transactions) {
  lines.push(
    [
      tx.date,
      tx.portKey,
      tx.grade,
      csvCell(tx.supplier),
      csvCell(tx.vessel),
      tx.quantityMt,
      tx.quoted,
      tx.contracted,
      tx.benchmark,
      tx.forecast,
      tx.rounds,
      csvCell(tx.outcome),
      tx.basis === "fleet stem" ? "simulated (fleet stem)" : "simulated",
      csvCell(
        tx.basis === "fleet stem"
          ? "Vessel and quantity from PIL_Fleet_Live_Movement.csv; all " +
              "commercial figures simulated. See data/README.md"
          : "Backfilled outside the fleet movement window; all figures " +
              "simulated. See data/README.md",
      ),
    ].join(","),
  );
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const fromStems = transactions.filter((t) => t.basis === "fleet stem").length;
console.log(
  `supplier_transactions.csv: ${transactions.length} transactions across ` +
    `${byMarket.size} supplier-markets (${fromStems} anchored to a real ` +
    `fleet stem), supplier concession spread ${(spread * 100).toFixed(2)}%`,
);
