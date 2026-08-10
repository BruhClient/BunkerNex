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
 * circular. What it does guarantee is feasibility and compliance: every vessel
 * visits every port on its line, residual ROB stays inside
 * Min_ROB_MT..Max_ROB_MT, HSFO appears only on scrubber-fitted hulls and only
 * where a port can supply it, and every vessel is on 0.10% S fuel through its
 * China and Korea ECA calls.
 *
 * Each vessel therefore runs three tanks, not one: two residual grades sharing
 * Max_ROB_MT (HSFO plus VLSFO on a scrubber hull, VLSFO alone without one) and
 * a separate MGO tank that is genuinely burned and stemmed on ECA legs.
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
  // Which grade the main engine is on for this step: VLSFO, HSFO or MGO.
  // Derived from the ECA rule and the vessel's tanks, but written out because
  // ROB alone cannot distinguish a fuel switch from an untouched tank.
  "Active_Fuel",
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

// --- Fuel: compliance, supply and the ECA switch --------------------------

/**
 * Ports where the fleet must burn 0.10% S fuel, i.e. LSMGO.
 *
 * China and Korea both run national port ECAs rather than an IMO SECA — Korea's
 * covers Busan, Incheon, Ulsan and Yeosu/Gwangyang; China's covers its coastal
 * ports — so this is a port list, not a polygon. Every one of the ten also
 * publishes a Bunker_Quantity_MT somewhere in this fleet's schedules, which is
 * what lets a vessel top its MGO up inside a window rather than having to carry
 * the whole stretch from outside.
 *
 * VLSFO does not clear this: it is 0.50% S against a 0.10% limit. Switching
 * between the two residual grades would look like compliance without being it,
 * which is why MGO has to be the switch fuel.
 */
const ECA_PORTS = new Set([
  "CNNGB", // Ningbo
  "CNNSA", // Nansha
  "CNQZH", // Qinzhou
  "CNSHA", // Shanghai
  "CNSHK", // Shekou
  "CNTAO", // Qingdao
  "CNTSN", // Tianjin
  "CNXMN", // Xiamen
  "KRINC", // Incheon
  "KRPUS", // Busan
]);

/** Switch to MGO one day before berthing at an ECA port. */
const ECA_LEAD_STEPS = STEPS_PER_DAY;

/** Switch back a few hours after leaving: one 3-hour step. */
const ECA_TRAIL_STEPS = 1;

/**
 * Ports with no high-sulphur bunker market.
 *
 * Held as a literal rather than read from data/pricing/, which the generator
 * deliberately does not parse. The evidence is there though: none of these has
 * an IFO380 column in "HSGO Prices.csv", and bunker_basis.csv models no IFO380
 * basis for them either — researched and recorded in data/README.md as an
 * absence of market, not an absence of data.
 *
 * This is the constraint the previous generator lacked. Assigning grade purely
 * by scrubber fitting put HSFO stems at Chittagong and Yangon, where no such
 * stem could be lifted. A scrubber vessel calling here lifts VLSFO into its
 * secondary residual tank instead — which is the whole reason a scrubber vessel
 * needs a second residual grade at all.
 *
 * Laem Chabang is deliberately NOT in this list: LAEMCHABANG IFO380 carries
 * 1,715 values through 2026-08-05. data/README.md used to name it here.
 */
const NO_HSFO_PORTS = new Set([
  "CNNSA", // Nansha
  "CNQZH", // Qinzhou
  "CNSHK", // Shekou
  "IDSUB", // Surabaya
  "INGAV", // Gangavaram
  "MMRGN", // Yangon
  "VNHPH", // Haiphong
  "VNUIH", // Qui Nhon
]);

