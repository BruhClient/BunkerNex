/** Fuel grades, keyed exactly as the pricing CSV column suffixes name them. */
export type Grade =
  | "VLSFO"
  | "IFO380"
  | "LSMGO"
  | "MGO"
  | "MEOH"
  | "MEOH_VLSFOe"
  | "MEOH_MGOe"
  | "BRENT";

export interface PricePoint {
  /** YYYY-MM-DD */
  date: string;
  /** null where the source cell was blank — never coerced to 0. */
  value: number | null;
}

export type PortPrices = Partial<Record<Grade, PricePoint[]>>;

export interface Service {
  code: string;
  name: string;
  frequency: string;
  tradeRegion: string;
  subRegion: string;
  uniquePortCount: number;
  portCallCount: number;
  /** Source stores these as one `;`-separated cell. */
  keyFeatures: string[];
  sourceEffectiveDate: string;
  dataNotes: string;
}

export interface PortCall {
  serviceCode: string;
  sequenceNo: number;
  portName: string;
  portCode: string;
  country: string;
  terminalName: string;
  arrivalWeekday: string | null;
  departureWeekday: string | null;
  etaDay: number | null;
  etdDay: number | null;
  dwellDays: number | null;
  transitToNextDays: number | null;
  /** Final call that closes the loop back to the first port. */
  loopClosure: boolean;
  directionPhase: string;
  scheduleDataStatus: string;
  dataNotes: string;
}

export interface TransitTime {
  serviceCode: string;
  direction: string;
  originPort: string;
  originPortCode: string;
  destinationPort: string;
  destinationPortCode: string;
  transitDays: number | null;
}

export interface Port {
  /** UN/LOCODE, canonical across both datasets. */
  key: string;
  name: string;
  country: string;
  lon: number;
  lat: number;
  /** Called by at least one PIL service. */
  isRoutePort: boolean;
  /** Has at least one bunker price series. */
  isPricePort: boolean;
  serviceCodes: string[];
  callCount: number;
  grades: Grade[];
  /** Latest non-null VLSFO, for the map hover tooltip. */
  latestVlsfo: number | null;
}
