/**
 * Regenerate the simulated fleet movement and ROB series.
 *
 *   node scripts/gen-vessel-movement.mjs
 *
 * data/vessels/PIL_Fleet_Live_Movement.csv is the only file in data/ carrying a
 * real timestamp and a fuel level that moves over time, and it is the single
 * thing that defines the app's scrubbed timeline: nothing in src/ hardcodes a
 * start or end date. loadVesselTracks reads the first Timestamp and the row
 * count, and every date the UI shows is index arithmetic from there.
 *
 * It is a simulation, not telemetry. The rotations come from the published
 * schedules and the fuel curves are the assumptions in vessel_assumptions.csv
 * played forward, so reconciling this against real noon reports would be
 * circular. What it does guarantee is feasibility: every vessel visits every
 * port on its line, and ROB stays inside Min_ROB_MT..Max_ROB_MT throughout.
 *
 * TO MOVE THE TIMELINE, EDIT WINDOW_START AND STEPS BELOW AND RE-RUN. Those two
 * constants are the whole window. Everything else — rotations, phases, offsets,
 * the ROB model — is derived, so the same fleet simply replays over new dates.
 *
 * Idempotent: the output is a pure function of the two input CSVs and the
 * constants here, so running it twice changes nothing.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const PORT_CALLS = path.join(DATA, "schedules", "PIL_Intra_Asia_Port_Calls.csv");
const SPECS = path.join(DATA, "vessels", "PIL_Fleet_Vessel_Specifications.csv");
const OUT = path.join(DATA, "vessels", "PIL_Fleet_Live_Movement.csv");

// --- The window. These two lines are the timeline. ------------------------

/**
 * Day 0 of the series, as a UTC epoch.
 *
 * The UTC epoch is a calendar calculator only — the emitted string carries no
 * timezone, matching the source and Source_Effective_Date in the service
 * master. Built from Date.UTC and read back with getUTC* so a dev box in a
 * non-UTC timezone cannot shift every row. Month is 0-based: 4 is May.
 */
const WINDOW_START = Date.UTC(2026, 4, 5); // 2026-05-05 00:00:00

/** 93 days x 8 steps/day, ending 2026-08-05 21:00:00. */
const STEPS = 744;

/**
 * The grid is 3-hourly, which STEP_HOURS in src/lib/vessels.ts hardcodes to
 * match. Changing it here without changing it there would leave every
 * displayed timestamp silently wrong, since the app never re-reads the
 * per-row Timestamp column.
 */
const STEP_HOURS = 3;
const STEPS_PER_DAY = 24 / STEP_HOURS;

const SOURCE_FILE =
  "Derived from PIL_Intra_Asia_Port_Calls.csv + PIL_Fleet_Vessel_Specifications.csv";

const HEADER = [
  "Vessel_Name",
  "Service_Code",
  "Port_Name",
  "Port_Code",
  "Timestamp",
  "Synthetic_Latitude",
  "Synthetic_Longitude",
  "Operational_Phase",
  "VLSFO_ROB_MT",
  "HSFO_ROB_MT",
  "MGO_ROB_MT",
  "VLSFO_Bunkered_MT",
  "HSFO_Bunkered_MT",
  "MGO_Bunkered_MT",
  "Source_File",
  "Data_Notes",
];

// --- The deployment ------------------------------------------------------

/**
 * Service -> vessels, in the order that fixes each one's place in the rotation.
 *
 * Order is load-bearing twice over: vessel k of n starts at loop offset
 * round(k * stepsPerLoop / n), so reordering a service re-times its ships; and
 * this is also the row order of the output file.
 *
 * Which ship is on which service is documented in data/README.md under "the
 * deployment" — three services PIL publishes by name, the rest sized by the
 * tightest port in the rotation. Held here as a literal rather than derived
 * from the previous CSV: a generator that reads its own output stops being
 * reproducible the moment a run fails halfway.
 */
