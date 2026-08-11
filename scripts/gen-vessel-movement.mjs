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
const ENERGY_PER_MT = path.join(DATA, "emissions", "energy_per_mt.csv");
const ECA_ZONE_WINDOWS = path.join(DATA, "derived", "eca_zone_windows.json");
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
  // Every vessel carries exactly one compliance tank — MGO, MEOH, LNG or
  // B40 — chosen by COMPLIANCE_FUEL below. The other three compliance
  // columns are present for every vessel anyway, same convention as HSFO
  // for a non-scrubber hull: flat "0" throughout for whichever three this
  // vessel doesn't carry.
  "MGO_ROB_MT",
  "MEOH_ROB_MT",
  "LNG_ROB_MT",
  "B40_ROB_MT",
  "VLSFO_Bunkered_MT",
  "HSFO_Bunkered_MT",
  "MGO_Bunkered_MT",
  "MEOH_Bunkered_MT",
  "LNG_Bunkered_MT",
  "B40_Bunkered_MT",
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

  // Asia-Europe services, added with the Main - PIL Intra Asia + Europe
  // Services (Google Drive) workbook. All nine deployments are derived, not
  // published, drawn from vessels otherwise unused in the specifications
  // file. AE1/AE2/AE3/AE5 carry vessels widened above the fleet-standard
  // Max_ROB_MT ratio — see PIL_Fleet_Vessel_Specifications.csv Data_Notes —
  // because their longest leg (23-26 days) exceeds every vessel's standard
  // 22.2-day bunker autonomy.
  ["AE1", ["KOTA EAGLE", "KOTA EBONY", "KOTA EMERALD"]],
  ["AE2", ["KOTA ELAN", "KOTA ELOK", "KOTA EMBUN"]],
  ["AE3", ["KOTA PEONY", "KOTA PLUMBAGO", "KOTA PRIMROSE"]],
  ["AE4", ["KOTA SYDNEY", "KOTA TEMA", "KOTA VALPARAISO"]],
  ["AE5", ["KOTA PAHLAWAN", "KOTA PELANGI", "KOTA PURI"]],
  ["AE6", ["KOTA OASIS", "KOTA OCEAN", "KOTA ODYSSEY"]],
  ["AE7", ["KOTA MANZANILLO", "KOTA SANTOS", "KOTA ORKID"]],
  ["MEDI", ["KOTA PUSAKA", "KOTA LIMA", "KOTA LEGIT"]],
  ["EUROMED", ["KOTA LEKAS", "KOTA LEMBAH", "KOTA LAMBAI"]],
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
  AE1:
    "Deployment derived: PIL does not publish AE1 vessel names or tonnage. KOTA EAGLE, " +
    "KOTA EBONY and KOTA EMERALD (14,450 TEU) carry Max_ROB_MT and Bunkering_Trigger_MT " +
    "raised above the fleet-standard ratio because this service's 24-26 day Singapore-" +
    "Europe crossings exceed the fleet's standard 22.2-day bunker autonomy; see " +
    "PIL_Fleet_Vessel_Specifications.csv Data_Notes.",
  AE2:
    "Deployment derived: PIL does not publish AE2 vessel names or tonnage. KOTA ELAN, " +
    "KOTA ELOK and KOTA EMBUN (13,064-14,410 TEU) carry Max_ROB_MT and " +
    "Bunkering_Trigger_MT raised above the fleet-standard ratio because this service's " +
    "24-25 day Singapore-Europe crossings exceed the fleet's standard 22.2-day bunker " +
    "autonomy; see PIL_Fleet_Vessel_Specifications.csv Data_Notes.",
  AE3:
    "Deployment derived: PIL does not publish AE3 vessel names or tonnage. KOTA PEONY, " +
    "KOTA PLUMBAGO and KOTA PRIMROSE (13,082 TEU) carry Max_ROB_MT and " +
    "Bunkering_Trigger_MT raised above the fleet-standard ratio because this service's " +
    "23-25 day Singapore/Hamburg-Qingdao crossings exceed the fleet's standard 22.2-day " +
    "bunker autonomy; see PIL_Fleet_Vessel_Specifications.csv Data_Notes.",
  AE4:
    "Deployment derived: PIL does not publish AE4 vessel names or tonnage. KOTA SYDNEY, " +
    "KOTA TEMA and KOTA VALPARAISO (7,092 TEU) sail this service's shortest AE loop at " +
    "the fleet-standard Max_ROB_MT ratio, which comfortably clears its 22-day longest leg.",
  AE5:
    "Deployment derived: PIL does not publish AE5 vessel names or tonnage. KOTA " +
    "PAHLAWAN, KOTA PELANGI and KOTA PURI (11,923 TEU) carry Max_ROB_MT and " +
    "Bunkering_Trigger_MT raised above the fleet-standard ratio because this service's " +
    "24-26 day Singapore/Le Havre crossings exceed the fleet's standard 22.2-day bunker " +
    "autonomy; see PIL_Fleet_Vessel_Specifications.csv Data_Notes.",
  AE6:
    "Deployment derived: PIL does not publish AE6 vessel names or tonnage. KOTA OASIS, " +
    "KOTA OCEAN and KOTA ODYSSEY (8,350 TEU) sail the fleet-standard Max_ROB_MT ratio, " +
    "which clears this service's 21-22 day longest legs.",
  AE7:
    "Deployment derived: PIL does not publish AE7 vessel names or tonnage. KOTA " +
    "MANZANILLO, KOTA SANTOS and KOTA ORKID (8,350-8,533 TEU) sail the fleet-standard " +
    "Max_ROB_MT ratio, which clears this service's 22-day longest leg. The only AE " +
    "service originating on the Indian subcontinent rather than East or Southeast Asia.",
  MEDI:
    "Deployment derived: PIL does not publish MEDI vessel names or tonnage. KOTA " +
    "PUSAKA, KOTA LIMA and KOTA LEGIT sail the fleet-standard Max_ROB_MT ratio; every " +
    "leg on this rotation is 7 days or shorter, so no widened tank is needed even " +
    "though the loop runs Singapore to North Europe and back via Suez.",
  EUROMED:
    "Deployment derived: PIL does not publish EUROMED vessel names or tonnage. KOTA " +
    "LEKAS, KOTA LEMBAH and KOTA LAMBAI sail the fleet-standard Max_ROB_MT ratio; every " +
    "leg on this rotation is 6 days or shorter, the same as MEDI, whose Mediterranean " +
    "and North Europe rotation this service shares.",
};

