/**
 * Build the EU ETS (EUA) carbon-cost reference table.
 *
 *   node scripts/gen-co2e-cost.mjs
 *
 * Answers "what does a tonne of each fuel grade cost in EU ETS carbon liability,
 * on each date in the fleet's window" — the price a vessel would pay to surrender
 * EUAs (EU Allowances, the traded EU ETS permit) for the CO2e that tonne of fuel
 * emits:
 *
 *   cost($/mt fuel) = eua_price($/t CO2) x CO2e_TtW_MT_Per_MT(grade)
 *
 * Unlike data/pricing/LNG Prices.csv, this is NOT a reconstruction — the anchors
 * in eua_carbon_price_anchors.csv are real published EUA settlement/average prices,
 * used directly and linearly interpolated, not derived from a proxy formula.
 *
 * FLAT, UNSCOPED COST. Real EU ETS shipping rules only count 100% of a voyage's
 * emissions if both port calls are in the EU/EEA, 50% if only one is, and 0% if
 * neither is (the 2024/25/26 40%/70%/100% phase-in is irrelevant here — it is
 * already at 100% throughout this fleet's May-Aug 2026 window). Nothing in this
 * app classifies a port call as EU vs non-EU, so this file deliberately does not
 * either: every column is the un-scoped, 100%-of-emissions cost. Treat it as the
 * ceiling a stem could owe, not a modelled compliance liability.
 *
 * Like data/emissions/CO2_per_mt.csv and energy_per_mt.csv, nothing in src/ reads
 * this file — it is a reference table, not wired into the app.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const EMISSIONS = path.join(process.cwd(), "data", "emissions");
const ANCHORS = path.join(EMISSIONS, "eua_carbon_price_anchors.csv");
const CO2_PER_MT = path.join(EMISSIONS, "CO2_per_mt.csv");
const SPINE = path.join(process.cwd(), "data", "pricing", "VLSFO Prices.csv");
const OUT = path.join(EMISSIONS, "co2e_cost_per_mt.csv");

const WINDOW_START = "2026-05-05";
const WINDOW_END = "2026-08-05";

/**
 * EUA settles in EUR; every other price in this app is USD. A single fixed rate,
 * not a second anchor series — EUR/USD moved under 2% across this window, and a
 * flat documented rate is the same class of simplification CO2_per_mt.csv already
 * uses for its flat +0.049 t/t CH4+N2O uplift.
 *
 * Source: Trading Economics / MTFX, 2026-08-10 close (~1.1547-1.1561): EUR/USD = 1.1550.
 */
const EUR_USD = 1.155;

function parse(file) {
  return Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  }).data;
}

// --- anchors -----------------------------------------------------------------

const anchors = parse(ANCHORS)
  .filter((r) => (r.Date ?? "").trim())
  .map((r, i) => {
    const line = i + 2;
    const eur = Number((r.EUA_Price_EUR_Per_MT_CO2 ?? "").trim());
    if (!Number.isFinite(eur) || eur <= 0) {
      throw new Error(`eua_carbon_price_anchors.csv line ${line}: bad price "${r.EUA_Price_EUR_Per_MT_CO2}"`);
    }
    return { date: r.Date.trim(), eur };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

if (anchors.length < 2) throw new Error("eua_carbon_price_anchors.csv: need at least two anchors");
for (let i = 1; i < anchors.length; i++) {
  if (anchors[i].date === anchors[i - 1].date) {
    throw new Error(`eua_carbon_price_anchors.csv: duplicate anchor at ${anchors[i].date}`);
  }
}
if (WINDOW_START < anchors[0].date || WINDOW_END > anchors[anchors.length - 1].date) {
  throw new Error(
    `window ${WINDOW_START}..${WINDOW_END} falls outside the anchor range ` +
      `${anchors[0].date}..${anchors[anchors.length - 1].date} — extend eua_carbon_price_anchors.csv, ` +
      `don't extrapolate.`,
  );
}

const days = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;

/** EUA price in EUR/t CO2 on a date, linear between the two anchors bracketing it. */
function eurPriceOn(date) {
  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].date > date) {
      lo = anchors[i - 1];
      hi = anchors[i];
      break;
    }
  }
  const span = days(hi.date) - days(lo.date);
  const t = span === 0 ? 0 : (days(date) - days(lo.date)) / span;
  return lo.eur + (hi.eur - lo.eur) * t;
}

// --- CO2e factors per grade ----------------------------------------------------

const grades = parse(CO2_PER_MT)
  .filter((r) => (r.Grade ?? "").trim())
  .map((r) => {
    const factor = Number((r.CO2e_TtW_MT_Per_MT ?? "").trim());
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`CO2_per_mt.csv: bad CO2e_TtW_MT_Per_MT for grade "${r.Grade}"`);
    }
    return { grade: r.Grade.trim(), factor };
  });

if (grades.length === 0) throw new Error("CO2_per_mt.csv: no grade rows found");

// --- emit on the fleet window, daily resolution ---------------------------------

const spineText = fs.readFileSync(SPINE, "utf8");
const eol = spineText.includes("\r\n") ? "\r\n" : "\n";
const trailing = spineText.endsWith(eol) ? eol : "";
const dates = spineText
  .split(eol)
  .filter((l) => l !== "")
  .slice(1)
  .map((l) => l.split(",")[0].trim())
  .filter((d) => d >= WINDOW_START && d <= WINDOW_END)
  .sort();

if (dates.length === 0) throw new Error(`VLSFO Prices.csv carries no dates in ${WINDOW_START}..${WINDOW_END}`);

const format = (n) => String(Math.round(n * 100) / 100);

const header = ["Date", "EUA_Price_USD_Per_MT_CO2", ...grades.map((g) => g.grade)].join(",");
const rows = dates.map((date) => {
  const usd = eurPriceOn(date) * EUR_USD;
  const cells = grades.map((g) => format(usd * g.factor));
  return [date, format(usd), ...cells].join(",");
});

fs.writeFileSync(OUT, [header, ...rows].join(eol) + trailing, "utf8");

console.log(
  `co2e_cost_per_mt.csv: ${grades.length} grade columns, ${rows.length} rows ` +
    `(${WINDOW_START}..${WINDOW_END}), EUR/USD=${EUR_USD}`,
);
