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
  /**
   * Bunker lifted at this call, in metric tonnes. Null on loop-closing rows,
   * where the source records no stem — never coerced to 0.
   */
  bunkerQuantityMt: number | null;
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

/**
 * Container size band derived from Nominal_TEU. The specifications sheet has
 * no vessel-type column at all, so this is inferred — never present it as a
 * sourced fact. A vessel with no TEU figure gets null, not a guessed band.
 */
export type VesselSizeClass =
  | "Feeder"
  | "Feedermax"
  | "Panamax"
  | "Post-Panamax"
  | "Neo-Panamax";

export interface VesselSpec {
  name: string;
  imo: string;
  flag: string;
  dwtMt: number | null;
  gt: number | null;
  nt: number | null;
  /** Null for PACANDA, whose source cell reads 0 — an impossible capacity. */
  nominalTeu: number | null;
  /** Source lists the same three grades for every vessel; see data/README.md. */
  fuelTypes: string[];
  scrubber: boolean;
  /**
   * The five figures below are not measurements. Each is a fixed percentage of
   * DWT (see data/vessels/vessel_assumptions.csv), so two vessels of equal DWT
   * carry identical values regardless of engine or hull. Keep them visually
   * separated from measured specs wherever they are shown.
   */
  maxRobMt: number | null;
  minRobMt: number | null;
  consumptionTransitMtPerDay: number | null;
  consumptionBerthMtPerDay: number | null;
  bunkeringTriggerMt: number | null;
  dataNotes: string;
}

/**
 * One vessel's movement series, stored columnar: 744 steps × 35 vessels as
 * plain rows would be pricing-sized, which does not belong in props.
 *
 * Timestamps are a perfect 3-hour grid, so only the first is carried and the
 * rest are index arithmetic. The source's synthetic lat/lon are deliberately
 * absent — they place vessels thousands of km from their own ports, and
 * positions are derived from portCodes via PORT_COORDS instead.
 */
/**
 * What a vessel burns and stems. Narrower than `Grade`, which is the set of
 * assessed price columns — the fleet only ever moves these two.
 */
export type VesselGrade = "VLSFO" | "HSFO";

export interface VesselTrack {
  name: string;
  serviceCode: string;
  /** The single grade this vessel actually burns, per its scrubber fitting. */
  grade: VesselGrade;
  /** Constant for the whole series — MGO is never burned or stemmed. */
  mgoRobMt: number | null;
  /** Source wall-clock string, no timezone. Opaque; never parsed as UTC. */
  startTimestamp: string;
  stepHours: number;
  /** Per step: the leg's destination LOCODE while in transit, else the berth. */
  portCodes: string[];
  /** Per step, one char: "T" transit, "B" berthed. */
  phases: string;
  /** Per step, remaining-on-board of `grade`. */
  robMt: number[];
  /** Sparse: step index → MT delivered. 154 entries across the fleet. */
  bunkered: Record<number, number>;
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