// --- Fuel: compliance, supply and the ECA switch --------------------------

/**
 * Ports where the fleet must burn 0.10% S fuel, i.e. LSMGO.
 *
 * Four regulatory zones, all port-list rather than polygon (the fleet has no
 * continuous position — schematic arcs, no synthetic lat/lon — so "in an ECA"
 * can only mean "near a call at one of these ports", the same approximation
 * the original 11-port set already made):
 *
 *  - China's national port ECA (nine coastal ports) and Korea's (Busan,
 *    Incheon) — a port list rather than an IMO SECA either way.
 *  - The North Sea & English Channel ECA — Rotterdam, Antwerp, Hamburg, Le
 *    Havre, Southampton, Felixstowe.
 *  - The Mediterranean SOx ECA (IMO-designated, effective 2025) — Algeciras,
 *    Piraeus, Malta, Port Said, Valencia.
 *
 * All 22 also publish a Bunker_Quantity_MT somewhere in this fleet's
 * schedules, which is what lets a vessel top its MGO up inside a window
 * rather than having to carry the whole stretch from outside.
 *
 * VLSFO does not clear this: it is 0.50% S against a 0.10% limit. Switching
 * between the two residual grades would look like compliance without being it,
 * which is why MGO has to be the switch fuel.
 *
 * The North Sea/Channel and Mediterranean ports were deliberately left out of
 * this set until the MGO tank was resized to fit their longer, sometimes
 * merged windows (Le Havre-Southampton-Felixstowe-Antwerp-Rotterdam-Hamburg
 * can flag as one continuous stretch) — see MGO_MAX_RATIO. Also NOT here:
 * TWKHH (Kaohsiung) — Taiwan isn't covered by the China/Korea national-ECA
 * rule this set otherwise encodes, and there's no evidence otherwise.
 *
 * This set is ground truth for BERTHED steps only — a vessel alongside one of
 * these ports is unconditionally on 0.10% S fuel, regardless of map geometry.
 * TRANSIT steps are decided by ECA_ZONE_PROFILE below instead: a call window
 * (this set's ECA_LEAD_STEPS/ECA_TRAIL_STEPS) covers only ~1 day either side
 * of a call, but the shaded zones the map draws (src/lib/ecaZones.ts) are
 * generous envelopes — the Mediterranean SOx ring alone spans Gibraltar to
 * Port Said — so a multi-day crossing or coastal hop sits inside a zone far
 * longer than that window, and the map would otherwise show a vessel burning
 * VLSFO/HSFO while its marker sits inside yellow.
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
  "CNYTN", // Yantian - same China national port ECA as the rest of the coast
  "KRINC", // Incheon
  "KRPUS", // Busan

  // North Sea & English Channel ECA
  "NLRTM", // Rotterdam
  "BEANR", // Antwerp
  "DEHAM", // Hamburg
  "FRLEH", // Le Havre
  "GBSOU", // Southampton
  "GBFXT", // Felixstowe

  // Mediterranean SOx ECA
  "ESALG", // Algeciras
  "GRPIR", // Piraeus
  "MTMLA", // Malta
  "EGPSD", // Port Said
  "ESVLC", // Valencia
]);

/** Switch to MGO one day before berthing at an ECA port. */
const ECA_LEAD_STEPS = STEPS_PER_DAY;

/** Switch back a few hours after leaving: one 3-hour step. */
const ECA_TRAIL_STEPS = 1;

/**
 * Per-leg [startFraction, endFraction) windows during which the vessel's
 * charted position sits inside a shaded ECA/DECA zone, keyed "FROM>TO".
 *
 * Written by scripts/gen-eca-zone-profile.mjs from the same route geometry
 * the map renders (src/lib/searoutes.ts + src/lib/ecaZones.ts) — re-run that
 * script first if either changes, or this goes stale the way a modelled price
 * column does after a hub refresh. Empty array means the leg never enters a
 * zone; a missing key for a leg the timetable actually sails is a bug (the
 * lookup below throws rather than silently treating it as empty).
 */
const ECA_ZONE_PROFILE = JSON.parse(fs.readFileSync(ECA_ZONE_WINDOWS, "utf8"));

/**
 * Ports with no high-sulphur bunker market.
 *
 * Held as a literal rather than read from data/pricing/, which the generator
 * deliberately does not parse. The evidence is there though: none of these has
 * an HSFO column in "HSGO Prices.csv", and bunker_basis.csv models no HSFO
 * basis for them either — researched and recorded in data/README.md as an
 * absence of market, not an absence of data.
 *
 * This is the constraint the previous generator lacked. Assigning grade purely
 * by scrubber fitting put HSFO stems at Chittagong and Yangon, where no such
 * stem could be lifted. A scrubber vessel calling here lifts VLSFO into its
 * secondary residual tank instead — which is the whole reason a scrubber vessel
 * needs a second residual grade at all.
 *
 * Laem Chabang is deliberately NOT in this list: LAEMCHABANG HSFO carries
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

  // Added with the Asia-Europe services. Unlike the entries above, these
  // three aren't CE-sheet findings — Algeciras, Piraeus and Malta have no
  // assessed HSFO column in HSGO Prices.csv and none is added for them in
  // this change either (out of scope). Without this, a scrubber vessel
  // routed through MEDI/EUROMED could stem HSFO here and the bunker log
  // would render that stem with a null price — the silent valuation gap this
  // set exists to prevent.
  "ESALG", // Algeciras - no priced HSFO market
  "GRPIR", // Piraeus - no priced HSFO market
  "MTMLA", // Malta - no priced HSFO market
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
 * Raised from 0.2 to 0.4 when ECA coverage extended to the North Sea/Channel
 * and Mediterranean SOx zones: those ports' windows can merge into stretches
 * longer than the original ~4.4-day autonomy covered. Held at 0.4 through a
 * second, bigger change — position-based ECA detection (ECA_ZONE_PROFILE) —
 * because that change's real fix was the MGO stem lift, not this ratio: MGO
 * used to cap each stem at a fifth of the published quantity, which could
 * never keep pace once transit time inside a zone stopped being a ~1-day
 * approximation. See the MGO stem comment below. checkInvariants' tightest
 * case at 0.4 is AE7's KOTA ORKID; raise this further if a future rotation
 * change breaches the MGO floor again. Mirrored as MGO_TANK_RATIO in
 * src/lib/types.ts.
 */
