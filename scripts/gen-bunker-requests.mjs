/**
 * Regenerate the HQ desk's inbox of bunkering requests.
 *
 *   node scripts/gen-bunker-requests.mjs
 *
 * One row per open request: what the chief engineer asked for, at which port,
 * by when — plus the forward legs the desk needs in order to look further ahead
 * than the CE was asked to.
 *
 * THE FORWARD LEGS ARE THE POINT. A chief engineer plans on a next-port basis:
 * enough fuel, of the right grade, to reach the next berth legally. That is the
 * correct scope for the ship. It is the wrong scope for the desk, which can see
 * that the port after next is inside a DECA zone with no distillate market, and
 * that lifting a little more now is cheaper and safer than a scramble later.
 *
 * Baking the chain into each request keeps /hq off the vessel movement series
 * entirely — that file is ~690 KB as page props and is already flagged in
 * CLAUDE.md as being at the edge of what should ship to the client.
 *
 * `Forward_Legs` packs `PORT@ETA@TRANSIT_DAYS`, `;`-separated — the same
 * convention Key_Features and suppliers.csv's ports/grades already use.
 *
 * NONE OF THIS IS SOURCED. PIL publishes no bunkering requisitions. The vessel,
 * port, rotation and timing come from the generated movement series; the
 * requested quantity, ROB reading and status are simulated on top of it.
 *
 * Randomness is seeded on the vessel and stem step, so the output is stable and
 * reviewable in git. Idempotent.
 *
 * Run order: after gen-vessel-movement.mjs, which writes the movement series.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATA = path.join(process.cwd(), "data");
const MOVEMENT = path.join(DATA, "vessels", "PIL_Fleet_Live_Movement.csv");
const SPECS = path.join(DATA, "vessels", "PIL_Fleet_Vessel_Specifications.csv");
const OUT_DIR = path.join(DATA, "requests");
const OUT = path.join(OUT_DIR, "bunker_requests.csv");

/** Hours between rows in the movement grid. Mirrors STEP_HOURS. */
const STEP_HOURS = 3;

/** Forward legs carried on each request. Three is two more than the CE plans. */
const FORWARD_LEGS = 3;

/** How many requests to raise. Enough to fill an inbox, not to bury it. */
const TARGET_REQUESTS = 18;

/** Ports whose distillate market is 0.10% LSMGO. Mirrors src/lib/bunkerEvents.ts. */
const LSMGO_PORTS = new Set([
  "CNNGB", "CNNSA", "CNSHA", "CNSHK", "CNTAO", "CNTSN", "CNXMN", "CNYTN",
  "IDSUB", "KRINC", "KRPUS", "MYPKG", "SGSIN", "VNUIH",
  "NLRTM", "BEANR", "DEHAM", "FRLEH", "GBSOU", "GBFXT",
]);

const TANK_COLUMNS = [
  ["VLSFO_Bunkered_MT", "VLSFO", "VLSFO_ROB_MT"],
  ["HSFO_Bunkered_MT", "HSFO", "HSFO_ROB_MT"],
  ["MGO_Bunkered_MT", "MGO", "MGO_ROB_MT"],
];

function priceSeriesFor(tank, portCode) {
  if (tank === "MGO") return LSMGO_PORTS.has(portCode) ? "LSMGO" : "MGO";
  return tank;
}

// --- seeded randomness -----------------------------------------------------

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

// --- inputs ----------------------------------------------------------------