/**
 * Ports with no 0.50% residual market.
 *
 * New with the CE sheet, and the reason the residual branch below has three
 * outcomes rather than two. Until now every port could sell VLSFO, so a hull
 * that could not lift HSFO always had a fallback. Chittagong and Mongla sell
 * IFO 180/380 and distillate but no VLSFO; Kolkata sells HSFO alone. A
 * non-scrubber hull calling at any of the three cannot stem residual at all and
 * has to reach its next opportunity on what it is already carrying.
 *
 * Qinzhou and Yangon appear in all three sets: the sheet records no confirmed
 * bunker market at either, so neither is a stemming opportunity for anyone.
 */
const NO_VLSFO_PORTS = new Set([
  "BDCGP", // Chittagong
  "BDMGL", // Mongla
  "CNQZH", // Qinzhou
  "INCCU", // Kolkata
  "MMRGN", // Yangon
]);

/**
 * Ports with no distillate market of either kind.
 *
 * The LSMGO/MGO split the sheet draws does not matter here — a port feeds the
 * distillate tank if it sells either grade, and only which price column values
 * the lift changes between them. That is priceSeriesFor() in
 * src/lib/bunkerEvents.ts, not this file.
 */
const NO_MGO_PORTS = new Set([
  "CNQZH", // Qinzhou
  "INCCU", // Kolkata
  "INGAV", // Gangavaram
  "MMRGN", // Yangon
  "VNHPH", // Haiphong
]);

/** Whether this berth can put any residual grade into this hull. */
const canStemResidual = (port, scrubber) =>
  (scrubber && !NO_HSFO_PORTS.has(port)) || !NO_VLSFO_PORTS.has(port);

/**
 * Share of a scrubber vessel's residual capacity held as VLSFO.
 *
 * A scrubber-fitted ship does not sail on high-sulphur fuel alone. It keeps a
 * compliant residual reserve against the scrubber failing and against ports
 * that restrict its use — China limits open-loop discharge across its domestic
 * ECA, and the Drive source's own Hong Kong row describes VLSFO as "this
 * fleet's HSFO-vessel berth fuel where scrubber use is restricted".
 *
 * So the two residual grades share Max_ROB_MT from step 0 rather than the
 * second one appearing only if a no-HSFO port happens to fall due. The reserve
 * is protected in practice by burning HSFO first: VLSFO is drawn on only once
 * HSFO runs out, and topped up wherever the port cannot sell HSFO.
 *
 * Derived. Nothing in the source splits a residual tank; 20% is the same
 * fraction used for the MGO tank, chosen for one stated ratio rather than two.
 */
const VLSFO_RESERVE_RATIO = 0.2;

/**
 * The MGO tank, as a ratio of Max_ROB_MT. Mirrored in vessel_assumptions.csv.
 *
 * MGO sits OUTSIDE Max_ROB_MT: the source has ASTERIOS opening at 683 MT of
 * HSFO — exactly its Max_ROB_MT — and carrying 119.9 MT of MGO on top, so
 * Max_ROB_MT is the residual capacity and the distillate tank is separate.
 *
 * Derived, not sourced. The Drive extract this file replaced carried a figure
 * for only five vessels and it had no derivable basis — 0.13 to 0.72 of
 * Min_ROB_MT across its eleven ships, a ratio of nothing. Three of those five
 * land near 0.20 of Max_ROB_MT (KOTA AZAM 149.8 vs 143.0, KOTA DUNIA 50.6 vs
 * 49.2, ASTERIOS 119.9 vs 136.6) and two do not. Now that MGO is burned rather
 * than parked, holding five hand figures beside thirty derived ones would make
 * the series inconsistent, so all thirty-five come from this ratio.
 *
 * Raise it if the ECA-heavy rotations (KCS, KCI) ever breach the MGO floor —
 * checkInvariants will say so before anything is written.
 */
const MGO_MAX_RATIO = 0.2;

/** Floor and trigger as fractions of the MGO tank, mirroring the residual ones. */
const MGO_MIN_RATIO = 1 / 3;
const MGO_TRIGGER_RATIO = 1 / 2;

/**
 * Share of a call's published Bunker_Quantity_MT liftable as MGO.
 *
 * The schedules publish one quantity per call, sized for the residual stem. The
 * MGO lift is pegged to it at the same ratio the tank is, so the figure stays
 * anchored to published data rather than invented outright.
 */