const MGO_MAX_RATIO = 0.4;

/** Floor and trigger as fractions of the MGO tank, mirroring the residual ones. */
const MGO_MIN_RATIO = 1 / 3;
const MGO_TRIGGER_RATIO = 1 / 2;

/**
 * The MGO stem lifts up to the full published Bunker_Quantity_MT, capped by
 * tank room — exactly the residual formula (`Math.min(qty, max - residual)`
 * above), no separate ratio.
 *
 * Used to be capped at a fifth of the published quantity (the same fraction
 * the tank itself was, "so the figure stays anchored to published data
 * rather than invented outright"): a 0.6 MT/day MGO tank drawn down over a
 * ~1-day call window never needed more. Position-based ECA detection (see
 * ECA_ZONE_PROFILE) broke that: the North Sea/Channel and Mediterranean
 * zones are large enough that a vessel hopping Algeciras-Le Havre-Antwerp-
 * Rotterdam-Hamburg-Valencia (MEDI's KOTA PUSAKA) burns roughly 2,460 MT of
 * MGO across one 42-day loop — a fifth of a 600 MT call could never keep up
 * regardless of how large the tank was sized, a structural shortfall no
 * MGO_MAX_RATIO increase fixes. Every stop on that chain publishes a
 * quantity anyway (600-1,200 MT), so lifting the same way residual does is
 * the direct fix, not an invented one.
 */

/**
 * Energy demand, not mass, is what's proportional to DWT.
 *
 * Consumption_Transit_MT_Per_Day / Consumption_Berth_MT_Per_Day
 * (vessel_assumptions.csv: 0.09%/0.015% of DWT_MT/day) were, until now, burned
 * as a flat mass rate regardless of grade — a tonne of MGO and a tonne of HSFO
 * cost the same ROB to deliver the same nautical mile, which isn't physically
 * true. The two grades hold different energy content (data/emissions/
 * energy_per_mt.csv): MGO is 42.7 GJ/mt, VLSFO 41.7, HSFO 40.2.
 *
 * So the propulsive demand is now modelled as energy, `GJ/day = c x DWT_MT`,
 * flat across the fleet under the constant-speed assumption (no vessel sails
 * faster or slower than another), and mass burned per step is derived from
 * whichever grade is actually lit. `c` is calibrated so a vessel burning
 * VLSFO outside an ECA reproduces today's MT/day exactly — 0.0009 x 41.7 for
 * transit, 0.00015 x 41.7 for berth — so the only observable change outside
 * an ECA window is a scrubber vessel's HSFO rate diverging slightly from the
 * VLSFO baseline (40.2 vs 41.7 GJ/mt: slightly more HSFO mass for the same
 * energy), and MGO burns measurably less mass per day than VLSFO would for
 * the same work (42.7 vs 41.7 GJ/mt) wherever an ECA window forces it.
 */
const ENERGY_RATE_TRANSIT_GJ_PER_DWT_DAY = 0.0009 * 41.7;
const ENERGY_RATE_BERTH_GJ_PER_DWT_DAY = 0.00015 * 41.7;

/** Energy content per tonne, by tank grade. Read from energy_per_mt.csv. */
function loadEnergyPerMt() {
  const rows = readCsv(ENERGY_PER_MT);
  const byGrade = new Map(rows.map((r) => [cell(r, "Grade"), Number(cell(r, "Energy_Content_GJ_Per_MT"))]));
  const gjPerMt = {};
  for (const grade of ["HSFO", "VLSFO", "MGO", "MEOH", "LNG", "B40"]) {
    const v = byGrade.get(grade);
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`energy_per_mt.csv: missing or bad Energy_Content_GJ_Per_MT for ${grade}`);
    }
    gjPerMt[grade] = v;
  }
  return gjPerMt;
}

// --- Alternative ECA-compliance fuels, on small subsets -------------------