const ROSTER = [
  ["NCI", ["KOTA SEJATI", "KOTA SEMPENA", "KOTA SABAS", "KOTA SAHABAT", "KOTA SALAM"]],
  ["CCS", ["KOTA RIA", "KOTA RUKUN", "KOTA RAKYAT"]],
  ["KCS", ["KOTA GABUNG", "KOTA GADANG", "KOTA GANDING", "KOTA GAYA"]],
  ["KCI", ["KOTA SEGAR", "KOTA SEJARAH", "KOTA SETIA", "KOTA SINGA"]],
  ["CVI", ["ASTERIOS", "KOTA JOHAN", "KOTA NABIL", "KOTA NAGA", "KOTA NALURI"]],
  ["BD1", ["KOTA ANGGUN", "KOTA AZAM"]],
  ["BD2", ["KOTA DAHLIA", "KOTA DUNIA"]],
  ["CAS", ["KOTA RAJA", "KOTA RATNA", "KOTA RATU", "KOTA RAHMAT"]],
  ["YGS", ["KOTA HAKIM", "KOTA HALUS"]],
  ["SCT", ["KOTA RAJIN", "KOTA RANCAK"]],
  ["VCS", ["KOTA HANDAL", "KOTA HARUM"]],
];

/**
 * Why these ships are on this service, written to every vessel's first row.
 *
 * Provenance travels with the data because the deployment is the softest thing
 * in this file: PIL names the ships on three of eleven services and states
 * tonnage on none.
 */
const DEPLOYMENT_NOTES = {
  NCI:
    "Deployment published by PIL for the NCI launch on 2025-06-17 (KOTA SEJATI, KOTA SEMPENA, KOTA SABAS). " +
    "KOTA SAHABAT and KOTA SALAM are sisters standing in for the HMM and X-Press Feeders partner ships, " +
    "which are not in the specifications file.",
  CCS:
    "Deployment published by PIL for the CCS launch on 2024-07-02: three geared KOTA R-class ships sized " +
    "for the Hooghly draft at Kolkata.",
  KCS:
    "Deployment derived: PIL publishes KCS as four vessels of about 2800 TEU without naming them; the " +
    "KOTA G-class (2754-2800 TEU) is the only exact-size group of four in the fleet.",
  KCI:
    "Deployment derived: PIL does not publish KCI tonnage. 3889 TEU matches the 2500-4700 TEU band PIL " +
    "states for the comparable NCI Indonesia service and clears the Semarang draft.",
  CVI:
    "Deployment derived: PIL states a consortium average of 2200 TEU for CVI including RCL and Interasia " +
    "tonnage absent from this fleet file, so the closest coherent PIL group (1810-2034 TEU) is used.",
  BD1:
    "Deployment derived: PIL does not publish BD1 tonnage. 1454 TEU clears the Chittagong draft and LOA " +
    "limits, which cap the port near 2500 TEU.",
  BD2:
    "Deployment derived: PIL does not publish BD2 tonnage. 628 TEU is sized for Mongla, the shallowest " +
    "port in the dataset. BD2 timetable synthesised from Transit_To_Next_Days plus 1-day dwells (14-day " +
    "loop) because the source PDF publishes no day numbers.",
  CAS:
    "Deployment derived: the service master states four vessels without naming them. 777-907 TEU geared " +
    "KOTA R-class ships match those PIL deploys on the neighbouring Kolkata service (CCS).",
  YGS:
    "Deployment derived: PIL runs YGS with the 1080 TEU KOTA HAPAS, which is absent from the " +
    "specifications file; these are its 1080 TEU sisters.",
  SCT:
    "Deployment derived: PIL does not publish SCT tonnage. 943 TEU clears the Bangkok Klong Toey limits, " +
    "which cap the terminal near 1200 TEU and 172 m LOA.",
  VCS:
    "Deployment derived: PIL does not publish VCS tonnage. 1080 TEU suits the Qui Nhon and Haiphong " +
    "feeder berths.",
};

