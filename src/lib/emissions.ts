import { num, readCsv, str } from "./csv";
import { VESSEL_GRADES, type VesselGrade } from "./types";

/**
 * Reference tables under data/emissions/ — see data/README.md. Neither file
 * is generated per-request-sensitive data; both are tiny (6 and ~67 rows)
 * and cached by readCsv like every other CSV under data/.
 */

/** Tank-to-wake t CO2e per t fuel, one figure per burnable grade. */
export type Co2eFactors = Record<VesselGrade, number>;

/**
 * Reads data/emissions/CO2_per_mt.csv and picks out the six grades this
 * fleet actually burns (VESSEL_GRADES) by their Grade column. LSMGO, MDO,
 * B24 and the blank-Grade FAME_B100 reference row are ignored — none of
 * them is a tank this fleet carries.
 */
export function loadCo2eFactors(): Co2eFactors {
  const { rows } = readCsv("emissions/CO2_per_mt.csv");

  const byGrade = new Map<string, number>();
  for (const row of rows) {
    const grade = str(row, "Grade");
    const co2e = num(row, "CO2e_TtW_MT_Per_MT");
    if (grade !== null && co2e !== null) byGrade.set(grade, co2e);
  }

  const factors = {} as Co2eFactors;
  for (const grade of VESSEL_GRADES) {
    const value = byGrade.get(grade);
    if (value === undefined) {
      throw new Error(
        `emissions/CO2_per_mt.csv is missing a CO2e_TtW_MT_Per_MT figure for ${grade}`,
      );
    }
    factors[grade] = value;
  }
  return factors;
}

/** One day's EUA carbon price plus its per-grade $/mt-fuel cost derivation. */
export interface Co2eCostPoint {
  /** YYYY-MM-DD, matching the fleet movement window's date range. */
  date: string;
  euaUsdPerMt: number;
  /** $ per mt of fuel burned, one figure per burnable grade. */
  costUsdPerMt: Record<VesselGrade, number>;
}

/**
 * Reads data/emissions/co2e_cost_per_mt.csv. The CSV carries both an MGO
 * and an LSMGO column with numerically identical values (they share one
 * CO2e factor) — the MGO column is read here, matching the standing rule
 * that a tank's identity is always "MGO" regardless of which priced
 * product it resolves to (src/lib/bunkerEvents.ts, stemDisplayGrade()).
 */
export function loadCo2eCostSeries(): Co2eCostPoint[] {
  const { rows } = readCsv("emissions/co2e_cost_per_mt.csv");

  const points: Co2eCostPoint[] = [];
  for (const row of rows) {
    const date = str(row, "Date");
    const eua = num(row, "EUA_Price_USD_Per_MT_CO2");
    if (date === null || eua === null) continue;

    const costUsdPerMt = {} as Record<VesselGrade, number>;
    for (const grade of VESSEL_GRADES) {
      const value = num(row, grade);
      if (value === null) {
        throw new Error(
          `emissions/co2e_cost_per_mt.csv is missing a ${grade} figure on ${date}`,
        );
      }
      costUsdPerMt[grade] = value;
    }

    points.push({ date, euaUsdPerMt: eua, costUsdPerMt });
  }

  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}