/**
 * The ECA-compliance tank does not have to be MGO. Anything that isn't
 * VLSFO/HSFO clears the 0.10% cap — distillates, gas, biofuel, methanol.
 * This fleet models three alternatives, each on a real vessel subset,
 * because each is the only grade with a real priced market in this dataset
 * to stem it against. Inventing a price at a port with no assessed or
 * modelled column, the way this dataset never does for conventional grades
 * either (see CLAUDE.md "Most price columns are modelled"), would be worse
 * than not modelling it at all.
 *
 * Each grade started as a 2-vessel pilot on a single service (KCI/methanol,
 * CVI/LNG, NCI/B40) and was widened in two later passes, first across
 * every intra-Asia service whose own rotation touches that grade's supply
 * port(s), then onto a handful of Asia-Europe services too. B40 stayed
 * intra-Asia-only throughout — Jakarta/Surabaya are the only B40-priced
 * ports anywhere in this dataset, and no Europe-touching service calls
 * either.
 *
 * The Asia-Europe widening (MEOH/LNG only) needed more than just a
 * qualifying port. Every alternative-fuel supply port sits in Asia, and the
 * compliance tank only draws down inside an ECA window — fine on an
 * intra-Asia loop, where the port that triggers the ECA switch is usually
 * the supply port too. On an Asia-Europe loop the vessel fills once in Asia
 * and then has to survive the entire Europe-side ECA exposure (North
 * Sea/Channel, sometimes Mediterranean) with zero resupply chance before
 * its next Asia call — an MGO-tanked vessel doesn't have this problem,
 * since it can still buy MGO at almost any European port along the way
 * (NO_MGO_PORTS is a short exclusion list). MEOH_MAX_RATIO/LNG_MAX_RATIO
 * carry a x2.3 buffer on top of their base energy-density figure to cover
 * this — raised empirically against checkInvariants, the same way
 * MGO_MAX_RATIO itself went 0.2->0.4 for the same class of window, and
 * large enough that it changed the *intra-Asia* vessels' tightest margin
 * too (harmlessly — a bigger tank never hurts a vessel with frequent supply
 * chances). Even at x2.3, a handful of Asia-Europe candidates still failed
 * checkInvariants and were left on MGO rather than pushing the buffer
 * further for their sake: KOTA OCEAN/AE6, KOTA SYDNEY/AE4 (AE4's only
 * LNG-adjacent port, Shanghai, is touched once per 70-day loop — the
 * weakest coverage of any candidate tried), and KOTA PUSAKA/MEDI (Singapore
 * only at the loop's start/end). Each retested cleanly at a *lower* buffer
 * value than a candidate that ultimately passed, then failed again at a
 * higher one on a later attempt — the deficit does not move monotonically
 * with the ratio (a bigger tank can mean the trigger check decides *not* to
 * top up at the last safe port before the long Europe stretch, since it
 * looks comfortably full relative to a bigger floor), so don't assume
 * raising the buffer further would rescue them without retesting.
 *
 * - **Methanol** (MEOH) — KOTA SEGAR/KOTA SEJARAH (KCI, the original pilot:
 *   Ningbo every 24-day loop), plus ASTERIOS (CVI, 35-day loop, 1 Ningbo
 *   touch) — 3 vessels total, all intra-Asia. (Ningbo is MEOH's only supply
 *   port in this dataset, so an Asia-Europe methanol candidate has just one
 *   fill per loop to cover the entire round trip; the one tried, KOTA
 *   LEKAS/EUROMED, failed checkInvariants even at the x2.3 buffer and was
 *   left on MGO.)
 * - **LNG** — KOTA NAGA/KOTA NALURI (CVI, the original pilot: 4 of the 5
 *   LNG-priced ports on one 35-day loop, Shanghai/Ningbo being China-ECA
 *   ports so the grade switch and the bunkering opportunity coincide), plus
 *   every other intra-Asia service whose rotation both touches an LNG port
 *   *and* actually enters an ECA (BD1, BD2, CAS, YGS never do — see "10 of
 *   the 35 vessels never enter an ECA" in data/README.md — so a compliance
 *   tank there would be functionally inert, always full, never stemmed;
 *   tried on BD1/BD2/YGS first and swapped out once the flat ROB column
 *   made that obvious) — KOTA SEJATI (NCI), KOTA JOHAN/KOTA NABIL (CVI's
 *   3rd and 4th), KOTA GABUNG/KOTA GADANG/KOTA GANDING/KOTA GAYA (KCS, all
 *   4 — 28-day loop touching 3 of the 5 LNG ports, the richest coverage of
 *   any service here), KOTA SETIA (KCI's 4th), KOTA SABAS (NCI's 5th),
 *   KOTA HANDAL/KOTA HARUM (VCS, both), KOTA RIA/KOTA RUKUN/KOTA RAKYAT
 *   (CCS, all 3 — 1 Singapore touch/21-day loop, and Xiamen/Shekou are
 *   China-ECA ports so the tank does draw down) — and 7 Asia-Europe vessels
 *   once the x2.3 buffer covered their Europe-side exposure: KOTA EBONY
 *   (AE1), KOTA ELAN (AE2), KOTA PLUMBAGO (AE3), KOTA PELANGI/KOTA PURI
 *   (AE5, both — the 2nd confirmed the 1st wasn't a one-off), KOTA LEMBAH/
 *   KOTA LAMBAI (EUROMED, both) — 23 vessels total.
 * - **B40 biofuel** (60% MGO / 40% FAME — see data/emissions/energy_per_mt.csv;
 *   B24, 76% VLSFO/24% FAME, is a residual-grade analog and not
 *   ECA-compliant, so it is deliberately not modelled as a burned grade
 *   here) — KOTA SAHABAT/KOTA SALAM (NCI, the original pilot: the only
 *   service calling both B40-priced ports, Jakarta and Surabaya, 4 days
 *   apart on a 35-day loop), plus KOTA SEMPENA (NCI's 3rd, same loop) and
 *   KOTA SINGA (KCI, a single Jakarta touch per 28-day loop) — 4 vessels
 *   total, all intra-Asia; no Europe-touching service calls either
 *   B40-priced port.
 *
 * 30 of the fleet's 62 vessels now carry a non-MGO compliance tank; MGO
 * remains the majority default on the rest, including most Asia-Europe/
 * Med/EUROMED vessels (see above for the ones that aren't), every service
 * with no qualifying alternative-fuel port at all (CAS, SCT, AE7), and BD1/
 * BD2/YGS, which have a qualifying port (Singapore) but never enter an ECA
 * at all, so any compliance grade there is inert — MGO is the harmless
 * choice for a tank that never moves either way.
 */
