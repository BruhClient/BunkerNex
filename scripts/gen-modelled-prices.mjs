/**
 * Regenerate the modelled port columns in the pricing CSVs.
 *
 *   node scripts/gen-modelled-prices.mjs
 *
 * Most of the ports this fleet stems at are assessed by nobody, and no source
 * carries daily history for them. Each is modelled instead as an assessed hub
 * series plus a documented basis differential:
 *
 *   modelled(port, grade, date) = hub(hub, grade, date) + basis(port, grade, date)
 *
 * The basis lives in data/pricing/bunker_basis.csv; this script materialises it
 * into the same wide CSVs the assessments use, so the app reads one set of
 * files and needs no special case.
 *
 * RUN THIS AFTER EVERY PRICE REFRESH. The modelled columns are computed from
 * the hub columns beside them, so once the hubs move the modelled values are
 * stale until this is re-run. Nothing at runtime can detect that staleness —
 * it is the price of keeping modelled and assessed data in one file.
 *
 * Idempotent: existing modelled columns are dropped and rebuilt, so running it
 * twice changes nothing.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data", "pricing");
const BASIS = path.join(DATA, "bunker_basis.csv");

/** LOCODE -> the prefix the source workbook uses for that hub's columns. */
const HUB_HEADER = {
  SGSIN: "SINGAPORE",
  CNSHA: "SHANGHAI",
  HKHKG: "HONGKONG",
  KRPUS: "BUSAN",
};

/**
 * LOCODE -> column prefix for the modelled ports.
 *
 * Single upper-case tokens, matching how the source spells its own multi-word
 * ports (HONGKONG, NEWYORK). Each needs a PRICE_PORT_ALIASES entry in
 * src/lib/ports.ts, or the column is silently dropped at read time.
 */
const PORT_HEADER = {
  MYPKG: "PORTKLANG",
  BDCGP: "CHITTAGONG",
  BDMGL: "MONGLA",
  INCCU: "KOLKATA",
  INMAA: "CHENNAI",
  INGAV: "GANGAVARAM",
  MMRGN: "YANGON",
  CNXMN: "XIAMEN",
  CNSHK: "SHEKOU",
  CNNSA: "NANSHA",
  CNNGB: "NINGBO",
  CNTSN: "TIANJIN",
  CNTAO: "QINGDAO",
  CNQZH: "QINZHOU",
  KRINC: "INCHEON",
  VNHPH: "HAIPHONG",
  VNSGN: "HOCHIMINH",
  VNUIH: "QUINHON",
  THLCH: "LAEMCHABANG",
  THBKK: "BANGKOK",
  IDJKT: "JAKARTA",
  IDSUB: "SURABAYA",
  IDSRG: "SEMARANG",
};

/**
 * Which file carries each grade. MGO is modelled for chart completeness only —
 * the fleet never stems it (PRICE_SERIES in src/lib/bunkerEvents.ts maps only
 * VLSFO/HSFO), so it never reaches bunkerPriceSnapshot().
 */
const GRADE_FILE = {
  VLSFO: "VLSFO Prices.csv",
  IFO380: "HSGO Prices.csv",
  MGO: "LSMGO_MGO Prices.csv",
};

function readBasis() {
  const text = fs.readFileSync(BASIS, "utf8");
  const { data } = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  /** grade -> portKey -> { hubPortKey, hubGrade, segments[] } */
  const byGrade = new Map();

  data.forEach((row, i) => {
    const line = i + 2;
    const portKey = (row.Port_Code ?? "").trim();
    if (!portKey) return;

    const grade = (row.Grade ?? "").trim();
    if (!GRADE_FILE[grade]) {
      throw new Error(`bunker_basis.csv line ${line}: unknown Grade "${grade}"`);
    }
    if (!PORT_HEADER[portKey]) {
      throw new Error(
        `bunker_basis.csv line ${line}: no column prefix for "${portKey}" — ` +
          "add one to PORT_HEADER here and an alias in src/lib/ports.ts",
      );
    }

    const hubPortKey = (row.Hub_Port_Code ?? "").trim();
    if (!HUB_HEADER[hubPortKey]) {
      throw new Error(
        `bunker_basis.csv line ${line}: unknown Hub_Port_Code "${hubPortKey}"`,
      );
    }

    const raw = (row.Basis_USD_Per_MT ?? "").trim();
    // Blank means no market for this grade in this window, and must stay
    // distinct from 0, which means parity with the hub. Number("") is 0, so
    // emptiness is checked before conversion, never after.
    const usdPerMt = raw === "" ? null : Number(raw);
    if (raw !== "" && !Number.isFinite(usdPerMt)) {
      throw new Error(
        `bunker_basis.csv line ${line}: Basis_USD_Per_MT is not a number: "${raw}"`,
      );
    }

    if (!byGrade.has(grade)) byGrade.set(grade, new Map());
    const byPort = byGrade.get(grade);

    if (!byPort.has(portKey)) {
      byPort.set(portKey, {
        hubPortKey,
        hubGrade: (row.Hub_Grade ?? "").trim(),
        segments: [],
      });
    }

    const entry = byPort.get(portKey);
    const effectiveFrom = (row.Effective_From ?? "").trim();
    const previous = entry.segments[entry.segments.length - 1];

    if (previous && effectiveFrom <= previous.effectiveFrom) {
      throw new Error(
        `bunker_basis.csv line ${line}: Effective_From ${effectiveFrom} ` +
          `does not follow ${previous.effectiveFrom}`,
      );
    }
    // A blank after a priced segment would punch a hole in the middle of the
    // series, which the chart's connectNulls would draw straight across.
    // No-market windows may only lead.
    if (previous && previous.usdPerMt !== null && usdPerMt === null) {
      throw new Error(
        `bunker_basis.csv line ${line}: ${portKey} ${grade} has a blank basis ` +
          "after a priced segment; no-market windows may only lead a series",
      );
    }

    entry.segments.push({ effectiveFrom, usdPerMt });
  });

  return byGrade;
}