/**
 * MGO carried, constant per vessel: it is never burned and never stemmed.
 *
 * Only these five appeared in the Drive extract this file replaced. The other
 * thirty are blank because the source figure has no derivable basis — across
 * its eleven vessels it ranged from 0.13 to 0.72 of Min_ROB_MT, so it is
 * neither a ratio of DWT nor of any other column. Per the null discipline it
 * stays empty rather than invented.
 */
const MGO_ROB = {
  ASTERIOS: 119.903,
  "KOTA ANGGUN": 50.71,
  "KOTA AZAM": 149.795,
  "KOTA DAHLIA": 16.362,
  "KOTA DUNIA": 50.612,
};

// --- Helpers -------------------------------------------------------------

/**
 * Round to three decimals, the precision the ROB series is carried at.
 *
 * Applied to the running ROB after every step, never to the burn rate. The
 * distinction is not cosmetic: KOTA SEJATI burns 46.58/8 = 5.8225 MT per
 * transit step, and pre-rounding that rate shifts thousands of cells. Rounding
 * only the accumulator reproduces the series exactly, with the odd 5.823 step
 * where the half lands the other way.
 */
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Numbers print bare, without trailing zeros: 1553, not 1553.000. */
const fmt = (n) => String(round3(n));

const pad2 = (n) => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:MM:SS`, no timezone — the source states none. */
function timestampAt(step) {
  const at = new Date(WINDOW_START + step * STEP_HOURS * 3_600_000);
  return (
    `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())} ` +
    `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}:${pad2(at.getUTCSeconds())}`
  );
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const { data, errors } = Papa.parse(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  if (errors.length) {
    throw new Error(`${path.basename(file)}: ${errors[0].message} on row ${errors[0].row}`);
  }
  return data;
}

/** Blank cells stay blank — Number("") is 0, and a 0-day dwell is not a blank. */
const cell = (row, key) => (row[key] ?? "").trim();

function intCell(row, key, where) {
  const raw = cell(row, key);
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${where}: ${key} "${raw}" is not an integer`);
  return n;
}

// --- Timetables ----------------------------------------------------------

/**
 * BD2 publishes no day numbers, so its timetable is synthesised.
 *
 * Transit_To_Next_Days (5, 1, 5) plus a 1-day dwell at each call gives the same
 * 14-day loop as BD1 on the same trade. The blanks are NOT backfilled into the
 * port calls CSV — the derivation lives here, and every BD2 vessel's first row
 * says so in Data_Notes.
 */
function synthesiseDayNumbers(calls) {
  let day = 0;
  return calls.map((call, i) => {
    const closer = i === calls.length - 1;
    const eta = day;
    const etd = closer ? null : day + 1;
    if (!closer) {
      const transit = intCell(call, "Transit_To_Next_Days", `BD2 seq ${i + 1}`);
      if (transit === null) {
        throw new Error(
          `BD2 seq ${i + 1}: Transit_To_Next_Days is blank, cannot synthesise a timetable`,
        );
      }
      day += 1 + transit;
    }
    return { ...call, __eta: eta, __etd: etd };
  });
}

/**
 * Expand one service's rotation onto the 3-hour step grid.
 *
 * Returns the per-step port, phase and bunker opportunities for a single loop;
 * a vessel then reads this cyclically from its own offset.
 */