const METHANOL_VESSELS = new Set(["KOTA SEGAR", "KOTA SEJARAH", "ASTERIOS"]);
const LNG_VESSELS = new Set([
  "KOTA NAGA",
  "KOTA NALURI",
  "KOTA SEJATI",
  "KOTA GABUNG",
  "KOTA GADANG",
  "KOTA HANDAL",
  "KOTA JOHAN",
  "KOTA GANDING",
  "KOTA GAYA",
  "KOTA SETIA",
  "KOTA SABAS",
  "KOTA HARUM",
  "KOTA RIA",
  "KOTA RUKUN",
  "KOTA RAKYAT",
  "KOTA NABIL",
  "KOTA EBONY",
  "KOTA ELAN",
  "KOTA PLUMBAGO",
  "KOTA PELANGI",
  "KOTA PURI",
  "KOTA LEMBAH",
  "KOTA LAMBAI",
]);
const B40_VESSELS = new Set(["KOTA SAHABAT", "KOTA SALAM", "KOTA SEMPENA", "KOTA SINGA"]);

/**
 * Vessel name -> compliance grade. Absent means the fleet-standard "MGO".
 * The single source of truth for which vessel carries which alternative
 * compliance tank; COMPLIANCE_RATIOS and hasComplianceMarketFor below key
 * off the grade this resolves to.
 */
const COMPLIANCE_FUEL = new Map([
  ...[...METHANOL_VESSELS].map((n) => [n, "MEOH"]),
  ...[...LNG_VESSELS].map((n) => [n, "LNG"]),
  ...[...B40_VESSELS].map((n) => [n, "B40"]),
]);
const complianceGradeFor = (name) => COMPLIANCE_FUEL.get(name) ?? "MGO";

/**
 * Each alternative tank's ratio of Max_ROB_MT — same role as MGO_MAX_RATIO,
 * for whichever vessel carries that tank instead. For the same days of
 * ECA-window autonomy as the MGO tank, each starts from
 * MGO_MAX_RATIO x (42.7 / grade's own GJ/mt) — smaller than MGO's for a
 * denser fuel (LNG, 48.0 GJ/mt), larger for a less-dense one (MEOH, 19.9;
 * B40, 40.6, diluted by FAME).
 *
 * MEOH and LNG carry a further x2.3 on top of that base figure. Both grades
 * were later widened onto a handful of Asia-Europe services (see
 * METHANOL_VESSELS/LNG_VESSELS above), whose only supply calls are in Asia —
 * so unlike MGO, which can buy fuel at almost any European port along the
 * way, an Asia-Europe MEOH/LNG vessel fills once and must survive the whole
 * Europe-side ECA exposure on that one fill. x2.3 was reached empirically
 * against checkInvariants, the same way MGO_MAX_RATIO itself went 0.2->0.4
 * for the same class of window — raised in steps (2x, 2.1x, 2.3x), watching
 * which Asia-Europe candidate vessel failed and by how much at each step.
 * The failure margin did not shrink monotonically with the ratio (a bigger
 * tank can mean the trigger logic decides *not* to top up at the last safe
 * port, since the tank looks comfortably full against a proportionally
 * bigger floor) — three candidates (KOTA OCEAN/AE6, KOTA SYDNEY/AE4, KOTA
 * PUSAKA/MEDI, plus methanol's KOTA LEKAS/EUROMED) still failed at x2.3 and
 * were left on MGO rather than chasing the ratio further for their sake.
 * B40 never needed this buffer — it stayed intra-Asia-only, since no
 * Europe-touching service calls a B40-priced port at all.
 *
 * Real cryogenic LNG tanks are physically bulkier than this mass-only ratio
 * implies (Type-C tank insulation/pressure-vessel overhead) — this model
 * tracks autonomy-days, not volume, the same simplification MEOH's larger
 * ratio already documents in the opposite direction.
 */
const MEOH_MAX_RATIO = MGO_MAX_RATIO * (42.7 / 19.9) * 2.3;
const LNG_MAX_RATIO = MGO_MAX_RATIO * (42.7 / 48.0) * 2.3;
const B40_MAX_RATIO = MGO_MAX_RATIO * (42.7 / 40.6);

/** Floor and trigger as fractions of each tank, mirroring MGO's. */
const MEOH_MIN_RATIO = MGO_MIN_RATIO;
const MEOH_TRIGGER_RATIO = MGO_TRIGGER_RATIO;
const LNG_MIN_RATIO = MGO_MIN_RATIO;
const LNG_TRIGGER_RATIO = MGO_TRIGGER_RATIO;
const B40_MIN_RATIO = MGO_MIN_RATIO;
const B40_TRIGGER_RATIO = MGO_TRIGGER_RATIO;

const COMPLIANCE_GRADES = ["MGO", "MEOH", "LNG", "B40"];
const COMPLIANCE_RATIOS = {
  MGO: { max: MGO_MAX_RATIO, min: MGO_MIN_RATIO, trigger: MGO_TRIGGER_RATIO },
  MEOH: { max: MEOH_MAX_RATIO, min: MEOH_MIN_RATIO, trigger: MEOH_TRIGGER_RATIO },
  LNG: { max: LNG_MAX_RATIO, min: LNG_MIN_RATIO, trigger: LNG_TRIGGER_RATIO },
  B40: { max: B40_MAX_RATIO, min: B40_MIN_RATIO, trigger: B40_TRIGGER_RATIO },
};

/**
 * The ports in this dataset with a priced market for each alternative
 * compliance grade (CLAUDE.md, "Beyond the fossil grades the sheet adds
 * four fuels"). Inclusion-based, the opposite convention from NO_MGO_PORTS
 * and its siblings: those exclude a handful of ports from an
 * otherwise-universal market, but these grades have no market at all except
 * at these ports, so listing what each *does* have is the honest shape of
 * the data.
 */
const MEOH_SUPPLY_PORTS = new Set(["CNNGB"]);
const LNG_SUPPLY_PORTS = new Set(["CNNGB", "CNSHA", "MYPKG", "SGSIN", "VNSGN"]);
const B40_SUPPLY_PORTS = new Set(["IDJKT", "IDSUB"]);

