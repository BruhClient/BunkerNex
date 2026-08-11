/**
 * Regenerate the supplier delivery-capability sheet.
 *
 *   node scripts/gen-supplier-fleet.mjs
 *
 * One row per supplier per port: the barge fleet behind the quotes already in
 * supplier_offers.csv, plus a mode-agnostic daily throughput figure.
 *
 * This exists because a quote alone cannot be evaluated. A cheap offer from a
 * supplier who cannot physically deliver the parcel inside the port stay is not
 * the better buy, and nothing in this repo carried delivery capacity before —
 * the closest fields were Pump_Rate_MT_Per_Hour and the Min/Max lifting band.
 *
 * NONE OF THIS IS SOURCED. No barge count, tonnage, age or reliability figure
 * exists in any source document. Two of the 73 suppliers mention barges in the
 * free-text `notes` column of suppliers.csv, narratively and without numbers;
 * everything here is simulated. Anything presenting these figures must say so.
 *
 * The fleet is DERIVED FROM THE OFFERS, not drawn independently: the largest
 * barge is sized off the biggest parcel that supplier already quotes at that
 * port, and throughput off its own pump rate. A supplier quoting a 5,000 MT
 * ceiling with a 800 MT/h hose can never come out with a one-barge fleet that
 * could not lift it. The asserts below are what hold that.
 *
 * Randomness is seeded on `Supplier|Port_Code`, so "random" is stable: the
 * output is reviewable in git and re-running changes nothing. Idempotent.
 *
 * Run order: after gen-supplier-offers.mjs, which writes the input.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data");
const SUPPLIERS = path.join(DATA, "contracts", "suppliers.csv");
const OFFERS = path.join(DATA, "contracts", "supplier_offers.csv");
const OUT = path.join(DATA, "contracts", "supplier_fleet.csv");

/**
 * Barge count band per tier.
 *
 * The shape is the commercial logic, the same reasoning TIER_BAND encodes in
 * gen-supplier-offers.mjs. A global major runs owned tonnage at its core hubs;
 * a trader charters in and holds little of its own; a national refiner on its
 * own doorstep runs a real fleet; the renewable specialists are small and new
 * because the product is.
 */
const TIER_FLEET = {
  1: { count: [4, 9], age: [3, 9], reliability: 97.0 },
  2: { count: [2, 5], age: [7, 15], reliability: 93.5 },
  3: { count: [1, 3], age: [2, 7], reliability: 95.0 },
  4: { count: [2, 6], age: [5, 13], reliability: 94.0 },
};

/**
 * Hours a delivery unit actually pumps in a day.
 *
 * Not 24: a barge has to reposition, connect, sample and cast off between
 * stems. Clause 3.3's 400-800 MT/hour warranty is a pumping rate, not a daily
 * rate, and treating it as the latter would overstate capacity by a third.
 */
const PUMP_HOURS_PER_DAY = 20;

/** Deliveries a supplier can run at once, however many barges it owns. */
const MAX_PARALLEL_DELIVERIES = 3;

// --- seeded randomness -----------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — same generator gen-supplier-offers.mjs uses. */
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

/** Uniform in [lo, hi], snapped to a step. */
function pick(r, lo, hi, step) {
  const raw = lo + r() * (hi - lo);
  return Math.round(raw / step) * step;
}

