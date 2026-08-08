import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

export type CsvRow = Record<string, string>;

/**
 * Parsed CSVs are cached for the life of the server process. The files in
 * data/ are the source of truth and are read from disk at request time — there
 * is no build step and no generated JSON that can go stale. Editing a CSV and
 * restarting the server picks up the change.
 */
const cache = new Map<string, { headers: string[]; rows: CsvRow[] }>();

/**
 * Read a CSV under data/. PapaParse is used rather than a hand-rolled split
 * because several schedule cells are quoted and contain commas, e.g. a
 * terminal named "Some Port Authority, Cityname".
 */
export function readCsv(relPath: string): { headers: string[]; rows: CsvRow[] } {
  const cached = cache.get(relPath);
  if (cached) return cached;

  const abs = path.join(process.cwd(), "data", relPath);
  const text = fs.readFileSync(abs, "utf8");

  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = (parsed.meta.fields ?? []).map((h) => h.trim());
  const result = { headers, rows: parsed.data };
  cache.set(relPath, result);
  return result;
}

/** Trimmed cell, or null when blank. Blank never becomes 0 or "". */
export function str(row: CsvRow, key: string): string | null {
  const v = row[key];
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Numeric cell, or null when blank/unparseable. */
export function num(row: CsvRow, key: string): number | null {
  const t = str(row, key);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