/** Whether `grade`, as a vessel's compliance tank, can be stemmed at `port`. */
const hasComplianceMarketFor = (grade, port) => {
  if (grade === "MGO") return !NO_MGO_PORTS.has(port);
  if (grade === "MEOH") return MEOH_SUPPLY_PORTS.has(port);
  if (grade === "LNG") return LNG_SUPPLY_PORTS.has(port);
  return B40_SUPPLY_PORTS.has(port);
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
  /** step -> true where the vessel must be on 0.10% S fuel. Filled below. */
  const eca = new Array(steps).fill(false);
  /** step -> the quantity published for the call berthing at that step. */
  const bunkerQty = new Map();

  const body = dated.slice(0, -1);
  let cursor = 0;
  // The leg into body[0] is split across the step-0 boundary: its tail lives
  // at the end of this array (sailing toward the loop-closing call) and its
  // head is body[0]'s own transit. Captured here so the two can be marked as
  // one leg after the loop, instead of each being fraction-mapped as if it
  // were the whole thing.
  let body0Start = null;

  body.forEach((call, i) => {
    const code = cell(call, "Port_Code");
    const name = cell(call, "Port_Name");
    if (!code || !name) throw new Error(`${serviceCode} seq ${i + 1}: blank Port_Code or Port_Name`);

    // The port this transit segment sails FROM, for the zone-profile lookup
    // below. The rotation is cyclic, so the first body call's predecessor is
    // the last one — the loop-closing row repeats the first port, so this is
    // the same pairing PIL_Intra_Asia_Port_Calls.csv itself sails.
    const fromCode = i === 0 ? cell(body[body.length - 1], "Port_Code") : cell(body[i - 1], "Port_Code");

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

    // Position-based ECA: mark transit steps whose fraction along this leg
    // falls inside a shaded zone, from the precomputed geometry profile — see
    // ECA_ZONE_PROFILE above. Independent of, and additional to, the
    // call-window marking below; both only ever set eca[s] true.
    //
    // i === 0 is deferred: its transit segment is only the head of the leg
    // that wraps around the step-0 boundary (see body0Start above), and
    // fraction-mapping it alone against the full-leg profile would be wrong.
    if (i === 0) {
      body0Start = berthStart;
    } else if (fromCode !== code) {
      const intervals = ECA_ZONE_PROFILE[`${fromCode}>${code}`];
      if (intervals === undefined) {
        throw new Error(
          `${serviceCode} seq ${i + 1}: no zone profile for ${fromCode}>${code} — ` +
            `re-run scripts/gen-eca-zone-profile.mjs`,
        );
      }
      const segLen = berthStart - cursor;
      if (segLen > 0 && intervals.length > 0) {
        for (let s = cursor; s < berthStart; s++) {
          const frac = (s - cursor) / segLen;
          if (intervals.some(([a, b]) => frac >= a && frac < b)) eca[s] = true;
        }
      }
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

  // The deferred wraparound leg (last body call -> body[0], split across the
  // step-0 boundary: tail here, head at body0Start above). closeCode is the
  // same port as body[0] by construction (the loop-closing row repeats the
  // first port), so this is exactly the pair PIL_Intra_Asia_Port_Calls.csv
  // sails between them.
  {
    const fromCode = cell(body[body.length - 1], "Port_Code");
    const tailStart = cursor;
    const tailLen = steps - tailStart;
    const headLen = body0Start ?? 0;
    const total = tailLen + headLen;
    if (fromCode !== closeCode && total > 0) {
      const intervals = ECA_ZONE_PROFILE[`${fromCode}>${closeCode}`];
      if (intervals === undefined) {
        throw new Error(
          `${serviceCode}: no zone profile for ${fromCode}>${closeCode} — ` +
            `re-run scripts/gen-eca-zone-profile.mjs`,
        );
      }
      if (intervals.length > 0) {
        for (let s = tailStart; s < steps; s++) {
          const frac = (s - tailStart) / total;
          if (intervals.some(([a, b]) => frac >= a && frac < b)) eca[s] = true;
        }
        for (let s = 0; s < headLen; s++) {
          const frac = (tailLen + s) / total;
          if (intervals.some(([a, b]) => frac >= a && frac < b)) eca[s] = true;
        }
      }
    }
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

function buildRows(timetables, specByName, gjPerMt) {
  const rows = [];
  const stems = { VLSFO: 0, HSFO: 0, MGO: 0, MEOH: 0, LNG: 0, B40: 0 };
  let clipped = 0;
  let ecaSwitches = 0;
  let tightestResidual = Infinity;
  let tightestCompliance = Infinity;

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
      const dwt = Number(cell(spec, "DWT_MT"));
      for (const [label, v] of [
        ["Max_ROB_MT", max],
        ["Min_ROB_MT", min],
        ["Bunkering_Trigger_MT", trigger],
        ["DWT_MT", dwt],
      ]) {
        if (!Number.isFinite(v) || v <= 0) throw new Error(`${name}: ${label} is "${v}"`);
      }

      // Energy demand per step, by phase — see ENERGY_RATE_TRANSIT_GJ_PER_DWT_DAY.
      // Converted to mass through whichever grade's own GJ/mt is actually being
      // drawn, not a flat MT figure.
      const energyTransit = (ENERGY_RATE_TRANSIT_GJ_PER_DWT_DAY * dwt) / STEPS_PER_DAY;
      const energyBerth = (ENERGY_RATE_BERTH_GJ_PER_DWT_DAY * dwt) / STEPS_PER_DAY;

      // The ECA-compliance tank, outside Max_ROB_MT. MGO for the fleet at
      // large; MEOH/LNG/B40 for the small subsets in COMPLIANCE_FUEL instead
      // — see COMPLIANCE_RATIOS above. A vessel carries exactly one grade.
      const complianceGrade = complianceGradeFor(name);
      const complianceGjPerMt = gjPerMt[complianceGrade];
      const { max: complianceMaxRatio, min: complianceMinRatio, trigger: complianceTriggerRatio } =
        COMPLIANCE_RATIOS[complianceGrade];
      const complianceMax = round3(max * complianceMaxRatio);
      const complianceMin = round3(complianceMax * complianceMinRatio);
      const complianceTrigger = round3(complianceMax * complianceTriggerRatio);
      // Whether a berth can supply this vessel's compliance grade.
      const hasComplianceMarket = (port) => hasComplianceMarketFor(complianceGrade, port);

      // Sisters are spread around the rotation instead of moving in lockstep.
      const offset = Math.round((k * tt.steps) / vessels.length) % tt.steps;
      const energyAt = (s) => (tt.phase[s] === "Berthed" ? energyBerth : energyTransit);

      // The grade the residual tank projection below converts through — the
      // one a hull actually draws down first, so the projected mass isn't
      // optimistic. A scrubber vessel burns HSFO first (lower GJ/mt than
      // VLSFO, so more mass for the same energy); everyone else burns VLSFO
      // from the first step, exactly matching the burn-down order.
      const residualReferenceGjPerMt = scrubber ? gjPerMt.HSFO : gjPerMt.VLSFO;

      /**
       * Fuel needed to reach the next call that could stem, split by tank.
       *
       * Split because the two tanks drain in different places: an ECA stretch
       * spends MGO and no residual at all. Accumulated unrounded — a decision
       * input, not an emitted value. Energy is converted to a projected mass
       * through each tank's reference grade (residualReferenceGjPerMt for
       * residual, MGO for the distillate tank) — the same reference the
       * burn-down below actually draws down first in each case.
       */
      const needFrom = (i) => {
        let residual = 0;
        let compliance = 0;
        // Separate, because a call can supply one tank and not the other:
        // Kolkata sells HSFO but no distillate, Haiphong the reverse. Stopping
        // at the first call publishing a quantity would have this hull believe
        // it can top up somewhere it cannot, which is the one thing the
        // second trigger clause below exists to prevent.
        let residualAt = null;
        let complianceAt = null;
        for (let j = i + 1; j <= i + tt.steps; j++) {
          const at = (offset + j - 1) % tt.steps;
          if (tt.eca[at]) compliance += energyAt(at) / complianceGjPerMt;
          else residual += energyAt(at) / residualReferenceGjPerMt;

          const s = (offset + j) % tt.steps;
          if (!tt.bunkerQty.has(s)) continue;
          const p = tt.portCode[s];
          if (residualAt === null && canStemResidual(p, scrubber)) residualAt = residual;
          if (complianceAt === null && hasComplianceMarket(p)) complianceAt = compliance;
          if (residualAt !== null && complianceAt !== null) break;
        }
        return {
          residual: residualAt,
          // A rotation with no compliance-grade stop anywhere falls back to
          // the whole loop's burn: conservative, and the floor check below is
          // the arbiter.
          compliance: complianceAt ?? compliance,
          reachable: residualAt !== null,
        };
      };

      // Both residual tanks open full and together fill Max_ROB_MT: a scrubber
      // vessel splits it HSFO/VLSFO, everyone else holds VLSFO alone. Everyone
      // opens with a full MGO tank.
      const reserve = scrubber ? round3(max * VLSFO_RESERVE_RATIO) : max;
      let vlsfo = reserve;
      let hsfo = round3(max - reserve);
      let compliance = complianceMax;
      let previousFuel = null;

      for (let i = 0; i < STEPS; i++) {
        const s = (offset + i) % tt.steps;
        const port = tt.portCode[s];
        const inEca = tt.eca[s];

        let stemV = 0;
        let stemH = 0;
        let stemC = 0;
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

          // --- Compliance tank. Same rule against its own tank, gated the
          // same way on supply. Vessels on rotations that touch no ECA port
          // never burn any, so this never fires for them.
          if (
            hasComplianceMarket(port) &&
            (compliance <= complianceTrigger || compliance - need.compliance < complianceMin)
          ) {
            const lift = round3(Math.min(qty, complianceMax - compliance));
            if (lift > 0) {
              stemC = lift;
              compliance = round3(compliance + lift);
              stems[complianceGrade]++;
            }
          }
        }

        if (i === 0 && (stemV > 0 || stemH > 0 || stemC > 0)) {
          throw new Error(`${name}: stemmed at step 0, which would overwrite the deployment note`);
        }

        // What the main engine is on for this step. Recorded rather than left
        // to be inferred: a reader cannot tell a switch from a quiet tank by
        // watching ROB alone, since the compliance tank is flat on ECA-free
        // rotations.
        const activeFuel = inEca ? complianceGrade : hsfo > 0 ? "HSFO" : "VLSFO";
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
          MGO_ROB_MT: fmt(complianceGrade === "MGO" ? compliance : 0),
          MEOH_ROB_MT: fmt(complianceGrade === "MEOH" ? compliance : 0),
          LNG_ROB_MT: fmt(complianceGrade === "LNG" ? compliance : 0),
          B40_ROB_MT: fmt(complianceGrade === "B40" ? compliance : 0),
          VLSFO_Bunkered_MT: fmt(stemV),
          HSFO_Bunkered_MT: fmt(stemH),
          MGO_Bunkered_MT: fmt(complianceGrade === "MGO" ? stemC : 0),
          MEOH_Bunkered_MT: fmt(complianceGrade === "MEOH" ? stemC : 0),
          LNG_Bunkered_MT: fmt(complianceGrade === "LNG" ? stemC : 0),
          B40_Bunkered_MT: fmt(complianceGrade === "B40" ? stemC : 0),
          Source_File: SOURCE_FILE,
          Data_Notes: note,
        });

        tightestResidual = Math.min(tightestResidual, round3(vlsfo + hsfo) - min);
        tightestCompliance = Math.min(tightestCompliance, compliance - complianceMin);

        // Burn is charged after the row is written, so the emitted ROB is the
        // level at the start of the step (including anything lifted there).
        // Charged as energy, converted through whichever tank actually
        // supplies it — so the mass drawn down depends on the grade, not a
        // flat MT figure. See ENERGY_RATE_TRANSIT_GJ_PER_DWT_DAY.
        const energy = energyAt(s);
        if (inEca) {
          compliance = round3(compliance - energy / complianceGjPerMt);
        } else {
          // HSFO first — with a scrubber it is the cheaper fuel, so VLSFO is
          // held as the reserve it was lifted to be. The remainder spills to
          // VLSFO on the one step where HSFO runs out mid-burn, each portion
          // converted through its own grade's energy content.
          let leftEnergy = energy;
          if (hsfo > 0) {
            const takeEnergy = Math.min(hsfo * gjPerMt.HSFO, leftEnergy);
            hsfo = round3(hsfo - takeEnergy / gjPerMt.HSFO);
            leftEnergy -= takeEnergy;
          }
          if (leftEnergy > 0) vlsfo = round3(vlsfo - leftEnergy / gjPerMt.VLSFO);
        }
      }
    });
  }

  return { rows, stems, clipped, ecaSwitches, tightestResidual, tightestCompliance };
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
    const complianceGrade = complianceGradeFor(name);
    const complianceMax = round3(max * COMPLIANCE_RATIOS[complianceGrade].max);
    const complianceMin = round3(complianceMax * COMPLIANCE_RATIOS[complianceGrade].min);
    const services = new Set(vesselRows.map((r) => r.Service_Code));
    if (services.size !== 1) fail(`${name} appears under ${services.size} service codes`);

    // A rotation with no ECA port must leave the compliance tank untouched,
    // and one with an ECA port must not: the switch either happened or it
    // silently did not.
    const serviceCode = vesselRows[0].Service_Code;
    const touchesEca = portCallsByService
      .get(serviceCode)
      .some((r) => ECA_PORTS.has(cell(r, "Port_Code")));
    const complianceCol = `${complianceGrade}_ROB_MT`;
    const complianceMoves = vesselRows.some((r) => r[complianceCol] !== vesselRows[0][complianceCol]);
    if (touchesEca && !complianceMoves) {
      fail(`${name}: ${serviceCode} calls an ECA port but ${complianceGrade} never moves`);
    }
    if (!touchesEca && complianceMoves) {
      fail(`${name}: ${serviceCode} has no ECA port but ${complianceGrade} moves`);
    }

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
      const compliance = Number(r[complianceCol]);
      if (compliance < complianceMin - 1e-9 || compliance > complianceMax + 1e-9) {
        fail(`${where}: ${complianceGrade} ROB ${compliance} outside ${complianceMin}..${complianceMax}`);
      }
      // Every compliance grade this vessel does NOT carry stays a true zero
      // throughout — same convention as HSFO on a non-scrubber hull.
      for (const otherGrade of COMPLIANCE_GRADES) {
        if (otherGrade === complianceGrade) continue;
        if (r[`${otherGrade}_ROB_MT`] !== "0") {
          fail(`${where}: not ${otherGrade}-fuelled, but ${otherGrade} ROB is ${r[`${otherGrade}_ROB_MT`]}`);
        }
        if (r[`${otherGrade}_Bunkered_MT`] !== "0") {
          fail(`${where}: not ${otherGrade}-fuelled, but stemmed ${r[`${otherGrade}_Bunkered_MT`]} MT of ${otherGrade}`);
        }
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
      if (Number(r.MEOH_Bunkered_MT) > 0 && !MEOH_SUPPLY_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed MEOH at ${r.Port_Code}, which has no methanol market`);
      }
      if (Number(r.LNG_Bunkered_MT) > 0 && !LNG_SUPPLY_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed LNG at ${r.Port_Code}, which has no LNG market`);
      }
      if (Number(r.B40_Bunkered_MT) > 0 && !B40_SUPPLY_PORTS.has(r.Port_Code)) {
        fail(`${where}: stemmed B40 at ${r.Port_Code}, which has no B40 market`);
      }

      // The active fuel must be one the vessel is actually holding.
      if (!["VLSFO", "HSFO", ...COMPLIANCE_GRADES].includes(r.Active_Fuel)) {
        fail(`${where}: Active_Fuel is "${r.Active_Fuel}"`);
      }
      if (r.Active_Fuel === "HSFO" && !scrubber) fail(`${where}: burning HSFO with no scrubber`);
      if (COMPLIANCE_GRADES.includes(r.Active_Fuel) && r.Active_Fuel !== complianceGrade) {
        fail(`${where}: burning ${r.Active_Fuel} on a ${complianceGrade}-fuelled hull`);
      }
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
const gjPerMt = loadEnergyPerMt();

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