function buildTimetable(serviceCode, rows) {
  const calls = [...rows].sort(
    (a, b) => Number(cell(a, "Sequence_No")) - Number(cell(b, "Sequence_No")),
  );

  const closer = calls[calls.length - 1];
  if (cell(closer, "Loop_Closure_Flag") !== "1") {
    throw new Error(`${serviceCode}: last call by Sequence_No is not the loop-closing row`);
  }

  // BD2's day-number cells are blank in the source. If a future refresh fills
  // them in, the synthesis must stop rather than silently override real data.
  const synthetic = cell(calls[0], "ETA_Day_Number") === "";
  if (synthetic && serviceCode !== "BD2") {
    throw new Error(
      `${serviceCode}: blank ETA_Day_Number, but only BD2 has a synthesised timetable`,
    );
  }
  if (!synthetic && serviceCode === "BD2") {
    throw new Error(
      "BD2 now publishes day numbers; drop synthesiseDayNumbers and the note in DEPLOYMENT_NOTES",
    );
  }

  const dated = synthetic
    ? synthesiseDayNumbers(calls)
    : calls.map((call, i) => ({
        ...call,
        __eta: intCell(call, "ETA_Day_Number", `${serviceCode} seq ${i + 1}`),
        __etd: intCell(call, "ETD_Day_Number", `${serviceCode} seq ${i + 1}`),
      }));

  const loopDays = dated[dated.length - 1].__eta;
  if (loopDays === null || loopDays <= 0) {
    throw new Error(`${serviceCode}: loop-closing row has no usable ETA_Day_Number`);
  }
  const steps = loopDays * STEPS_PER_DAY;

  const portCode = new Array(steps).fill(null);
  const portName = new Array(steps).fill(null);
  const phase = new Array(steps).fill(null);
  /** step -> the quantity published for the call berthing at that step. */
  const bunkerQty = new Map();

  const body = dated.slice(0, -1);
  let cursor = 0;

  body.forEach((call, i) => {
    const code = cell(call, "Port_Code");
    const name = cell(call, "Port_Name");
    if (!code || !name) throw new Error(`${serviceCode} seq ${i + 1}: blank Port_Code or Port_Name`);

    let berthStart = call.__eta * STEPS_PER_DAY;

    // A port change always gets at least one transit step. SCT publishes Laem
    // Chabang and Bangkok arriving the same day; without this the leg between
    // them would never be drawn.
    const changedPort = i > 0 && cell(body[i - 1], "Port_Code") !== code;
    const earliest = cursor + (changedPort ? 1 : 0);
    if (berthStart < earliest) berthStart = earliest;

    // Zero-dwell calls get one berthed step. Several rotations publish
    // ETA == ETD (CCS Xiamen day 0, YGS Singapore day 0); without a minimum
    // berth the call would have no row and nowhere to land its bunker stem.
    let berthEnd = call.__etd === null ? berthStart + 1 : call.__etd * STEPS_PER_DAY;
    if (berthEnd <= berthStart) berthEnd = berthStart + 1;

    if (berthEnd > steps) {
      throw new Error(`${serviceCode} seq ${i + 1}: berth runs past the ${steps}-step loop`);
    }

    // Everything before the berth is transit toward this call: Port_Name is the
    // leg destination while in transit, not where the ship currently is.
    for (let s = cursor; s < berthStart; s++) {
      portCode[s] = code;
      portName[s] = name;
      phase[s] = "Transit";
    }
    for (let s = berthStart; s < berthEnd; s++) {
      portCode[s] = code;
      portName[s] = name;
      phase[s] = "Berthed";
    }

    // Ride the marker on the shifted berth start, not the published ETA: SCT
    // Bangkok moves from step 48 to 50 under the min-transit rule above.
    if (cell(call, "Bunker_Quantity_MT") !== "") {
      bunkerQty.set(berthStart, Number(cell(call, "Bunker_Quantity_MT")));
    }

    cursor = berthEnd;
  });

  // The tail sails to the loop-closing call, which is next loop's first port.
  const closeCode = cell(closer, "Port_Code");
  const closeName = cell(closer, "Port_Name");
  for (let s = cursor; s < steps; s++) {
    portCode[s] = closeCode;
    portName[s] = closeName;
    phase[s] = "Transit";
  }

  if (portCode.some((c) => c === null)) {
    throw new Error(`${serviceCode}: timetable has an unfilled step`);
  }
  if (bunkerQty.size === 0) {
    throw new Error(`${serviceCode}: no call publishes a Bunker_Quantity_MT`);
  }

  return { steps, portCode, portName, phase, bunkerQty };
}

