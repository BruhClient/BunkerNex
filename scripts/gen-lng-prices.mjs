/**
 * Build the Singapore LNG bunker hub series.
 *
 *   node scripts/gen-lng-prices.mjs
 *
 * RUN THIS BEFORE gen-modelled-prices.mjs. It writes the hub column the four
 * modelled LNG ports are computed against; without it that script throws.
 *
 * Every other grade in data/pricing/ starts from an assessed daily series in the
 * source workbook. LNG has none — the workbook carries no gas column at all, and
 * LNG does not track Brent, the only benchmark here. So this hub is reconstructed
 * from published JKM assessments:
 *
 *   singapore_lng($/mt) = (JKM($/MMBtu) + delivery_premium($/MMBtu)) * MMBTU_PER_TONNE
 *
 * The anchors, with their sources, are in data/pricing/lng_anchors.csv.
 *
 * THIS IS A RECONSTRUCTION, NOT AN ASSESSMENT, and it is the only series in
 * data/pricing/ that is. Three things keep it honest, and all three should stay:
 *
 *   1. MONTHLY RESOLUTION. Values are held flat within a calendar month, so the
 *      chart draws a staircase. A real gas curve is violently volatile day to
 *      day; a smooth daily line here would claim a precision the anchors cannot
 *      support. The staircase is the tell, and it is deliberate.
 *   2. IT STARTS WHERE THE EVIDENCE STARTS. No value before the first anchor in
 *      September 2021 — earlier dates are blank, not extrapolated. LNG bunkering
 *      at these ports barely existed before then, so the leading blank is a fact
 *      about the market as much as about the data.
 *   3. IT IS CHECKED AGAINST AN INDEPENDENT PUBLISHED FIGURE. See VALIDATION.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data", "pricing");
const ANCHORS = path.join(DATA, "lng_anchors.csv");
const SPINE = path.join(DATA, "VLSFO Prices.csv");
const OUT = path.join(DATA, "LNG Prices.csv");

const COLUMN = "SINGAPORE LNG";

/**
 * Energy content of one tonne of LNG.
 *
 * Not an assumption — arithmetic, from two independently published pairs in the
 * anchor file: 736/mt at 14.16/MMBtu (Jan 2025) gives 51.98, and 1,144/mt at
 * 22.00/MMBtu (Aug 2026) gives 52.00. Both round to 52.
 */
const MMBTU_PER_TONNE = 52;

/**
 * An independent published figure the anchors are NOT fitted to.
 *
 * Platts assessed the Singapore LNG bunker price at 14.274/MMBtu across 2024,
 * which is 742.25/mt at 52 MMBtu/t. No anchor is derived from it, so if the
 * reconstruction lands near it the shape is broadly right, and the run fails if
 * it does not.
 *
 * The obvious alternative check — Platts' 2026 yearly base rate of 783.42/mt for
 * October 2024 to September 2025 — is unavailable for this: it is now the source
 * of the 2025-04-01 anchor, so checking against it would only prove arithmetic.
 * It earned that promotion by catching a real error. Without a 2025 anchor the
 * series ramped straight from January 2025 to April 2026 and came out 13.3%
 * above the published average; the check is what surfaced it.
 */
const VALIDATION = {
  from: "2024-01-01",
  to: "2024-12-31",
  usdPerMt: 742.25,
  tolerance: 0.05,
  source: "Platts Singapore LNG bunker, 2024 average of 14.274/MMBtu",
};

function parse(file) {
  return Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  }).data;
}

// --- anchors ---------------------------------------------------------------

