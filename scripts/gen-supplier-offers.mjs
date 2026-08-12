/**
 * Regenerate the supplier offer sheet.
 *
 *   node scripts/gen-supplier-offers.mjs
 *
 * Every port with a price series is a marketplace. This script gives each of
 * its fuel types a panel of suppliers quoting against the baseline:
 *
 *   offer(port, grade, supplier) = baseline(port, grade) + Offer_Basis_USD_Per_MT
 *
 * Only the differential is stored. The baseline is resolved at read time by
 * src/lib/suppliers.ts, so unlike the modelled price columns these figures do
 * not go stale when data/pricing/ is refreshed — there is nothing to re-run.
 *
 * NONE OF THIS IS SOURCED. The PIL supplier list carries no prices, no ports
 * and no grades (see data/README.md), so every differential and every delivery
 * term here is simulated. Only the roster and the tiering in suppliers.csv come
 * from the source document, and half those rows were added too. Anything
 * presenting these numbers must say so.
 *
 * Randomness is seeded on `Port_Code|Grade|Supplier`, so "random" is stable:
 * the output is reviewable in git and re-running changes nothing. Idempotent.
 *
 * A per-market floor (MIN_OFFERS) does not guarantee roster-wide coverage: a
 * supplier with few eligible markets, or one that only ever competes in a
 * crowded one, can legitimately lose every draw it is eligible for. A GUARANTEE
 * PASS runs after the normal per-market selection and appends any supplier who
 * won zero panels anywhere into the single eligible market where its own
 * (seeded, deterministic) rank score was best — growing that one panel past the
 * usual 3-5 cap rather than evicting anyone. See the pass itself, below the main
 * loop, for why appending beats eviction here.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data");
const PRICING = path.join(DATA, "pricing");
const SUPPLIERS = path.join(DATA, "contracts", "suppliers.csv");
const OUT = path.join(DATA, "contracts", "supplier_offers.csv");

/** Every port×grade pair must reach at least this many suppliers. */
const MIN_OFFERS = 3;

/**
 * The price sheets, and the grade suffixes to split their headers on.
 *
 * Mirrors PRICE_FILES and GRADE_SUFFIXES in src/lib/prices.ts — longest suffix
 * first, so "MEOH VLSFOe" is never read as a plain VLSFO column. Scripts are
 * .mjs and cannot import the TypeScript source, so this is a deliberate copy;
 * the alias check below is what catches the two drifting apart.
 */
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

/**
 * Grades a supplier can quote.
 *
 * MEOH_VLSFOe and MEOH_MGOe are deliberately absent: they are the same physical
 * methanol restated in VLSFO- and MGO-equivalent energy terms, so quoting them
 * as separate fuel types would triple-count one market.
 */
const OFFER_GRADES = ["VLSFO", "HSFO", "MGO", "MDO", "LNG", "B24", "B40", "MEOH"];

/** Display order, matching GRADE_ORDER in src/lib/colors.ts. */
const GRADE_ORDER = ["VLSFO", "HSFO", "MGO", "MDO", "LNG", "B24", "B40", "MEOH"];

/**
 * The alternative fuels, which tier 3 is scoped to.
 *
 * Widened from methanol alone when the CE sheet brought biofuel in as a real
 * grade. The reasoning is unchanged: a certified renewable blend is not a
 * like-for-like quote against a fossil grade, so the specialists quote these and
 * nothing else. LNG is absent deliberately: it is a fossil fuel, and the majors
 * and state refiners who run the bunkering infrastructure quote it, not the
 * renewable specialists.
 */
const ALTERNATIVE_GRADES = new Set(["MEOH", "B24", "B40"]);

/**
 * Column prefix -> LOCODE. A copy of PRICE_PORT_ALIASES in src/lib/ports.ts,
 * including the source's misspellings (ROTERDAM, NORFORK, STPETERS). An unknown
 * prefix throws rather than being skipped: silently dropping a column here
 * would silently drop a whole marketplace.
 */