// --- The fleet -----------------------------------------------------------

function buildRows(timetables, specByName) {
  const rows = [];
  let stems = 0;
  let clipped = 0;
  let tightestMargin = Infinity;

  for (const [serviceCode, vessels] of ROSTER) {
    const tt = timetables.get(serviceCode);
    if (!tt) throw new Error(`${serviceCode}: no rotation in ${path.basename(PORT_CALLS)}`);

    vessels.forEach((name, k) => {
      const spec = specByName.get(name);
      if (!spec) throw new Error(`${name}: no row in ${path.basename(SPECS)}`);

      // Scrubber-fitted vessels burn HSFO, the rest VLSFO — the MARPOL Annex VI
      // rule the specifications sheet does not encode, since it lists all three
      // grades for every ship regardless of fitting.
      const grade = cell(spec, "Scrubber_Fitted") === "Yes" ? "HSFO" : "VLSFO";
      const max = Number(cell(spec, "Max_ROB_MT"));
      const min = Number(cell(spec, "Min_ROB_MT"));
      const trigger = Number(cell(spec, "Bunkering_Trigger_MT"));
      const burnTransit = Number(cell(spec, "Consumption_Transit_MT_Per_Day")) / STEPS_PER_DAY;
      const burnBerth = Number(cell(spec, "Consumption_Berth_MT_Per_Day")) / STEPS_PER_DAY;
      for (const [label, v] of [
        ["Max_ROB_MT", max],
        ["Min_ROB_MT", min],
        ["Bunkering_Trigger_MT", trigger],
      ]) {
        if (!Number.isFinite(v) || v <= 0) throw new Error(`${name}: ${label} is "${v}"`);
      }

      // Sisters are spread around the rotation instead of moving in lockstep.
      const offset = Math.round((k * tt.steps) / vessels.length) % tt.steps;
      const burnAt = (s) => (tt.phase[s] === "Berthed" ? burnBerth : burnTransit);

      const mgo = MGO_ROB[name];
      const mgoCell = mgo === undefined ? "" : fmt(mgo);

      let rob = max;

      for (let i = 0; i < STEPS; i++) {
        const s = (offset + i) % tt.steps;
        let stem = 0;
        let note = i === 0 ? DEPLOYMENT_NOTES[serviceCode] : "";
        if (i === 0 && !note) throw new Error(`${serviceCode}: no deployment note`);

        const qty = tt.bunkerQty.get(s);
        if (qty !== undefined) {
          // Fuel needed to reach the next call that could stem. Accumulated
          // unrounded: this is a decision input, not an emitted value.
          let need = 0;
          let reachable = false;
          for (let j = i + 1; j <= i + tt.steps; j++) {
            need += burnAt((offset + j - 1) % tt.steps);
            if (tt.bunkerQty.has((offset + j) % tt.steps)) {
              reachable = true;
              break;
            }
          }
          if (!reachable) throw new Error(`${name}: no reachable next stem from step ${i}`);

          // Lift on the trigger, or earlier if sailing on would breach Min_ROB
          // before the next chance. The second clause is the safety-critical
          // one: it stops a vessel passing a bunker port it cannot skip.
          if (rob <= trigger || rob - need < min) {
            stem = round3(Math.min(qty, max - rob));
            if (stem > 0) {
              if (stem < qty) {
                note =
                  `Stem cut from the scheduled ${qty} MT to ${fmt(stem)} MT ` +
                  `by the ${fmt(max)} MT tank capacity.`;
                clipped++;
              }
              rob = round3(rob + stem);
              stems++;
            }
          }
        }

        if (i === 0 && stem > 0) {
          throw new Error(`${name}: stemmed at step 0, which would overwrite the deployment note`);
        }

        const robCell = fmt(rob);
        const stemCell = fmt(stem);
        rows.push([
          name,
          serviceCode,
          tt.portName[s],
          tt.portCode[s],
          timestampAt(i),
          "",
          "",
          tt.phase[s],
          grade === "VLSFO" ? robCell : "0",
          grade === "HSFO" ? robCell : "0",
          mgoCell,
          grade === "VLSFO" ? stemCell : "0",
          grade === "HSFO" ? stemCell : "0",
          "0",
          SOURCE_FILE,
          note,
        ]);

        tightestMargin = Math.min(tightestMargin, rob - min);

        // Burn is charged after the row is written, so the emitted ROB is the
        // level at the start of the step (including anything lifted there).
        rob = round3(rob - burnAt(s));
      }
    });
  }

  return { rows, stems, clipped, tightestMargin };
}