const MGO_STEM_RATIO = 0.2;

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
  /** step -> true where the vessel must be on 0.10% S fuel. Filled below. */
  const eca = new Array(steps).fill(false);
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

    // The ECA window rides the shifted berth for the same reason. It is marked
    // modulo the loop because a lead-in can reach back past step 0 into the
    // previous loop's tail, which a vessel reads cyclically anyway.
    if (ECA_PORTS.has(code)) {
      const from = berthStart - ECA_LEAD_STEPS;
      const to = berthEnd + ECA_TRAIL_STEPS;
      for (let s = from; s < to; s++) eca[((s % steps) + steps) % steps] = true;
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

  return { steps, portCode, portName, phase, eca, bunkerQty };
}

// --- The fleet -----------------------------------------------------------

function buildRows(timetables, specByName) {
  const rows = [];
  const stems = { VLSFO: 0, HSFO: 0, MGO: 0 };
  let clipped = 0;
  let ecaSwitches = 0;
  let tightestResidual = Infinity;
  let tightestMgo = Infinity;

  for (const [serviceCode, vessels] of ROSTER) {
    const tt = timetables.get(serviceCode);
    if (!tt) throw new Error(`${serviceCode}: no rotation in ${path.basename(PORT_CALLS)}`);

    vessels.forEach((name, k) => {
      const spec = specByName.get(name);
      if (!spec) throw new Error(`${name}: no row in ${path.basename(SPECS)}`);

      // Only a scrubber-fitted hull may burn high-sulphur fuel — the MARPOL
      // Annex VI rule the specifications sheet does not encode, since it lists
      // all three grades for every ship regardless of fitting. A scrubber
      // vessel carries two residual grades (HSFO, plus VLSFO for the ports that
      // cannot supply HSFO); the rest carry VLSFO alone and their HSFO columns
      // stay a true zero, not a missing value.
      const scrubber = cell(spec, "Scrubber_Fitted") === "Yes";
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

      // The distillate tank, outside Max_ROB_MT. See MGO_MAX_RATIO.
      const mgoMax = round3(max * MGO_MAX_RATIO);
      const mgoMin = round3(mgoMax * MGO_MIN_RATIO);
      const mgoTrigger = round3(mgoMax * MGO_TRIGGER_RATIO);

      // Sisters are spread around the rotation instead of moving in lockstep.
      const offset = Math.round((k * tt.steps) / vessels.length) % tt.steps;
      const burnAt = (s) => (tt.phase[s] === "Berthed" ? burnBerth : burnTransit);

      /**
       * Fuel needed to reach the next call that could stem, split by tank.
       *
       * Split because the two tanks drain in different places: an ECA stretch
       * spends MGO and no residual at all. Accumulated unrounded — a decision
       * input, not an emitted value.
       */
      const needFrom = (i) => {
        let residual = 0;
        let mgo = 0;
        // Separate, because a call can supply one tank and not the other:
        // Kolkata sells HSFO but no distillate, Haiphong the reverse. Stopping
        // at the first call publishing a quantity would have this hull believe
        // it can top up somewhere it cannot, which is the one thing the
        // second trigger clause below exists to prevent.
        let residualAt = null;
        let mgoAt = null;
        for (let j = i + 1; j <= i + tt.steps; j++) {
          const at = (offset + j - 1) % tt.steps;
          if (tt.eca[at]) mgo += burnAt(at);
          else residual += burnAt(at);

          const s = (offset + j) % tt.steps;
          if (!tt.bunkerQty.has(s)) continue;
          const p = tt.portCode[s];
          if (residualAt === null && canStemResidual(p, scrubber)) residualAt = residual;
          if (mgoAt === null && !NO_MGO_PORTS.has(p)) mgoAt = mgo;
          if (residualAt !== null && mgoAt !== null) break;
        }
        return {
          residual: residualAt,
          // A rotation with no distillate stop anywhere falls back to the whole
          // loop's burn: conservative, and the MGO floor check is the arbiter.
          mgo: mgoAt ?? mgo,
          reachable: residualAt !== null,
        };
      };

      // Both residual tanks open full and together fill Max_ROB_MT: a scrubber
      // vessel splits it HSFO/VLSFO, everyone else holds VLSFO alone. Everyone
      // opens with a full MGO tank.
      const reserve = scrubber ? round3(max * VLSFO_RESERVE_RATIO) : max;
      let vlsfo = reserve;
      let hsfo = round3(max - reserve);
      let mgo = mgoMax;
      let previousFuel = null;

      for (let i = 0; i < STEPS; i++) {
        const s = (offset + i) % tt.steps;
        const port = tt.portCode[s];
        const inEca = tt.eca[s];

        let stemV = 0;
        let stemH = 0;
        let stemM = 0;
        let note = i === 0 ? DEPLOYMENT_NOTES[serviceCode] : "";
        if (i === 0 && !note) throw new Error(`${serviceCode}: no deployment note`);

        const qty = tt.bunkerQty.get(s);
        if (qty !== undefined) {
          const need = needFrom(i);
          if (!need.reachable) throw new Error(`${name}: no reachable next stem from step ${i}`);

          // --- Residual. Lift on the trigger, or earlier if sailing on would
          // breach Min_ROB before the next chance. The second clause is the
          // safety-critical one: it stops a vessel passing a bunker port it
          // cannot skip.
          //
          // Grade follows what the berth can actually supply, not the fitting.
          // Three outcomes, not two: high-sulphur where the hull is scrubbed and
          // the port sells it, VLSFO where the port sells that, and no lift at
          // all where it sells neither — a non-scrubber hull at Chittagong,
          // Mongla or Kolkata.
          const asHsfo = scrubber && !NO_HSFO_PORTS.has(port);
          const residual = round3(vlsfo + hsfo);
          if (
            (asHsfo || !NO_VLSFO_PORTS.has(port)) &&
            (residual <= trigger || residual - need.residual < min)
          ) {
            const lift = round3(Math.min(qty, max - residual));
            if (lift > 0) {
              if (asHsfo) {
                stemH = lift;
                hsfo = round3(hsfo + lift);
              } else {
                stemV = lift;
                vlsfo = round3(vlsfo + lift);
              }
              stems[asHsfo ? "HSFO" : "VLSFO"]++;
              if (lift < qty) {
                note =
                  `Stem cut from the scheduled ${qty} MT to ${fmt(lift)} MT ` +
                  `by the ${fmt(max)} MT tank capacity.`;
                clipped++;
              }
            }
          }

          // --- MGO. Same rule against its own tank, gated the same way on
          // supply. Vessels on rotations that touch no ECA port never burn any,
          // so this never fires for them.
          if (!NO_MGO_PORTS.has(port) && (mgo <= mgoTrigger || mgo - need.mgo < mgoMin)) {
            const lift = round3(Math.min(qty * MGO_STEM_RATIO, mgoMax - mgo));
            if (lift > 0) {
              stemM = lift;
              mgo = round3(mgo + lift);
              stems.MGO++;
            }
          }
        }

        if (i === 0 && (stemV > 0 || stemH > 0 || stemM > 0)) {
          throw new Error(`${name}: stemmed at step 0, which would overwrite the deployment note`);
        }

        // What the main engine is on for this step. Recorded rather than left
        // to be inferred: a reader cannot tell a switch from a quiet tank by
        // watching ROB alone, since MGO is flat on ECA-free rotations.
        const activeFuel = inEca ? "MGO" : hsfo > 0 ? "HSFO" : "VLSFO";
        if (previousFuel !== null && previousFuel !== activeFuel) ecaSwitches++;
        previousFuel = activeFuel;

        rows.push({
          Vessel_Name: name,
          Service_Code: serviceCode,
          Port_Name: tt.portName[s],
          Port_Code: port,
          Timestamp: timestampAt(i),
          Synthetic_Latitude: "",
          Synthetic_Longitude: "",
          Operational_Phase: tt.phase[s],
          Active_Fuel: activeFuel,
          VLSFO_ROB_MT: fmt(vlsfo),
          HSFO_ROB_MT: fmt(hsfo),
          MGO_ROB_MT: fmt(mgo),
          VLSFO_Bunkered_MT: fmt(stemV),
          HSFO_Bunkered_MT: fmt(stemH),
          MGO_Bunkered_MT: fmt(stemM),
          Source_File: SOURCE_FILE,
          Data_Notes: note,
        });

        tightestResidual = Math.min(tightestResidual, round3(vlsfo + hsfo) - min);
        tightestMgo = Math.min(tightestMgo, mgo - mgoMin);

        // Burn is charged after the row is written, so the emitted ROB is the
        // level at the start of the step (including anything lifted there).
        const burn = burnAt(s);
        if (inEca) {
          mgo = round3(mgo - burn);
        } else {
          // HSFO first — with a scrubber it is the cheaper fuel, so VLSFO is
          // held as the reserve it was lifted to be. The remainder spills to
          // VLSFO on the one step where HSFO runs out mid-burn.
          let left = burn;
          if (hsfo > 0) {
            const take = Math.min(hsfo, left);
            hsfo = round3(hsfo - take);
            left -= take;
          }
          if (left > 0) vlsfo = round3(vlsfo - left);
        }
      }
    });
  }

  return { rows, stems, clipped, ecaSwitches, tightestResidual, tightestMgo };
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
    if (!byVessel.has(r.Vessel_Name)) byVessel.set(r.Vessel_Name, []);
    byVessel.get(r.Vessel_Name).push(r);
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
    for (const name of vessels) for (const r of byVessel.get(name)) visited.add(r.Port_Code);
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

    const scrubber = cell(spec, "Scrubber_Fitted") === "Yes";
    const min = Number(cell(spec, "Min_ROB_MT"));
    const max = Number(cell(spec, "Max_ROB_MT"));
    const mgoMax = round3(max * MGO_MAX_RATIO);
    const mgoMin = round3(mgoMax * MGO_MIN_RATIO);
    const services = new Set(vesselRows.map((r) => r.Service_Code));
    if (services.size !== 1) fail(`${name} appears under ${services.size} service codes`);

    // A rotation with no ECA port must leave MGO untouched, and one with an
    // ECA port must not: the switch either happened or it silently did not.
    const serviceCode = vesselRows[0].Service_Code;
    const touchesEca = portCallsByService
      .get(serviceCode)
      .some((r) => ECA_PORTS.has(cell(r, "Port_Code")));
    const mgoMoves = vesselRows.some((r) => r.MGO_ROB_MT !== vesselRows[0].MGO_ROB_MT);
    if (touchesEca && !mgoMoves) fail(`${name}: ${serviceCode} calls an ECA port but MGO never moves`);
    if (!touchesEca && mgoMoves) fail(`${name}: ${serviceCode} has no ECA port but MGO moves`);

    // The point of the whole exercise: a scrubber vessel carries two residual
    // grades throughout, not one plus an occasional accident of supply. HSFO
    // may legitimately hit zero between stems; the compliant reserve may not.
    if (scrubber && vesselRows.some((r) => Number(r.VLSFO_ROB_MT) <= 0)) {
      fail(`${name}: scrubber vessel runs its compliant VLSFO reserve to zero`);
    }

    vesselRows.forEach((r, i) => {
      const where = `${name} step ${i}`;
      if (r.Timestamp !== timestampAt(i)) fail(`${where}: timestamp ${r.Timestamp} breaks the grid`);
      if (!coords.has(r.Port_Code)) fail(`${where}: ${r.Port_Code} is missing from PORT_COORDS`);
      if (!approach.has(r.Port_Code)) fail(`${where}: ${r.Port_Code} is missing from PORT_APPROACH`);

      // The two residual grades share one tank capacity, so the bound is on
      // their sum. Either column alone may legitimately sit at zero.
      const residual = round3(Number(r.VLSFO_ROB_MT) + Number(r.HSFO_ROB_MT));
      if (residual < min - 1e-9 || residual > max + 1e-9) {
        fail(`${where}: residual ROB ${residual} outside ${min}..${max}`);
      }
      const mgo = Number(r.MGO_ROB_MT);
      if (mgo < mgoMin - 1e-9 || mgo > mgoMax + 1e-9) {
        fail(`${where}: MGO ROB ${mgo} outside ${mgoMin}..${mgoMax}`);
      }

      // Compliance: high-sulphur fuel exists only on a scrubber-fitted hull.
      if (!scrubber) {
        if (r.HSFO_ROB_MT !== "0") fail(`${where}: no scrubber, but HSFO ROB is ${r.HSFO_ROB_MT}`);
        if (r.HSFO_Bunkered_MT !== "0") {
          fail(`${where}: no scrubber, but stemmed ${r.HSFO_Bunkered_MT} MT of HSFO`);
        }
      }

      // Supply: one check per tank, against the CE sheet's availability matrix.
      // The HSFO one is the check whose absence let an older file stem HSFO
      // where there was no high-sulphur market; the other two are its
      // counterparts, and they matter now that a port can sell HSFO and no
      // VLSFO (Chittagong, Mongla, Kolkata) or nothing at all (Qinzhou,
      // Yangon).
      if (Number(r.VLSFO_Bunkered_MT) > 0 && NO_VLSFO_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed VLSFO at ${r.Port_Code}, which has no VLSFO market`);
      }
      if (Number(r.MGO_Bunkered_MT) > 0 && NO_MGO_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed MGO at ${r.Port_Code}, which has no distillate market`);
      }
      if (Number(r.HSFO_Bunkered_MT) > 0 && NO_HSFO_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed HSFO at ${r.Port_Code}, which has no HSFO market`);
      }

      // The active fuel must be one the vessel is actually holding.
      if (!["VLSFO", "HSFO", "MGO"].includes(r.Active_Fuel)) {
        fail(`${where}: Active_Fuel is "${r.Active_Fuel}"`);
      }
      if (r.Active_Fuel === "HSFO" && !scrubber) fail(`${where}: burning HSFO with no scrubber`);
      if (Number(r[`${r.Active_Fuel}_ROB_MT`]) <= 0) {
        fail(`${where}: burning ${r.Active_Fuel} with none onboard`);
      }
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

const { rows, stems, clipped, ecaSwitches, tightestResidual, tightestMgo } = buildRows(
  timetables,
  specByName,
);

checkInvariants(rows, timetables, specByName, portCallsByService);

const text =
  [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvCell(r[h])).join(","))].join("\n") +
  "\n";

const unchanged = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
if (!unchanged) fs.writeFileSync(OUT, text, "utf8");

const fleetSize = ROSTER.reduce((n, [, v]) => n + v.length, 0);
const totalStems = stems.VLSFO + stems.HSFO + stems.MGO;
console.log(
  `${unchanged ? "unchanged" : "wrote"} ${path.relative(ROOT, OUT)}\n` +
    `  ${rows.length.toLocaleString()} rows, ${fleetSize} vessels x ${STEPS} steps\n` +
    `  ${timestampAt(0)} -> ${timestampAt(STEPS - 1)} ` +
    `(${STEPS / STEPS_PER_DAY} days, ${STEP_HOURS}-hour grid)\n` +
    `  ${totalStems} stems (${stems.HSFO} HSFO, ${stems.VLSFO} VLSFO, ${stems.MGO} MGO), ` +
    `${clipped} cut by tank capacity\n` +
    `  ${ecaSwitches} fuel switches, tightest margins: ` +
    `residual ${fmt(tightestResidual)} MT, MGO ${fmt(tightestMgo)} MT`,
);