function parse(file) {
  const { data, meta } = Papa.parse(fs.readFileSync(file, "utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return { headers: (meta.fields ?? []).map((h) => h.trim()), rows: data };
}

function readSpecs() {
  const specs = new Map();
  for (const row of parse(SPECS).rows) {
    const name = (row.Vessel_Name ?? "").trim();
    if (!name) continue;
    specs.set(name, {
      maxRobMt: Number((row.Max_ROB_MT ?? "").trim()),
      minRobMt: Number((row.Min_ROB_MT ?? "").trim()),
      transitPerDay: Number((row.Consumption_Transit_MT_Per_Day ?? "").trim()),
      berthPerDay: Number((row.Consumption_Berth_MT_Per_Day ?? "").trim()),
      triggerMt: Number((row.Bunkering_Trigger_MT ?? "").trim()),
      scrubber: (row.Scrubber_Fitted ?? "").trim().toLowerCase() === "yes",
    });
  }
  return specs;
}

/**
 * Per-vessel step series, and the stems recorded on them.
 *
 * The movement sheet is one row per vessel per 3-hour step; this keeps the port
 * code and timestamp per step so a forward rotation can be walked, plus the
 * non-zero bunkered cells that become requests.
 */
function readTracks() {
  const tracks = new Map();

  for (const row of parse(MOVEMENT).rows) {
    const vessel = (row.Vessel_Name ?? "").trim();
    const portCode = (row.Port_Code ?? "").trim();
    const timestamp = (row.Timestamp ?? "").trim();
    if (!vessel || !portCode || !timestamp) continue;

    let track = tracks.get(vessel);
    if (!track) {
      track = { vessel, serviceCode: (row.Service_Code ?? "").trim(), steps: [] };
      tracks.set(vessel, track);
    }

    const stems = [];
    for (const [column, tank, robColumn] of TANK_COLUMNS) {
      const raw = (row[column] ?? "").trim();
      if (raw === "" || raw === "0") continue;
      const mt = Number(raw);
      if (!Number.isFinite(mt) || mt <= 0) continue;
      stems.push({ tank, mt, robMt: Number((row[robColumn] ?? "0").trim()) || 0 });
    }

    track.steps.push({
      portCode,
      timestamp,
      phase: (row.Operational_Phase ?? "").trim(),
      stems,
    });
  }

  return [...tracks.values()];
}

const parseTs = (ts) => Date.parse(ts.replace(" ", "T") + "Z");

/**
 * Every berth call on a track, in order: arrival, departure, port.
 *
 * A leg boundary is NOT a change of Port_Code. In the movement sheet that
 * column holds the DESTINATION while a vessel is in transit and the berth only
 * while it is alongside, so the code flips the moment a ship casts off — using
 * it directly dates every arrival to the previous port's departure and yields
 * three-hour "voyages". Berth calls are read off Operational_Phase instead,
 * which is unambiguous.
 */
function berthCalls(track) {
  const calls = [];

  for (const [i, step] of track.steps.entries()) {
    if (step.phase !== "Berthed") continue;

    const previous = track.steps[i - 1];
    const continues =
      previous && previous.phase === "Berthed" && previous.portCode === step.portCode;

    if (continues) {
      calls[calls.length - 1].lastStep = i;
    } else {
      calls.push({ portCode: step.portCode, firstStep: i, lastStep: i });
    }
  }

  return calls.map((call) => ({
    portCode: call.portCode,
    arrival: track.steps[call.firstStep].timestamp,
    // The last berthed step is a step long, so departure is one step past it.
    departure: new Date(
      parseTs(track.steps[call.lastStep].timestamp) + STEP_HOURS * 3600000,
    )
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
  }));
}

/**
 * The next `count` calls after the one a request was raised on, each with the
 * sailing time to reach it and the time it spends alongside.
 *
 * Both figures are needed separately: transit burns at one rate and berth at
 * another, and a compliance projection that folds them together over a long
 * dwell is wrong in the direction that matters — it overstates the fuel left.
 */
function forwardLegs(calls, fromIndex, count) {
  const legs = [];

  for (let i = fromIndex + 1; i < calls.length && legs.length < count; i++) {
    const call = calls[i];
    const transitDays =
      (parseTs(call.arrival) - parseTs(calls[i - 1].departure)) / 86400000;
    const dwellDays =
      (parseTs(call.departure) - parseTs(call.arrival)) / 86400000;

    legs.push({
      portCode: call.portCode,
      eta: call.arrival,
      transitDays: Math.round(transitDays * 10) / 10,
      dwellDays: Math.round(dwellDays * 10) / 10,
    });
  }

  return legs;
}

// --- run -------------------------------------------------------------------

const specs = readSpecs();
const tracks = readTracks();

// Every stem in the window becomes a candidate request. The desk gets the ones
// furthest into the window, because those are the ones still actionable.
const candidates = [];
for (const track of tracks) {
  const spec = specs.get(track.vessel);
  if (!spec || !Number.isFinite(spec.maxRobMt)) continue;

  const calls = berthCalls(track);
  if (calls.length === 0) continue;

  for (const [step, entry] of track.steps.entries()) {
    if (entry.stems.length === 0) continue;

    // Which call this stem was lifted on. A stem always happens alongside.
    const callIndex = calls.findIndex(
      (call) =>
        call.portCode === entry.portCode &&
        parseTs(entry.timestamp) >= parseTs(call.arrival) &&
        parseTs(entry.timestamp) < parseTs(call.departure),
    );
    if (callIndex === -1) continue;

    const legs = forwardLegs(calls, callIndex, FORWARD_LEGS);
    // A partial chain is worse than useless here: the desk would be shown a
    // two-port horizon and asked to plan three ports ahead against it. Requests
    // near the end of the movement window simply do not qualify.
    if (legs.length < FORWARD_LEGS) continue;

    for (const stem of entry.stems) {
      candidates.push({ track, spec, step, entry, stem, legs });
    }
  }
}

if (candidates.length === 0) {
  throw new Error("no stems found in the movement series");
}

// Latest first, then one request per vessel so the inbox is not five rows of
// the same ship — a desk works a fleet, not a hull.
candidates.sort((a, b) => b.entry.timestamp.localeCompare(a.entry.timestamp));

const seenVessels = new Set();
const chosen = [];
for (const candidate of candidates) {
  if (chosen.length >= TARGET_REQUESTS) break;
  if (seenVessels.has(candidate.track.vessel)) continue;

  seenVessels.add(candidate.track.vessel);
  chosen.push(candidate);
}

if (chosen.length === 0) {
  throw new Error(
    `no stem had ${FORWARD_LEGS} onward calls to plan against — the movement ` +
      "window may be too short",
  );
}

const requests = chosen.map(({ track, spec, step, entry, stem, legs }, i) => {
  const r = rng(`request|${track.vessel}|${step}`);

  const grade = priceSeriesFor(stem.tank, entry.portCode);
  const etd = new Date(
    Date.parse(entry.timestamp.replace(" ", "T") + "Z") +
      (1 + r() * 1.5) * 86400000,
  )
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

  // Raised a few days before arrival, which is what the lead-time check on the
  // supplier panel is measured against.
  const raised = new Date(
    Date.parse(entry.timestamp.replace(" ", "T") + "Z") -
      (4 + Math.floor(r() * 6)) * 86400000,
  )
    .toISOString()
    .slice(0, 10);

  return {
    id: `REQ-${String(i + 1).padStart(3, "0")}`,
    raised,
    vessel: track.vessel,
    serviceCode: track.serviceCode,
    portCode: entry.portCode,
    tank: stem.tank,
    grade,
    quantityMt: Math.round(stem.mt),
    eta: entry.timestamp,
    etd,
    robMt: Math.round(stem.robMt),
    maxRobMt: Math.round(spec.maxRobMt),
    minRobMt: Math.round(spec.minRobMt),
    transitPerDay: spec.transitPerDay,
    berthPerDay: spec.berthPerDay,
    scrubber: spec.scrubber,
    legs,
  };
});

// --- asserts ---------------------------------------------------------------

const seenIds = new Set();
for (const req of requests) {
  if (seenIds.has(req.id)) throw new Error(`duplicate request id ${req.id}`);
  seenIds.add(req.id);

  if (!(req.quantityMt > 0)) {
    throw new Error(`${req.id}: a zero-tonne request is not a request`);
  }
  if (!(req.transitPerDay > 0)) {
    throw new Error(`${req.id}: ${req.vessel} has no transit consumption rate`);
  }
  if (req.legs.length === 0) {
    throw new Error(`${req.id}: no forward legs`);
  }
  if (req.legs.length !== FORWARD_LEGS) {
    throw new Error(
      `${req.id}: ${req.legs.length} forward legs, expected ${FORWARD_LEGS}`,
    );
  }
  for (const leg of req.legs) {
    // A non-positive transit means the berth-call detection collapsed two calls
    // into one, which would understate the burn to that port.
    if (!(leg.transitDays > 0)) {
      throw new Error(
        `${req.id}: leg to ${leg.portCode} has transit ${leg.transitDays}d`,
      );
    }
    if (!(leg.dwellDays > 0)) {
      throw new Error(
        `${req.id}: leg to ${leg.portCode} has dwell ${leg.dwellDays}d`,
      );
    }
  }
  if (req.eta >= req.etd) {
    throw new Error(`${req.id}: ETD ${req.etd} is not after ETA ${req.eta}`);
  }
  if (req.raised >= req.eta.slice(0, 10)) {
    throw new Error(`${req.id}: raised ${req.raised} on or after arrival`);
  }
}

// --- write -----------------------------------------------------------------

const HEADER = [
  "Request_ID",
  "Raised_Date",
  "Vessel",
  "Service_Code",
  "Port_Code",
  "Tank",
  "Grade",
  "Quantity_MT",
  "ETA",
  "ETD",
  "ROB_MT",
  "Max_ROB_MT",
  "Min_ROB_MT",
  "Consumption_Transit_MT_Per_Day",
  "Consumption_Berth_MT_Per_Day",
  "Scrubber_Fitted",
  "Forward_Legs",
  "Source_Basis",
  "Data_Notes",
];

const csvCell = (v) => (String(v).includes(",") ? `"${v}"` : String(v));

const lines = [HEADER.join(",")];
for (const req of requests) {
  lines.push(
    [
      req.id,
      req.raised,
      csvCell(req.vessel),
      req.serviceCode,
      req.portCode,
      req.tank,
      req.grade,
      req.quantityMt,
      req.eta,
      req.etd,
      req.robMt,
      req.maxRobMt,
      req.minRobMt,
      req.transitPerDay,
      req.berthPerDay,
      req.scrubber ? "Yes" : "No",
      csvCell(
        req.legs
          .map(
            (l) =>
              `${l.portCode}@${l.eta}@${l.transitDays}@${l.dwellDays}`,
          )
          .join(";"),
      ),
      "simulated",
      csvCell(
        "Vessel, port, rotation and timing from PIL_Fleet_Live_Movement.csv; " +
          "the requisition itself is simulated. See data/README.md",
      ),
    ].join(","),
  );
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");

console.log(
  `bunker_requests.csv: ${requests.length} open requests across ` +
    `${new Set(requests.map((r) => r.portCode)).size} ports, ` +
    `${FORWARD_LEGS} forward legs each`,
);
