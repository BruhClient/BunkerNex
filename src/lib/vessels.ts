import { num, readCsv, str } from "./csv";
import { PORT_COORDS } from "./ports";
import type { VesselSizeClass, VesselSpec, VesselTrack } from "./types";

const VESSEL_SPECS = "vessels/PIL_Fleet_Vessel_Specifications.csv";
const VESSEL_MOVEMENT = "vessels/PIL_Fleet_Live_Movement.csv";

/** The movement series is a uniform grid; see data/README.md. */
const STEP_HOURS = 3;

export function loadVesselSpecs(): VesselSpec[] {
  const { rows } = readCsv(VESSEL_SPECS);
  return rows
    .filter((r) => str(r, "Vessel_Name") !== null)
    .map((r) => ({
      name: str(r, "Vessel_Name")!,
      imo: str(r, "IMO_Number") ?? "",
      flag: str(r, "Flag") ?? "",
      dwtMt: num(r, "DWT_MT"),
      gt: num(r, "GT"),
      nt: num(r, "NT"),
      // Blank for PACANDA — the source's 0 is a missing value, not a capacity.
      nominalTeu: num(r, "Nominal_TEU"),
      // Source packs the grades into one cell separated by ";".
      fuelTypes: (str(r, "Main_Engine_Fuel_Types") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
      scrubber: str(r, "Scrubber_Fitted") === "Yes",
      maxRobMt: num(r, "Max_ROB_MT"),
      minRobMt: num(r, "Min_ROB_MT"),
      consumptionTransitMtPerDay: num(r, "Consumption_Transit_MT_Per_Day"),
      consumptionBerthMtPerDay: num(r, "Consumption_Berth_MT_Per_Day"),
      bunkeringTriggerMt: num(r, "Bunkering_Trigger_MT"),
      dataNotes: str(r, "Data_Notes") ?? "",
    }));
}

/**
 * Reshape the 16,800-row movement CSV into one columnar track per vessel.
 *
 * Two things are dropped on purpose. The synthetic coordinates are never read
 * — they are blank in every row, and were fictional before that, so positions
 * are derived from portCodes via PORT_COORDS downstream. And the per-row
 * timestamps collapse to a start plus a fixed step, since the grid is exactly
 * 3-hourly with no gaps.
 *
 * A movement row for an unknown vessel, or a port missing from PORT_COORDS,
 * throws rather than quietly disappearing from the map.
 */
export function loadVesselTracks(specs: VesselSpec[]): VesselTrack[] {
  const { rows } = readCsv(VESSEL_MOVEMENT);
  const specByName = new Map(specs.map((s) => [s.name, s]));

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const name = str(row, "Vessel_Name");
    if (name === null) continue;
    const bucket = grouped.get(name);
    if (bucket) bucket.push(row);
    else grouped.set(name, [row]);
  }

  const tracks: VesselTrack[] = [];

  for (const [name, group] of grouped) {
    const spec = specByName.get(name);
    if (!spec) {
      throw new Error(
        `${VESSEL_MOVEMENT}: vessel "${name}" has no row in ${VESSEL_SPECS}`,
      );
    }

    // Source order is already time-ascending per vessel, but the timestamps
    // are zero-padded so they sort lexically — sorting makes the series
    // independent of row order without parsing a date.
    const ordered = [...group].sort((a, b) =>
      (str(a, "Timestamp") ?? "").localeCompare(str(b, "Timestamp") ?? ""),
    );

    // Scrubber-fitted vessels burn HSFO, the rest VLSFO — the movement data
    // applies this MARPOL Annex VI rule even though the specs sheet lists all
    // three grades for every vessel. Derive from the fitting rather than from
    // whichever ROB column happens to be non-zero.
    const grade = spec.scrubber ? "HSFO" : "VLSFO";
    const robColumn = `${grade}_ROB_MT`;
    const bunkerColumn = `${grade}_Bunkered_MT`;

    const portCodes: string[] = [];
    const robMt: number[] = [];
    const bunkered: Record<number, number> = {};
    let phases = "";

    ordered.forEach((row, i) => {
      const code = str(row, "Port_Code");
      if (code === null || !PORT_COORDS[code]) {
        throw new Error(
          `${VESSEL_MOVEMENT}: port code "${code}" for ${name} is missing from PORT_COORDS`,
        );
      }
      portCodes.push(code);
      phases += str(row, "Operational_Phase") === "Berthed" ? "B" : "T";
      robMt.push(num(row, robColumn) ?? 0);

      const lifted = num(row, bunkerColumn);
      if (lifted !== null && lifted > 0) bunkered[i] = lifted;
    });

    tracks.push({
      name,
      serviceCode: str(ordered[0], "Service_Code") ?? "",
      grade,
      // Constant across the series: MGO is never burned or stemmed.
      mgoRobMt: num(ordered[0], "MGO_ROB_MT"),
      startTimestamp: str(ordered[0], "Timestamp") ?? "",
      stepHours: STEP_HOURS,
      portCodes,
      phases,
      robMt,
      bunkered,
    });
  }

  return tracks.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Container size band from nominal TEU.
 *
 * The specifications sheet carries no vessel-type column, so this is inferred
 * from capacity alone using the conventional container bands. Label it as
 * derived wherever it is shown. A vessel with no TEU figure gets null — a
 * guessed band would be worse than none.
 */
export function sizeClassFor(nominalTeu: number | null): VesselSizeClass | null {
  if (nominalTeu === null || nominalTeu <= 0) return null;
  if (nominalTeu < 1000) return "Feeder";
  if (nominalTeu < 3000) return "Feedermax";
  if (nominalTeu < 5100) return "Panamax";
  if (nominalTeu <= 10000) return "Post-Panamax";
  return "Neo-Panamax";
}