const PORT_ALIASES = {
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

  // Five more modelled ports added with the Asia-Europe services. Mirrors
  // PRICE_PORT_ALIASES in src/lib/ports.ts.
  LEHAVRE: "FRLEH",
  SOUTHAMPTON: "GBSOU",
  FELIXSTOWE: "GBFXT",
  PORTSAID: "EGPSD",
  VALENCIA: "ESVLC",
};

/**
 * Differential band per tier, in $/mt against the port baseline.
 *
 * The shape is the commercial logic: a major charges for brand, ISO 8217
 * assurance and long credit; a trader competes on price because it is reselling
 * someone else's cargo; a national refiner on its own doorstep can go under the
 * assessment; certified renewable methanol is simply a more expensive product
 * and is not a like-for-like quote against a fossil grade.
 */
const TIER_BAND = {
  1: [3, 14],
  2: [-8, 4],
  3: [15, 60],
  4: [-6, 5],
};

/**
 * Selection bias per tier. Lower sorts first, so the local physical refiner is
 * the likeliest name in any panel and the pure traders fill in behind it.
 */
const TIER_WEIGHT = {
  1: -0.15,
  2: 0,
  3: -0.5,
  4: -0.35,
};

/** Tiers that hold product rather than reselling it. */
const PHYSICAL_TIERS = new Set([1, 3, 4]);

/**
 * Below this many eligible suppliers a market is thin: quotes there are
 * indicative rather than prompt, and a barge takes longer to arrange. Derived
 * from the roster rather than a hardcoded port list, so it stays true when
 * coverage changes.
 */
const THIN_MARKET_THRESHOLD = 6;

// --- seeded randomness -----------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, and good enough for presentation data. */
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

/** Uniform in [lo, hi], snapped to a step — no offer quotes 3.7418 $/mt. */
function pick(r, lo, hi, step) {
  const raw = lo + r() * (hi - lo);
  return Math.round(raw / step) * step;
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

/**
 * Which fuel types each port actually has a series for.
 *
 * A column of nothing but blanks is not a market, so a pair only counts if at
 * least one cell carries a number — the same rule trimNulls applies at runtime.
 */
function readPriceCoverage() {
  /** portKey -> Set<grade> */
  const coverage = new Map();

  for (const file of PRICE_FILES) {
    const { headers, rows } = parse(path.join(PRICING, file));

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

      if (!OFFER_GRADES.includes(grade)) continue;

      const priced = rows.some((row) => {
        const raw = (row[header] ?? "").trim();
        return raw !== "" && Number.isFinite(Number(raw));
      });
      if (!priced) continue;

      if (!coverage.has(portKey)) coverage.set(portKey, new Set());
      coverage.get(portKey).add(grade);
    }
  }

  return coverage;
}

function readSuppliers(coverage) {
  const { rows } = parse(SUPPLIERS);

  return rows.map((row, i) => {
    const line = i + 2;
    const name = (row.supplier ?? "").trim();
    if (!name) throw new Error(`suppliers.csv line ${line}: blank supplier`);

    const tier = Number((row.tier ?? "").trim());
    if (!TIER_BAND[tier]) {
      throw new Error(`suppliers.csv line ${line}: unknown tier "${row.tier}"`);
    }

    const split = (cell) =>
      (cell ?? "")
        .split(";")
        .map((v) => v.trim())
        .filter(Boolean);

    const ports = split(row.ports);
    const grades = split(row.grades);

    if (ports.length === 0) {
      throw new Error(`suppliers.csv line ${line}: ${name} has no ports`);
    }
    if (grades.length === 0) {
      throw new Error(`suppliers.csv line ${line}: ${name} has no grades`);
    }

    // A LOCODE nobody prices is a typo, not a market this supplier reaches.
    for (const port of ports) {
      if (!coverage.has(port)) {
        throw new Error(
          `suppliers.csv line ${line}: ${name} lists "${port}", which has no ` +
            "price series in data/pricing/",
        );
      }
    }
    for (const grade of grades) {
      if (!OFFER_GRADES.includes(grade)) {
        throw new Error(
          `suppliers.csv line ${line}: ${name} lists unknown grade "${grade}"`,
        );
      }
    }

    return {
      name,
      tier,
      tierLabel: (row.tier_label ?? "").trim(),
      ports: new Set(ports),
      grades: new Set(grades),
    };
  });
}

