import { readCsv } from "./csv";
import { resolvePricePort } from "./ports";
import { latestPoint, trimNulls } from "./series";
import type { Grade, PortPrices, PricePoint } from "./types";

// Re-exported so server callers have one import site for price helpers.
export { latestPoint, previousPoint } from "./series";

/** Pseudo-port holding the Brent benchmark, offered as a chart overlay. */
export const BRENT_KEY = "__BRENT";

const PRICE_FILES = [
  "pricing/VLSFO Prices.csv",
  "pricing/HSGO Prices.csv",
  "pricing/LSMGO_MGO Prices.csv",
  "pricing/Methanol Prices.csv",
];

/**
 * Grade suffixes, longest first so "MEOH VLSFOe" is matched before "MEOH"
 * and never mistaken for a plain VLSFO column.
 */
const GRADE_SUFFIXES: Array<[string, Grade]> = [
  ["MEOH VLSFOE", "MEOH_VLSFOe"],
  ["MEOH MGOE", "MEOH_MGOe"],
  ["MEOH", "MEOH"],
  ["IFO380", "IFO380"],
  ["VLSFO", "VLSFO"],
  ["LSMGO", "LSMGO"],
  ["MGO", "MGO"],
];

export type PriceIndex = Map<string, Map<Grade, PricePoint[]>>;

let indexCache: PriceIndex | null = null;

/**
 * Split a pricing column header into its port and grade, e.g.
 * "LA LongBeach IFO380" -> { portKey: "USLGB", grade: "IFO380" }.
 * Returns null for headers whose port is not in the alias table.
 */
function parseHeader(header: string): { portKey: string; grade: Grade } | null {
  const upper = header.trim().toUpperCase().replace(/\s+/g, " ");
  for (const [suffix, grade] of GRADE_SUFFIXES) {
    if (upper === suffix || upper.endsWith(` ${suffix}`)) {
      const prefix = upper.slice(0, upper.length - suffix.length).trim();
      const portKey = resolvePricePort(prefix);
      return portKey ? { portKey, grade } : null;
    }
  }
  return null;
}

function buildIndex(): PriceIndex {
  const index: PriceIndex = new Map();

  const push = (portKey: string, grade: Grade, points: PricePoint[]) => {
    const trimmed = trimNulls(points);
    if (trimmed.length === 0) return;
    let byGrade = index.get(portKey);
    if (!byGrade) {
      byGrade = new Map();
      index.set(portKey, byGrade);
    }
    byGrade.set(grade, trimmed);
  };

  for (const file of PRICE_FILES) {
    const { headers, rows } = readCsv(file);
    // Source rows are newest-first; charts need oldest-first.
    const ordered = [...rows].reverse();

    for (const header of headers) {
      if (header === "Date") continue;
      const parsed = parseHeader(header);
      if (!parsed) continue;

      const points: PricePoint[] = [];
      for (const row of ordered) {
        const date = (row["Date"] ?? "").trim();
        if (!date) continue;
        const raw = (row[header] ?? "").trim();
        const value = raw === "" ? null : Number(raw);
        points.push({
          date,
          value: value === null || !Number.isFinite(value) ? null : value,
        });
      }
      push(parsed.portKey, parsed.grade, points);
    }
  }

  // Brent, in $/mt so it shares the chart's y-axis with the fuel grades.
  // The raw $/bbl "Brent" column is deliberately ignored.
  const brent = readCsv("pricing/Brent Prices.csv");
  const brentPoints: PricePoint[] = [...brent.rows].reverse().flatMap((row) => {
    const date = (row["Date"] ?? "").trim();
    if (!date) return [];
    const raw = (row["BrentPMT"] ?? "").trim();
    const value = raw === "" ? null : Number(raw);
    return [
      { date, value: value === null || !Number.isFinite(value) ? null : value },
    ];
  });
  push(BRENT_KEY, "BRENT", brentPoints);

  return index;
}

export function getPriceIndex(): PriceIndex {
  if (!indexCache) indexCache = buildIndex();
  return indexCache;
}

/** All grades for one port, as a plain object ready to serialise. */
export function getPortPrices(portKey: string): PortPrices {
  const byGrade = getPriceIndex().get(portKey);
  if (!byGrade) return {};
  const out: PortPrices = {};
  for (const [grade, points] of byGrade) out[grade] = points;
  return out;
}

export function getBrentSeries(): PricePoint[] {
  return getPriceIndex().get(BRENT_KEY)?.get("BRENT") ?? [];
}

/** Newest quote date anywhere in the dataset — the header's "as of". */
export function latestDataDate(): string | null {
  let latest: string | null = null;
  for (const byGrade of getPriceIndex().values()) {
    for (const points of byGrade.values()) {
      const p = latestPoint(points);
      if (p && (latest === null || p.date > latest)) latest = p.date;
    }
  }
  return latest;
}
