import { num, readCsv, str } from "./csv";
import { PORT_COORDS } from "./ports";
import type { Port, PortCall, Service, TransitTime } from "./types";
import { getPriceIndex, latestPoint } from "./prices";

const SERVICE_MASTER = "schedules/PIL_Intra_Asia_Service_Master.csv";
const PORT_CALLS = "schedules/PIL_Intra_Asia_Port_Calls.csv";
const TRANSIT_TIMES = "schedules/PIL_Intra_Asia_Transit_Times.csv";

export function loadServices(): Service[] {
  const { rows } = readCsv(SERVICE_MASTER);
  return rows
    .filter((r) => str(r, "Service_Code") !== null)
    .map((r) => ({
      code: str(r, "Service_Code")!,
      name: str(r, "Service_Name") ?? "",
      frequency: str(r, "Frequency") ?? "",
      tradeRegion: str(r, "Trade_Region") ?? "",
      subRegion: str(r, "Sub_Region") ?? "",
      uniquePortCount: num(r, "Unique_Port_Count") ?? 0,
      portCallCount: num(r, "Port_Call_Count") ?? 0,
      // Source packs several bullets into one cell, separated by "; ".
      keyFeatures: (str(r, "Key_Features") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
      sourceEffectiveDate: str(r, "Source_Effective_Date") ?? "",
      dataNotes: str(r, "Data_Notes") ?? "",
    }));
}

export function loadPortCalls(): PortCall[] {
  const { rows } = readCsv(PORT_CALLS);
  return rows
    .filter((r) => str(r, "Service_Code") !== null)
    .map((r) => ({
      serviceCode: str(r, "Service_Code")!,
      sequenceNo: num(r, "Sequence_No") ?? 0,
      portName: str(r, "Port_Name") ?? "",
      portCode: str(r, "Port_Code") ?? "",
      country: str(r, "Country") ?? "",
      terminalName: str(r, "Terminal_Name") ?? "",
      arrivalWeekday: str(r, "Arrival_Weekday"),
      departureWeekday: str(r, "Departure_Weekday"),
      etaDay: num(r, "ETA_Day_Number"),
      etdDay: num(r, "ETD_Day_Number"),
      dwellDays: num(r, "Dwell_Time_Days"),
      transitToNextDays: num(r, "Transit_To_Next_Days"),
      bunkerQuantityMt: num(r, "Bunker_Quantity_MT"),
      loopClosure: (str(r, "Loop_Closure_Flag") ?? "0") === "1",
      directionPhase: str(r, "Direction_Phase") ?? "",
      scheduleDataStatus: str(r, "Schedule_Data_Status") ?? "",
      dataNotes: str(r, "Data_Notes") ?? "",
    }))
    .sort((a, b) =>
      a.serviceCode === b.serviceCode
        ? a.sequenceNo - b.sequenceNo
        : a.serviceCode.localeCompare(b.serviceCode),
    );
}

export function loadTransitTimes(): TransitTime[] {
  const { rows } = readCsv(TRANSIT_TIMES);
  return rows
    .filter((r) => str(r, "Service_Code") !== null)
    .map((r) => ({
      serviceCode: str(r, "Service_Code")!,
      direction: str(r, "Direction") ?? "",
      originPort: str(r, "Origin_Port") ?? "",
      originPortCode: str(r, "Origin_Port_Code") ?? "",
      destinationPort: str(r, "Destination_Port") ?? "",
      destinationPortCode: str(r, "Destination_Port_Code") ?? "",
      transitDays: num(r, "Published_Transit_Days"),
    }));
}

/** Ordered calls for one service, loop-closing duplicate included. */
export function serviceRotation(
  calls: PortCall[],
  serviceCode: string,
): PortCall[] {
  return calls
    .filter((c) => c.serviceCode === serviceCode)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
}

/**
 * Union of route ports and pricing ports.
 *
 * Only Singapore, Shanghai and Busan appear in both datasets — the other 23
 * route ports have no bunker quotes and the other ~24 pricing hubs are not on
 * any PIL service here. Both sets are surfaced, flagged, and never conflated.
 */
export function buildPortIndex(calls: PortCall[]): Port[] {
  const index = new Map<string, Port>();

  const ensure = (key: string): Port | null => {
    const existing = index.get(key);
    if (existing) return existing;
    const meta = PORT_COORDS[key];
    if (!meta) return null;
    const port: Port = {
      key,
      name: meta.name,
      country: meta.country,
      lon: meta.lon,
      lat: meta.lat,
      isRoutePort: false,
      isPricePort: false,
      serviceCodes: [],
      callCount: 0,
      grades: [],
      latestVlsfo: null,
    };
    index.set(key, port);
    return port;
  };

  for (const call of calls) {
    const port = ensure(call.portCode);
    if (!port) continue;
    port.isRoutePort = true;
    port.callCount += 1;
    if (!port.serviceCodes.includes(call.serviceCode)) {
      port.serviceCodes.push(call.serviceCode);
    }
    // Prefer the schedule's own spelling for ports it actually calls.
    port.name = call.portName;
    port.country = call.country;
  }

  const prices = getPriceIndex();
  for (const [key, grades] of prices) {
    if (key.startsWith("__")) continue; // Brent pseudo-port
    const port = ensure(key);
    if (!port) continue;
    port.isPricePort = true;
    port.grades = [...grades.keys()];
    const vlsfo = grades.get("VLSFO");
    port.latestVlsfo = vlsfo ? (latestPoint(vlsfo)?.value ?? null) : null;
  }

  for (const port of index.values()) port.serviceCodes.sort();

  return [...index.values()].sort((a, b) => a.name.localeCompare(b.name));
}