// --- offer construction ----------------------------------------------------

function buildOffer(portKey, grade, supplier, thin) {
  const r = rng(`${portKey}|${grade}|${supplier.name}`);
  const { tier } = supplier;

  // Mode first: ex-wharf carries no barge cost, so it discounts the quote.
  const m = r();
  const mode =
    tier === 3
      ? "Barge"
      : tier === 1
        ? m < 0.75
          ? "Barge"
          : m < 0.95
            ? "Ex-wharf"
            : "Pipeline"
        : tier === 2
          ? m < 0.8
            ? "Barge"
            : "Ex-wharf"
          : m < 0.55
            ? "Barge"
            : m < 0.9
              ? "Ex-wharf"
              : "Pipeline";

  const [lo, hi] = TIER_BAND[tier];
  const basis =
    Math.round((lo + r() * (hi - lo) - (mode === "Ex-wharf" ? 1.5 : 0)) * 2) / 2;

  const range =
    tier === 1
      ? [100, pick(r, 4000, 6000, 500)]
      : tier === 2
        ? [100, pick(r, 2000, 4000, 500)]
        : tier === 3
          ? [100, pick(r, 800, 1500, 100)]
          : [100, pick(r, 1500, 3000, 500)];

  // Clause 3.3 warrants 400-800 MT/hour. A shore line beats a barge hose.
  const pumpRate =
    mode === "Barge" ? pick(r, 400, 700, 25) : pick(r, 600, 800, 25);

  const a = r();
  const availability = thin
    ? a < 0.35
      ? "Prompt"
      : a < 0.7
        ? "5 days"
        : "Enquire"
    : a < 0.8
      ? "Prompt"
      : a < 0.95
        ? "5 days"
        : "Enquire";

  return {
    portKey,
    grade,
    supplier: supplier.name,
    tier,
    basis,
    mode,
    minMt: range[0],
    maxMt: range[1],
    // Clause 1.2(b) puts firm nomination 5-10 working days out; a thin market
    // needs longer still because the barge comes from somewhere else.
    leadTimeDays: 3 + Math.floor(r() * 5) + (thin ? 2 : 0),
    // Credit is what the premium buys. Derived from the differential rather
    // than drawn, so the two never contradict each other.
    paymentTermsDays: basis >= 6 ? 45 : basis >= 0 ? 30 : 15,
    pumpRate,
    availability,
  };
}

/**
 * The panel quoting one port×grade: 3-5 names, local physical first.
 *
 * Returns `ranked` too — the guarantee pass below re-uses it (same eligible set,
 * same rank scores) rather than recomputing eligibility from scratch.
 */
function selectPanel(portKey, grade, suppliers) {
  const eligible = suppliers.filter(
    (s) => s.ports.has(portKey) && s.grades.has(grade),
  );

  if (eligible.length < MIN_OFFERS) {
    throw new Error(
      `${portKey} ${grade}: only ${eligible.length} eligible supplier(s), ` +
        `need ${MIN_OFFERS}. Widen a supplier's ports or grades in ` +
        "data/contracts/suppliers.csv",
    );
  }

  const ranked = eligible
    .map((s) => ({
      supplier: s,
      rank: rng(`rank|${portKey}|${grade}|${s.name}`)() + TIER_WEIGHT[s.tier],
    }))
    .sort(
      (a, b) => a.rank - b.rank || a.supplier.name.localeCompare(b.supplier.name),
    );

  const u = rng(`size|${portKey}|${grade}`)();
  const n = Math.min(u < 0.45 ? 3 : u < 0.8 ? 4 : 5, ranked.length);
  const picked = ranked.slice(0, n).map((e) => e.supplier);

  // A market of nothing but resellers reads wrong — somebody has to own the
  // product. Swap the weakest pick for the best-ranked physical if none made it.
  if (!picked.some((s) => PHYSICAL_TIERS.has(s.tier))) {
    const physical = ranked.find((e) => PHYSICAL_TIERS.has(e.supplier.tier));
    if (physical) picked[picked.length - 1] = physical.supplier;
  }

  return { picked, ranked, eligibleCount: eligible.length };
}