const { rows, stems, clipped, ecaSwitches, tightestResidual, tightestCompliance } = buildRows(
  timetables,
  specByName,
  gjPerMt,
);

checkInvariants(rows, timetables, specByName, portCallsByService);

const text =
  [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => csvCell(r[h])).join(","))].join("\n") +
  "\n";

const unchanged = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
if (!unchanged) fs.writeFileSync(OUT, text, "utf8");

const fleetSize = ROSTER.reduce((n, [, v]) => n + v.length, 0);
const totalStems = stems.VLSFO + stems.HSFO + stems.MGO + stems.MEOH + stems.LNG + stems.B40;
console.log(
  `${unchanged ? "unchanged" : "wrote"} ${path.relative(ROOT, OUT)}\n` +
    `  ${rows.length.toLocaleString()} rows, ${fleetSize} vessels x ${STEPS} steps\n` +
    `  ${timestampAt(0)} -> ${timestampAt(STEPS - 1)} ` +
    `(${STEPS / STEPS_PER_DAY} days, ${STEP_HOURS}-hour grid)\n` +
    `  ${totalStems} stems (${stems.HSFO} HSFO, ${stems.VLSFO} VLSFO, ${stems.MGO} MGO, ` +
    `${stems.MEOH} MEOH, ${stems.LNG} LNG, ${stems.B40} B40), ` +
    `${clipped} cut by tank capacity\n` +
    `  ${ecaSwitches} fuel switches, tightest margins: ` +
    `residual ${fmt(tightestResidual)} MT, compliance ${fmt(tightestCompliance)} MT`,
);