// --- Invariants ----------------------------------------------------------

/**
 * Scrape a LOCODE-keyed table out of a TypeScript source file.
 *
 * Reading src/ from a build script is unusual, but PORT_COORDS and
 * PORT_APPROACH exist nowhere else — no CSV carries port geometry — and a port
 * missing from either fails silently at runtime: the first drops the port and
 * its route lines off the map, the second draws a great-circle arc straight
 * across a continent. Catching that here is worth the coupling.
 */
function scrapeLocodes(file, table) {
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf(`const ${table}`);
  if (start < 0) throw new Error(`${path.basename(file)}: ${table} not found`);
  const end = text.indexOf("\n};", start);
  if (end < 0) throw new Error(`${path.basename(file)}: ${table} is not a closed object literal`);
  const keys = new Set([...text.slice(start, end).matchAll(/^ {2}([A-Z]{5}):/gm)].map((m) => m[1]));
  // A reformat of those literals must not turn this check into a vacuous pass.
  if (keys.size < 26) throw new Error(`${table}: scraped only ${keys.size} codes, the shape changed`);
  return keys;
}

function checkInvariants(rows, timetables, specByName, portCallsByService) {
  const fail = (msg) => {
    throw new Error(`invariant failed: ${msg}`);
  };

  const byVessel = new Map();
  for (const r of rows) {
    if (!byVessel.has(r[0])) byVessel.set(r[0], []);
    byVessel.get(r[0]).push(r);
  }

  const expectedVessels = ROSTER.reduce((n, [, v]) => n + v.length, 0);
  if (byVessel.size !== expectedVessels) {
    fail(`${byVessel.size} vessels, expected ${expectedVessels}`);
  }
  if (rows.length !== expectedVessels * STEPS) {
    fail(`${rows.length} rows, expected ${expectedVessels * STEPS}`);
  }

  // The one that silently failed before: eight ports in schedules/ were called
  // by no vessel at all, Singapore among them. Run it first.
  for (const [serviceCode, vessels] of ROSTER) {
    const rotation = new Set(portCallsByService.get(serviceCode).map((r) => cell(r, "Port_Code")));
    const visited = new Set();
    for (const name of vessels) for (const r of byVessel.get(name)) visited.add(r[3]);
    for (const code of rotation) {
      if (!visited.has(code)) {
        fail(`${serviceCode}: ${code} is in the rotation but no vessel calls it`);
      }
    }
    for (const code of visited) {
      if (!rotation.has(code)) fail(`${serviceCode}: a vessel calls ${code}, which is off its line`);
    }
  }

  const coords = scrapeLocodes(path.join(ROOT, "src", "lib", "ports.ts"), "PORT_COORDS");
  const approach = scrapeLocodes(path.join(ROOT, "src", "lib", "searoutes.ts"), "PORT_APPROACH");

  for (const [name, vesselRows] of byVessel) {
    const spec = specByName.get(name);
    if (!spec) fail(`${name} has no specification row`);
    if (vesselRows.length !== STEPS) fail(`${name}: ${vesselRows.length} rows, expected ${STEPS}`);

    const grade = cell(spec, "Scrubber_Fitted") === "Yes" ? "HSFO" : "VLSFO";
    const robCol = grade === "HSFO" ? 9 : 8;
    const idleRobCol = grade === "HSFO" ? 8 : 9;
    const idleStemCol = grade === "HSFO" ? 11 : 12;
    const min = Number(cell(spec, "Min_ROB_MT"));
    const max = Number(cell(spec, "Max_ROB_MT"));
    const services = new Set(vesselRows.map((r) => r[1]));
    if (services.size !== 1) fail(`${name} appears under ${services.size} service codes`);

    vesselRows.forEach((r, i) => {
      if (r[4] !== timestampAt(i)) fail(`${name} step ${i}: timestamp ${r[4]} breaks the grid`);
      if (!coords.has(r[3])) fail(`${name} step ${i}: ${r[3]} is missing from PORT_COORDS`);
      if (!approach.has(r[3])) fail(`${name} step ${i}: ${r[3]} is missing from PORT_APPROACH`);
      const rob = Number(r[robCol]);
      if (rob < min - 1e-9 || rob > max + 1e-9) {
        fail(`${name} step ${i}: ROB ${rob} outside ${min}..${max}`);
      }
      if (r[idleRobCol] !== "0") fail(`${name} step ${i}: non-burned grade ROB is ${r[idleRobCol]}`);
      if (r[idleStemCol] !== "0") {
        fail(`${name} step ${i}: non-burned grade stemmed ${r[idleStemCol]}`);
      }
      if (r[13] !== "0") fail(`${name} step ${i}: MGO_Bunkered_MT is ${r[13]}`);
      if (r[10] !== vesselRows[0][10]) fail(`${name} step ${i}: MGO_ROB_MT is not constant`);
    });
  }

  for (const [serviceCode, tt] of timetables) {
    const vessels = ROSTER.find(([code]) => code === serviceCode)?.[1];
    if (!vessels) fail(`${serviceCode} has a rotation but no vessels`);
    if (tt.steps % STEPS_PER_DAY !== 0) {
      fail(`${serviceCode}: loop of ${tt.steps} steps is not whole days`);
    }
  }
}

