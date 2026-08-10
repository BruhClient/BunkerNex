import type { Grade } from "./types";

/**
 * The palette from globals.css `@theme`, repeated as literals.
 *
 * MapLibre paint expressions and Recharts props are both read outside the
 * cascade, so neither resolves `var(--color-…)` — they need real hex. Keep
 * these in sync with the `@theme` block by hand; there is no build step that
 * checks it.
 */
export const THEME = {
  bg: "#0B0E13",
  surface: "#131822",
  line: "#1F2733",
  lineStrong: "#2B3546",
  fg: "#E6EAF0",
  muted: "#9AA6B8",
  faint: "#5C6675",
  accent: "#22D3EE",
  /** --color-down. The scrubbed-moment rule on the ROB chart. */
  down: "#F87171",
  /** --color-warn. Reserved for derived figures and threshold breaches. */
  warn: "#F59E0B",
} as const;

/**
 * One hue per service. Chosen to stay separable on a dark basemap.
 *
 * Eleven simultaneous routes is past the point where hue alone tells them
 * apart, so the two sub-regions sit on broadly different parts of the wheel:
 * East Coast India warm and cyan, Far East Asia red through indigo. The
 * sidebar toggles, not the palette, are what actually isolate a service.
 */
export const SERVICE_COLORS: Record<string, string> = {
  // Intra Asia · East Coast India
  BD1: "#22D3EE",
  BD2: "#F472B6",
  CAS: "#FBBF24",
  CCS: "#4ADE80",
  CVI: "#A78BFA",
  YGS: "#FB923C",

  // Intra Asia · Far East Asia
  KCI: "#F87171",
  KCS: "#818CF8",
  NCI: "#2DD4BF",
  SCT: "#D946EF",
  VCS: "#A3E635",
};

export const SERVICE_COLOR_FALLBACK = "#64748B";

export function serviceColor(code: string): string {
  return SERVICE_COLORS[code] ?? SERVICE_COLOR_FALLBACK;
}

/**
 * Residuals warm, distillates green, alternative fuels cyan-to-violet.
 *
 * The alternatives sit off the fossil ramp deliberately: a B24 quote is not a
 * like-for-like buy against the VLSFO tile beside it, and a single continuous
 * scale invites exactly that comparison.
 */
export const GRADE_COLORS: Record<Grade, string> = {
  VLSFO: "#38BDF8",
  IFO380: "#F59E0B",
  LSMGO: "#34D399",
  MGO: "#A3E635",
  MDO: "#84CC16",
  LNG: "#22D3EE",
  B24: "#4ADE80",
  B40: "#16A34A",
  MEOH: "#C084FC",
  MEOH_VLSFOe: "#E879F9",
  MEOH_MGOe: "#F0ABFC",
  BRENT: "#94A3B8",
};

/** Display labels — the raw CSV suffixes are not presentable as-is. */
export const GRADE_LABELS: Record<Grade, string> = {
  VLSFO: "VLSFO",
  IFO380: "IFO380",
  LSMGO: "LSMGO",
  MGO: "MGO",
  MDO: "MDO",
  LNG: "LNG",
  // Labelled by blend rather than as "biofuel": B24 and B40 are different
  // products at different ports, and the source sheet distinguishes them.
  B24: "B24 biofuel",
  B40: "B40 biofuel",
  MEOH: "Methanol",
  MEOH_VLSFOe: "MEOH (VLSFOe)",
  MEOH_MGOe: "MEOH (MGOe)",
  BRENT: "Brent",
};

/** Order grades appear in tiles, legend and chart. */
export const GRADE_ORDER: Grade[] = [
  "VLSFO",
  "IFO380",
  "LSMGO",
  "MGO",
  "MDO",
  "LNG",
  "B24",
  "B40",
  "MEOH",
  "MEOH_VLSFOe",
  "MEOH_MGOe",
  "BRENT",
];

export function sortGrades(grades: Grade[]): Grade[] {
  return [...grades].sort(
    (a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b),
  );
}