// --- selection ---------------------------------------------------------------

const coverage = readPriceCoverage();
const suppliers = readSuppliers(coverage);

/** `port|grade` -> { portKey, grade, picked: Supplier[], ranked, eligibleCount } */
const panels = new Map();
const globalCount = new Map();

for (const portKey of [...coverage.keys()].sort()) {
  const grades = [...coverage.get(portKey)].sort(
    (a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b),
  );

  for (const grade of grades) {
    const { picked, ranked, eligibleCount } = selectPanel(portKey, grade, suppliers);
    panels.set(`${portKey}|${grade}`, { portKey, grade, picked, ranked, eligibleCount });
    for (const s of picked) {
      globalCount.set(s.name, (globalCount.get(s.name) ?? 0) + 1);
    }
  }
}

/**
 * Guarantee pass: every roster supplier must win at least one panel.
 *
 * A supplier that wins zero of its eligible markets never appears in
 * supplier_offers.csv, and since supplier_fleet.csv / supplier_quote_history.csv /
 * supplier_transactions.csv are all derived purely from that file, it never
 * appears in any of them either — a roster entry with no quote, no fleet row and
 * no transaction, which reads as a data bug rather than a quiet loser.
 *
 * For each such supplier, find its best-ranked eligible pair — reusing the
 * `ranked` list selectPanel() already computed there, so this is the exact same
 * rank score, not a recomputation that could drift — and APPEND it to that
 * panel's picks. Appending rather than evicting means no other supplier's
 * coverage is put at risk chasing this fix: the panel simply grows past its
 * usual 3-5 cap for that one market.
 */
const uncovered = suppliers
  .map((s) => {
    const pairs = [];
    for (const port of s.ports) {
      const grades = coverage.get(port);
      if (!grades) continue;
      for (const grade of s.grades) {
        if (grades.has(grade)) pairs.push(`${port}|${grade}`);
      }
    }
    return { supplier: s, pairs };
  })
  .filter(({ supplier }) => (globalCount.get(supplier.name) ?? 0) === 0)
  // Most-constrained first: not load-bearing today (no two of the fixed
  // suppliers land on the same pair), but keeps the pass well-defined if the
  // roster grows and a future collision becomes possible.
  .sort(
    (a, b) =>
      a.pairs.length - b.pairs.length ||
      a.supplier.name.localeCompare(b.supplier.name),
  );

for (const { supplier, pairs } of uncovered) {
  if (pairs.length === 0) {
    throw new Error(
      `${supplier.name}: has no port×grade pair with a price series to be ` +
        "quoted in at all — check its ports/grades in suppliers.csv",
    );
  }

  let best = null;
  for (const pair of pairs) {
    const entry = panels.get(pair).ranked.find((e) => e.supplier === supplier);
    if (!best || entry.rank < best.rank) best = { pair, rank: entry.rank };
  }

  panels.get(best.pair).picked.push(supplier);
  globalCount.set(supplier.name, (globalCount.get(supplier.name) ?? 0) + 1);
}

// --- offer construction ------------------------------------------------------

const offers = [];
for (const { portKey, grade, picked, eligibleCount } of panels.values()) {
  const thin = eligibleCount < THIN_MARKET_THRESHOLD;

  const panel = picked.map((s) => buildOffer(portKey, grade, s, thin));
  panel.sort((a, b) => a.basis - b.basis || a.supplier.localeCompare(b.supplier));
  offers.push(...panel);
}