function pickInt(r, lo, hi) {
  return lo + Math.floor(r() * (hi - lo + 1));
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

function readSupplierTiers() {
  const tiers = new Map();
  for (const [i, row] of parse(SUPPLIERS).rows.entries()) {
    const name = (row.supplier ?? "").trim();
    const tier = Number((row.tier ?? "").trim());
    if (!name) throw new Error(`suppliers.csv line ${i + 2}: blank supplier`);
    if (!TIER_FLEET[tier]) {
      throw new Error(`suppliers.csv line ${i + 2}: unknown tier "${row.tier}"`);
    }
    tiers.set(name, tier);
  }
  return tiers;
}

/**
 * Roll the offer sheet up to one entry per supplier per port.
 *
 * A supplier can quote several grades at one port with different delivery
 * modes and different parcel ceilings; the fleet is one fleet, so the envelope
 * is the max across all of them.
 */
function readOfferEnvelopes(tiers) {
  const byPair = new Map();

  for (const [i, row] of parse(OFFERS).rows.entries()) {
    const line = i + 2;
    const portKey = (row.Port_Code ?? "").trim();
    const supplier = (row.Supplier ?? "").trim();
    const mode = (row.Delivery_Mode ?? "").trim();
    const maxMt = Number((row.Max_Lifting_MT ?? "").trim());
    const pumpRate = Number((row.Pump_Rate_MT_Per_Hour ?? "").trim());
    const availability = (row.Availability ?? "").trim();

    if (!portKey || !supplier) {
      throw new Error(`supplier_offers.csv line ${line}: blank port or supplier`);
    }
    if (!Number.isFinite(maxMt) || !Number.isFinite(pumpRate)) {
      throw new Error(
        `supplier_offers.csv line ${line}: ${supplier} at ${portKey} has a ` +
          "non-numeric Max_Lifting_MT or Pump_Rate_MT_Per_Hour",
      );
    }
    if (!tiers.has(supplier)) {
      throw new Error(
        `supplier_offers.csv line ${line}: "${supplier}" is not in ` +
          "suppliers.csv — the two files have drifted apart",
      );
    }

    const key = `${supplier}|${portKey}`;
    const entry = byPair.get(key) ?? {
      supplier,
      portKey,
      tier: tiers.get(supplier),
      maxParcelMt: 0,
      maxBargeParcelMt: 0,
      maxPumpRate: 0,
      gradeCount: 0,
      hasBarge: false,
      enquireCount: 0,
    };

    entry.maxParcelMt = Math.max(entry.maxParcelMt, maxMt);
    entry.maxPumpRate = Math.max(entry.maxPumpRate, pumpRate);
    entry.gradeCount += 1;
    if (mode === "Barge") {
      entry.hasBarge = true;
      entry.maxBargeParcelMt = Math.max(entry.maxBargeParcelMt, maxMt);
    }
    if (availability === "Enquire") entry.enquireCount += 1;

    byPair.set(key, entry);
  }

  return [...byPair.values()];
}

// --- fleet construction ----------------------------------------------------

function buildFleet(entry) {
  const r = rng(`${entry.supplier}|${entry.portKey}`);
  const band = TIER_FLEET[entry.tier];

  let bargeCount = 0;
  let largestBargeMt = 0;
  let totalCapacityMt = 0;

  if (entry.hasBarge) {
    // The biggest barge must clear the biggest parcel this supplier already
    // quotes on a barge, with headroom — you do not fill a barge to the coaming
    // to make one stem. That relationship is asserted below, not hoped for.
    const headroom = 1.15 + r() * 0.45;
    largestBargeMt = Math.ceil((entry.maxBargeParcelMt * headroom) / 100) * 100;

    // A supplier quoting more grades at a port is running a bigger operation
    // there, so the fleet scales with breadth as well as tier.
    const breadth = entry.gradeCount >= 4 ? 1 : entry.gradeCount >= 2 ? 0 : -1;
    bargeCount = Math.max(
      1,
      pickInt(r, band.count[0], band.count[1]) + breadth,
    );

    // The rest of the fleet is smaller tonnage. Summed rather than averaged so
    // Total >= Largest holds by construction for any count.
    totalCapacityMt = largestBargeMt;
    for (let i = 1; i < bargeCount; i++) {
      totalCapacityMt += Math.round((largestBargeMt * (0.35 + r() * 0.5)) / 50) * 50;
    }
  }

  // Mode-agnostic, so the scatter has a y-value for a shore-only supplier too.
  // A pipeline or ex-wharf berth runs one delivery at a time; a barge fleet
  // runs several, up to the point where the port's own traffic limits it.
  const parallel = entry.hasBarge
    ? Math.min(bargeCount, MAX_PARALLEL_DELIVERIES)
    : 1;
  const deliveryCapacityPerDay =
    Math.round((entry.maxPumpRate * PUMP_HOURS_PER_DAY * parallel) / 100) * 100;

  const avgAgeYears = entry.hasBarge
    ? Math.round(pick(r, band.age[0], band.age[1], 0.1) * 10) / 10
    : 0;

  // Reliability is the tier's base, jittered, then docked where this supplier's
  // own availability column already says it cannot always be prompt. Derived
  // from the offers rather than drawn, so the two never contradict each other.
  const enquirePenalty = (entry.enquireCount / entry.gradeCount) * 3.5;
  const reliability =
    Math.round(
      Math.min(
        99.5,
        Math.max(88, band.reliability + (r() * 3 - 1.5) - enquirePenalty),
      ) * 10,
    ) / 10;

  return {
    ...entry,
    bargeCount,
    largestBargeMt,
    totalCapacityMt,
    deliveryCapacityPerDay,
    avgAgeYears,
    reliability,
  };
}

// --- run -------------------------------------------------------------------

const tiers = readSupplierTiers();
const entries = readOfferEnvelopes(tiers);

const fleet = entries
  .map(buildFleet)
  .sort(
    (a, b) =>
      a.portKey.localeCompare(b.portKey) || a.supplier.localeCompare(b.supplier),
  );

// --- asserts ---------------------------------------------------------------

const seen = new Set();

for (const f of fleet) {
  const key = `${f.supplier}|${f.portKey}`;
  if (seen.has(key)) throw new Error(`duplicate fleet row: ${key}`);
  seen.add(key);

  // The invariant this file exists to hold: a supplier can lift what it quotes.
  if (f.hasBarge && f.largestBargeMt < f.maxBargeParcelMt) {
    throw new Error(
      `${key}: largest barge ${f.largestBargeMt} MT cannot lift the ` +
        `${f.maxBargeParcelMt} MT parcel it quotes`,
    );
  }
  if (f.bargeCount > 0 && f.totalCapacityMt < f.largestBargeMt) {
    throw new Error(
      `${key}: fleet capacity ${f.totalCapacityMt} MT is below its own ` +
        `largest barge (${f.largestBargeMt} MT)`,
    );
  }
  if (f.hasBarge !== f.bargeCount > 0) {
    throw new Error(
      `${key}: quotes barge delivery but has ${f.bargeCount} barges ` +
        "(or the reverse)",
    );
  }
  if (f.deliveryCapacityPerDay <= 0) {
    throw new Error(`${key}: no delivery capacity at all`);
  }
  // A supplier that cannot clear its own parcel ceiling inside a day would
  // never win the business it is quoting for.
  if (f.deliveryCapacityPerDay < f.maxParcelMt) {
    throw new Error(
      `${key}: ${f.deliveryCapacityPerDay} MT/day cannot deliver the ` +
        `${f.maxParcelMt} MT parcel it quotes`,
    );
  }
}

// Every supplier×port in the offer sheet must have exactly one fleet row, or a
// market on the scatter would plot against a missing axis value.
const offerPairs = new Set(entries.map((e) => `${e.supplier}|${e.portKey}`));
for (const key of offerPairs) {
  if (!seen.has(key)) throw new Error(`${key}: quoted but has no fleet row`);
}

// --- write -----------------------------------------------------------------

const HEADER = [
  "Supplier",
  "Port_Code",
  "Tier",
  "Barge_Count",
  "Total_Barge_Capacity_MT",
  "Largest_Barge_MT",
  "Delivery_Capacity_MT_Per_Day",
  "Avg_Barge_Age_Years",
  "Delivery_Reliability_Pct",
  "Source_Basis",
  "Data_Notes",
];

const csvCell = (v) => (String(v).includes(",") ? `"${v}"` : String(v));

const lines = [HEADER.join(",")];
for (const f of fleet) {
  lines.push(
    [
      csvCell(f.supplier),
      f.portKey,
      f.tier,
      f.bargeCount,
      f.totalCapacityMt,
      f.largestBargeMt,
      f.deliveryCapacityPerDay,
      f.avgAgeYears,
      f.reliability,
      "simulated",
      csvCell(
        "Fleet sized from this supplier's own quoted parcel ceiling and pump " +
          "rate; see data/README.md",
      ),
    ].join(","),
  );
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

const shoreOnly = fleet.filter((f) => !f.hasBarge).length;
const ports = new Set(fleet.map((f) => f.portKey)).size;
console.log(
  `supplier_fleet.csv: ${fleet.length} supplier-port fleets across ${ports} ` +
    `ports (${shoreOnly} shore-supplied, no barges)`,
);