const anchors = parse(ANCHORS)
  .filter((r) => (r.Date ?? "").trim())
  .map((r, i) => {
    const line = i + 2;
    const jkm = Number((r.JKM_USD_Per_MMBtu ?? "").trim());
    const premium = Number((r.Bunker_Premium_USD_Per_MMBtu ?? "").trim());
    if (!Number.isFinite(jkm) || jkm <= 0) {
      throw new Error(`lng_anchors.csv line ${line}: bad JKM "${r.JKM_USD_Per_MMBtu}"`);
    }
    if (!Number.isFinite(premium)) {
      throw new Error(`lng_anchors.csv line ${line}: bad premium`);
    }
    return { date: r.Date.trim(), jkm, premium };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

if (anchors.length < 2) throw new Error("lng_anchors.csv: need at least two anchors");
for (let i = 1; i < anchors.length; i++) {
  if (anchors[i].date === anchors[i - 1].date) {
    throw new Error(`lng_anchors.csv: duplicate anchor at ${anchors[i].date}`);
  }
}

const days = (d) => Date.parse(`${d}T00:00:00Z`) / 86400000;

/**
 * JKM and the delivery premium on a date, linear between the two anchors
 * bracketing it. Before the first anchor: nothing. After the last: held flat,
 * because the window ends two days later and extrapolating a gas curve past its
 * final observation is the kind of invention this file exists to avoid.
 */
function priceOn(date) {
  if (date < anchors[0].date) return null;
  const last = anchors[anchors.length - 1];
  if (date >= last.date) return (last.jkm + last.premium) * MMBTU_PER_TONNE;

  let lo = anchors[0];
  let hi = last;
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].date > date) {
      lo = anchors[i - 1];
      hi = anchors[i];
      break;
    }
  }
  const span = days(hi.date) - days(lo.date);
  const t = span === 0 ? 0 : (days(date) - days(lo.date)) / span;
  const jkm = lo.jkm + (hi.jkm - lo.jkm) * t;
  const premium = lo.premium + (hi.premium - lo.premium) * t;
  return (jkm + premium) * MMBTU_PER_TONNE;
}

// --- emit on the shared date spine, at monthly resolution ------------------

const spineText = fs.readFileSync(SPINE, "utf8");
const eol = spineText.includes("\r\n") ? "\r\n" : "\n";
const trailing = spineText.endsWith(eol) ? eol : "";
const dates = spineText
  .split(eol)
  .filter((l) => l !== "")
  .slice(1)
  .map((l) => l.split(",")[0].trim())
  .filter(Boolean);

// One value per calendar month, taken at its first day and held across every
// date in that month. This is what makes the series read as monthly.
const byMonth = new Map();
for (const date of dates) {
  const month = date.slice(0, 7);
  if (!byMonth.has(month)) byMonth.set(month, priceOn(`${month}-01`));
}

const format = (n) => String(Math.round(n * 100) / 100);
const rows = dates.map((date) => {
  const v = byMonth.get(date.slice(0, 7));
  return `${date},${v === null ? "" : format(v)}`;
});

// --- validate against the held-back figure ---------------------------------

let sum = 0;
let n = 0;
for (const date of dates) {
  if (date < VALIDATION.from || date > VALIDATION.to) continue;
  const v = byMonth.get(date.slice(0, 7));
  if (v !== null) {
    sum += v;
    n++;
  }
}
if (n === 0) throw new Error("validation window carries no reconstructed values");
const mean = sum / n;
const drift = Math.abs(mean - VALIDATION.usdPerMt) / VALIDATION.usdPerMt;
if (drift > VALIDATION.tolerance) {
  throw new Error(
    `reconstruction averages ${format(mean)}/mt over ${VALIDATION.from}..${VALIDATION.to}, ` +
      `against a published ${VALIDATION.usdPerMt}/mt — ${(drift * 100).toFixed(1)}% out, ` +
      `tolerance ${(VALIDATION.tolerance * 100).toFixed(0)}%. Re-check lng_anchors.csv.`,
  );
}

fs.writeFileSync(OUT, [`Date,${COLUMN}`, ...rows].join(eol) + trailing, "utf8");

const priced = rows.filter((r) => !r.endsWith(",")).length;
console.log(
  `LNG Prices.csv: 1 column, ${priced} values across ${byMonth.size} months ` +
    `(${rows.length} rows, ${rows.length - priced} leading blanks)`,
);
console.log(
  `  validation: averages ${format(mean)}/mt over ${VALIDATION.from}..${VALIDATION.to} ` +
    `against a published ${VALIDATION.usdPerMt}/mt — ${(drift * 100).toFixed(1)}% out ` +
    `(${VALIDATION.source})`,
);