/** The basis in force on a date: the last segment starting on or before it. */
function basisOn(segments, date) {
  let value = null;
  for (const segment of segments) {
    if (segment.effectiveFrom > date) break;
    value = segment.usdPerMt;
  }
  return value;
}

/** Match the source's own formatting: no trailing ".0" on whole numbers. */
function format(n) {
  return String(Math.round(n * 100) / 100);
}

function rewrite(grade, byPort) {
  const file = path.join(DATA, GRADE_FILE[grade]);
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trailing = text.endsWith(eol) ? eol : "";
  const lines = text.split(eol).filter((l) => l !== "");

  const header = lines[0].split(",");

  // A port whose basis is blank throughout has no market for this grade —
  // Chittagong sells no HSFO. Emitting an all-blank column would read as a
  // loading fault rather than as an absent market, so the column is simply not
  // created. data/README.md records which ports these are and why.
  const ports = [...byPort.keys()]
    .filter((p) => byPort.get(p).segments.some((s) => s.usdPerMt !== null))
    .sort();
  const newColumns = ports.map((p) => `${PORT_HEADER[p]} ${grade}`);

  // Drop every column this script could have written on a previous run — not
  // just the ones being written now — so a port that loses its market does not
  // leave a stale column behind.
  const owned = new Set(
    Object.values(PORT_HEADER).map((prefix) => `${prefix} ${grade}`),
  );
  const keep = header
    .map((_, i) => i)
    .filter((i) => !owned.has(header[i].trim()));

  const hubIndex = new Map();
  for (const [portKey, entry] of byPort) {
    const name = `${HUB_HEADER[entry.hubPortKey]} ${entry.hubGrade}`;
    const idx = header.findIndex((h) => h.trim() === name);
    if (idx === -1) {
      throw new Error(`${GRADE_FILE[grade]}: hub column "${name}" not found`);
    }
    hubIndex.set(portKey, idx);
  }

  const out = [[...keep.map((i) => header[i]), ...newColumns].join(",")];

  let written = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const date = (cells[0] ?? "").trim();

    const values = ports.map((portKey) => {
      const entry = byPort.get(portKey);
      const hubRaw = (cells[hubIndex.get(portKey)] ?? "").trim();
      const basis = basisOn(entry.segments, date);
      // Nulls propagate both ways and never become 0: with no hub quote there
      // is nothing to add a differential to, and a blank basis means the port
      // has no market for this grade. Neither is carried forward from the
      // previous day, which would assert a quote on a day nothing was quoted.
      if (hubRaw === "" || basis === null) return "";
      const hub = Number(hubRaw);
      if (!Number.isFinite(hub)) return "";
      written++;
      return format(hub + basis);
    });

    out.push([...keep.map((i) => cells[i] ?? ""), ...values].join(","));
  }

  fs.writeFileSync(file, out.join(eol) + trailing, "utf8");
  console.log(
    `${GRADE_FILE[grade]}: +${newColumns.length} columns, ${written} values ` +
      `(${lines.length - 1} rows)`,
  );
}

const basis = readBasis();
for (const grade of Object.keys(GRADE_FILE)) {
  const byPort = basis.get(grade);
  if (!byPort || byPort.size === 0) continue;
  rewrite(grade, byPort);
}
