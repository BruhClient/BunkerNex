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

/**
 * Supplier tier, as the source supplier list groups them. Tier 3 is scoped to
 * methanol: a certified renewable blend is not a like-for-like quote against a
 * fossil grade, so it never appears in a VLSFO or IFO380 panel.
 */
export type SupplierTier = 1 | 2 | 3 | 4;

/**
 * One supplier's quote for one grade at one port.
 *
 * `price` is not stored anywhere. It is `baseline + diff`, resolved at read
 * time from the latest non-null assessment, so an offer never carries a figure
 * older than the series it spreads against. Every field here is simulated —
 * the source supplier list has no prices, ports or grades. See data/README.md.
 */
export interface SupplierOffer {
  supplier: string;
  tier: SupplierTier;
  tierLabel: string;
  /** $/mt, baseline + diff. */
  price: number;
  /** $/mt against the port baseline. Negative means under the assessment. */
  diff: number;
  deliveryMode: string;
  minMt: number;
  maxMt: number;
  leadTimeDays: number;
  paymentTermsDays: number;
  pumpRateMtPerHour: number;
  availability: string;
}

/** One port's market in one fuel type: the baseline, and who quotes against it. */
export interface PortMarket {
  grade: Grade;
  /** Null where the grade has no assessment — offers are then empty, never 0. */
  baseline: { value: number; date: string } | null;
  /** Ascending by price; the first entry is the cheapest quote. */
  offers: SupplierOffer[];
}

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
 * assessed price columns — the fleet only ever moves these three.
 */
export type VesselGrade = "VLSFO" | "HSFO" | "MGO";

/** Iteration order for anything rendering all three tanks. */
export const VESSEL_GRADES: readonly VesselGrade[] = ["HSFO", "VLSFO", "MGO"];

/**
 * The MGO tank, as fractions of `Max_ROB_MT`.
 *
 * Duplicated from MGO_MAX_RATIO / MGO_MIN_RATIO in
 * scripts/gen-vessel-movement.mjs, which is where the figures are reasoned
 * about and where vessel_assumptions.csv points. The generator cannot import
 * from src/, and these are needed client-side to scale the fuel bar, so the two
 * have to be kept in step by hand — change one and change the other.
 *
 * MGO sits *outside* Max_ROB_MT: the source has ASTERIOS opening at 683 MT of
 * residual — exactly its Max_ROB_MT — and carrying its MGO on top.
 */
export const MGO_TANK_RATIO = 0.2;
export const MGO_TANK_MIN_RATIO = 1 / 3;

export interface VesselTrack {
  name: string;
  serviceCode: string;
  /**
   * The residual grade this vessel is built around: HSFO on a scrubber-fitted
   * hull, VLSFO otherwise. NOT the grade it is burning at any given step —
   * read `activeGrades` for that. A scrubber vessel also carries a compliant
   * VLSFO reserve, and every vessel switches to MGO through its ECA calls.
   */
  primaryGrade: VesselGrade;
  /** Whether the hull may lawfully hold HSFO at all. */
  scrubber: boolean;
  /** Source wall-clock string, no timezone. Opaque; never parsed as UTC. */
  startTimestamp: string;
  stepHours: number;
  /** Per step: the leg's destination LOCODE while in transit, else the berth. */
  portCodes: string[];
  /** Per step, one char: "T" transit, "B" berthed. */
  phases: string;
  /**
   * Per step, one char naming the grade the main engine is on: "H" HSFO,
   * "V" VLSFO, "M" MGO. Packed as a string for the same reason `phases` is —
   * 744 steps × 35 vessels of it ships as props.
   *
   * Sourced from the CSV's `Active_Fuel`, not inferred. A tank standing still
   * is indistinguishable from a tank not being burned: the ten vessels whose
   * rotations touch no ECA port hold a flat MGO figure all window.
   */
  activeGrades: string;
  /** Per step, remaining-on-board of each grade. Zero is a real zero. */
  robMt: Record<VesselGrade, number[]>;
  /** Sparse per grade: step index → MT delivered. 250 stems across the fleet. */
  bunkered: Record<VesselGrade, Record<number, number>>;
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