// --- asserts ---------------------------------------------------------------

const seen = new Set();
const byPair = new Map();

for (const o of offers) {
  const key = `${o.portKey}|${o.grade}|${o.supplier}`;
  if (seen.has(key)) throw new Error(`duplicate offer: ${key}`);
  seen.add(key);

  if (!coverage.get(o.portKey)?.has(o.grade)) {
    throw new Error(`${o.portKey} has no ${o.grade} series to quote against`);
  }
  if (o.tier === 3 && !ALTERNATIVE_GRADES.has(o.grade)) {
    throw new Error(
      `${o.supplier} quotes ${o.grade} at ${o.portKey}: tier 3 is ` +
        "alternative fuels only (methanol and biofuel)",
    );
  }
  if (o.minMt >= o.maxMt) {
    throw new Error(
      `${key}: lifting range ${o.minMt}-${o.maxMt} is not a range`,
    );
  }

  const pair = `${o.portKey}|${o.grade}`;
  byPair.set(pair, (byPair.get(pair) ?? 0) + 1);
}

for (const [pair, count] of byPair) {
  if (count < MIN_OFFERS) {
    throw new Error(`${pair}: ${count} offer(s), need ${MIN_OFFERS}`);
  }
}

for (const [portKey, grades] of coverage) {
  for (const grade of grades) {
    if (!byPair.has(`${portKey}|${grade}`)) {
      throw new Error(`${portKey} ${grade} has a price series but no offers`);
    }
  }
}

// The guarantee pass exists to make this true. Check it against the actual
// written offers, not just the in-memory panels, in case the two ever drift.
const quotingSuppliers = new Set(offers.map((o) => o.supplier));
for (const s of suppliers) {
  if (!quotingSuppliers.has(s.name)) {
    throw new Error(`${s.name}: still has zero offers after the guarantee pass`);
  }
}

// --- write -----------------------------------------------------------------

const HEADER = [
  "Port_Code",
  "Grade",
  "Supplier",
  "Tier",
  "Offer_Basis_USD_Per_MT",
  "Delivery_Mode",
  "Min_Lifting_MT",
  "Max_Lifting_MT",
  "Lead_Time_Days",
  "Payment_Terms_Days",
  "Pump_Rate_MT_Per_Hour",
  "Availability",
  "Source_Basis",
  "Data_Notes",
];

/** Match the pricing sheets: no trailing ".0" on a whole number. */
const format = (n) => String(Math.round(n * 100) / 100);

const lines = [HEADER.join(",")];
for (const o of offers) {
  lines.push(
    [
      o.portKey,
      o.grade,
      o.supplier.includes(",") ? `"${o.supplier}"` : o.supplier,
      o.tier,
      format(o.basis),
      o.mode,
      o.minMt,
      o.maxMt,
      o.leadTimeDays,
      o.paymentTermsDays,
      o.pumpRate,
      o.availability,
      "simulated",
      "Differential against the port baseline; see data/README.md",
    ].join(","),
  );
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const atFloor = [...byPair.values()].filter((c) => c === MIN_OFFERS).length;
console.log(
  `supplier_offers.csv: ${offers.length} offers across ${byPair.size} ` +
    `port-grade markets in ${coverage.size} ports ` +
    `(${atFloor} at the ${MIN_OFFERS}-supplier floor, ${suppliers.length} of ` +
    `${suppliers.length} suppliers quoting somewhere)`,
);
if (uncovered.length > 0) {
  console.log(
    `  guarantee pass: ${uncovered.length} supplier(s) won zero panels by draw, ` +
      "appended to their best-ranked eligible market:",
  );
  for (const { supplier, pairs } of uncovered) {
    const entry = pairs
      .map((pair) => ({
        pair,
        rank: panels.get(pair).ranked.find((e) => e.supplier === supplier).rank,
      }))
      .sort((a, b) => a.rank - b.rank)[0];
    console.log(`    ${supplier.name} -> ${entry.pair}`);
  }
}