// --- Main ----------------------------------------------------------------

const portCalls = readCsv(PORT_CALLS);
const specs = readCsv(SPECS);
const specByName = new Map(specs.map((s) => [cell(s, "Vessel_Name"), s]));

const portCallsByService = new Map();
for (const row of portCalls) {
  const code = cell(row, "Service_Code");
  if (!code) continue;
  if (!portCallsByService.has(code)) portCallsByService.set(code, []);
  portCallsByService.get(code).push(row);
}

const timetables = new Map();
for (const [serviceCode] of ROSTER) {
  const rows = portCallsByService.get(serviceCode);
  if (!rows) throw new Error(`${serviceCode}: no rows in ${path.basename(PORT_CALLS)}`);
  timetables.set(serviceCode, buildTimetable(serviceCode, rows));
}

const { rows, stems, clipped, tightestMargin } = buildRows(timetables, specByName);

checkInvariants(rows, timetables, specByName, portCallsByService);

const text = [HEADER.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";

const unchanged = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
if (!unchanged) fs.writeFileSync(OUT, text, "utf8");

const fleetSize = ROSTER.reduce((n, [, v]) => n + v.length, 0);
console.log(
  `${unchanged ? "unchanged" : "wrote"} ${path.relative(ROOT, OUT)}\n` +
    `  ${rows.length.toLocaleString()} rows, ${fleetSize} vessels x ${STEPS} steps\n` +
    `  ${timestampAt(0)} -> ${timestampAt(STEPS - 1)} ` +
    `(${STEPS / STEPS_PER_DAY} days, ${STEP_HOURS}-hour grid)\n` +
    `  ${stems} stems, ${clipped} cut by tank capacity, ` +
    `tightest ROB margin ${fmt(tightestMargin)} MT`,
);
