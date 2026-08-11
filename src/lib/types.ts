/**
 * Fuel grades, keyed exactly as the pricing CSV column suffixes name them.
 *
 * The set is the Chief Engineer's `TYPES OF FUEL.xlsx` availability sheet, which
 * names nine distinct products across the fleet's twenty-six ports. LSMGO and
 * MGO are separate here because they are separate on that sheet, and the split
 * falls on the ECA line — see PRICE_SERIES in bunkerEvents.ts.
 *
 * MDO, LNG, B24 and B40 are priced but never burned: `VesselGrade` is the
 * narrower set the fleet actually moves.
 */
export type Grade =
  | "VLSFO"
  | "HSFO"
  | "LSMGO"
  | "MGO"
  | "MDO"
  | "LNG"
  | "B24"
  | "B40"
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
 * fossil grade, so it never appears in a VLSFO or HSFO panel.
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
 * assessed price columns — the fleet only ever moves these six.
 *
 * MEOH, LNG and B40 are ECA-compliance tanks on small vessel subsets (see
 * METHANOL_VESSELS/LNG_VESSELS/B40_VESSELS in scripts/gen-vessel-movement.mjs)
 * — MGO's role on every other vessel. A vessel carries exactly one of the
 * four compliance grades, never more than one; VesselTrack.complianceGrade
 * says which. B24 is deliberately absent: it's a VLSFO-blend, not an
 * ECA-compliant grade, so this fleet never burns it (see data/README.md).
 */
export type VesselGrade = "VLSFO" | "HSFO" | "MGO" | "MEOH" | "LNG" | "B40";

/** Iteration order for anything rendering all six tanks. */
export const VESSEL_GRADES: readonly VesselGrade[] = [
  "HSFO",
  "VLSFO",
  "MGO",
  "MEOH",
  "LNG",
  "B40",
];

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
 *
 * Raised from 0.2 to 0.4 when ECA/DECA coverage extended to the North Sea/
 * Channel and Mediterranean SOx zones (src/lib/eca.ts) — the fleet-wide MGO
 * tank needed to hold enough for those legs' merged windows too. Held at 0.4
 * through the later move to position-based ECA detection — that change's
 * real fix was the MGO stem lift, not this ratio; see the generator.
 */
export const MGO_TANK_RATIO = 0.4;
export const MGO_TANK_MIN_RATIO = 1 / 3;

/**
 * The methanol tank, as fractions of `Max_ROB_MT` — same role as
 * MGO_TANK_RATIO, for the vessels that carry MEOH instead of MGO.
 * Duplicated from MEOH_MAX_RATIO / MEOH_MIN_RATIO in
 * scripts/gen-vessel-movement.mjs, same hand-sync contract as MGO_TANK_RATIO.
 *
 * Methanol carries less than half MGO's energy per tonne (19.9 vs 42.7
 * GJ/mt, data/emissions/energy_per_mt.csv), so for the same days of
 * ECA-window autonomy the base ratio is MGO_TANK_RATIO x (42.7 / 19.9) —
 * real methanol hulls carry much larger tanks for the same range, not an
 * artefact of this model. Carries a further x2.3 on top of that base figure:
 * MEOH_VESSELS/LNG_VESSELS were widened onto Asia-Europe services whose
 * methanol/LNG supply calls sit entirely in Asia, so the tank must survive
 * the whole Europe-side ECA stretch (North Sea/Channel, sometimes
 * Mediterranean) on one fill, unlike MGO which can still buy fuel almost
 * anywhere along the way — checkInvariants forced this multiplier up
 * empirically, the same way MGO_TANK_RATIO itself went 0.2->0.4 for the
 * same class of window.
 */
export const MEOH_TANK_RATIO = MGO_TANK_RATIO * (42.7 / 19.9) * 2.3;
export const MEOH_TANK_MIN_RATIO = 1 / 3;

/**
 * The LNG tank, as fractions of `Max_ROB_MT` — same role as MGO_TANK_RATIO,
 * for the vessels that carry LNG instead of MGO. Duplicated from
 * LNG_MAX_RATIO / LNG_MIN_RATIO in scripts/gen-vessel-movement.mjs, same
 * hand-sync contract as MGO_TANK_RATIO.
 *
 * LNG carries more energy per tonne than MGO (48.0 vs 42.7 GJ/mt,
 * data/emissions/energy_per_mt.csv), so for the same days of ECA-window
 * autonomy the base ratio is MGO_TANK_RATIO x (42.7 / 48.0) — smaller than
 * MGO's, the opposite direction from MEOH. Real cryogenic LNG tanks are
 * physically bulkier than this mass-only ratio implies (Type-C tank
 * insulation and pressure-vessel overhead); this model tracks autonomy-days,
 * not volume, the same simplification MEOH's larger ratio already makes in
 * reverse. Carries the same x2.3 buffer as MEOH_TANK_RATIO, for the same
 * Asia-only-supply-vs-Europe-ECA-window reason — see that comment.
 */
export const LNG_TANK_RATIO = MGO_TANK_RATIO * (42.7 / 48.0) * 2.3;
export const LNG_TANK_MIN_RATIO = 1 / 3;

/**
 * The B40 biofuel tank, as fractions of `Max_ROB_MT` — same role as
 * MGO_TANK_RATIO, for the two vessels that carry B40 instead of MGO.
 * Duplicated from B40_MAX_RATIO / B40_MIN_RATIO in
 * scripts/gen-vessel-movement.mjs, same hand-sync contract as MGO_TANK_RATIO.
 *
 * B40 (60% MGO / 40% FAME) carries marginally less energy per tonne than
 * pure MGO (40.6 vs 42.7 GJ/mt, data/emissions/energy_per_mt.csv), so the
 * ratio is MGO_TANK_RATIO x (42.7 / 40.6) — a little larger than MGO's.
 */
export const B40_TANK_RATIO = MGO_TANK_RATIO * (42.7 / 40.6);
export const B40_TANK_MIN_RATIO = 1 / 3;

/**
 * Every compliance grade's tank ratio, keyed for lookup instead of a
 * per-component ternary chain. VLSFO/HSFO are never a compliance grade —
 * present only so the Record is total over VesselGrade — and read 0.
 */
export const COMPLIANCE_TANK_RATIO: Record<VesselGrade, number> = {
  MGO: MGO_TANK_RATIO,
  MEOH: MEOH_TANK_RATIO,
  LNG: LNG_TANK_RATIO,
  B40: B40_TANK_RATIO,
  VLSFO: 0,
  HSFO: 0,
};
export const COMPLIANCE_TANK_MIN_RATIO: Record<VesselGrade, number> = {
  MGO: MGO_TANK_MIN_RATIO,
  MEOH: MEOH_TANK_MIN_RATIO,
  LNG: LNG_TANK_MIN_RATIO,
  B40: B40_TANK_MIN_RATIO,
  VLSFO: 0,
  HSFO: 0,
};

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
  /**
   * Which grade this hull's ECA-compliance tank actually is: MGO for the
   * fleet at large, or MEOH/LNG/B40 for the small subsets in
   * METHANOL_VESSELS/LNG_VESSELS/B40_VESSELS (scripts/gen-vessel-movement.mjs).
   * Derived from the movement CSV itself (whichever of MEOH_ROB_MT/
   * LNG_ROB_MT/B40_ROB_MT opens > 0, defaulting to "MGO") rather than the
   * specifications sheet, which carries no column for any of this — none of
   * it is sourced, it's this dataset's own invented subset.
   */
  complianceGrade: VesselGrade;
  /** Source wall-clock string, no timezone. Opaque; never parsed as UTC. */
  startTimestamp: string;
  stepHours: number;
  /** Per step: the leg's destination LOCODE while in transit, else the berth. */
  portCodes: string[];
  /** Per step, one char: "T" transit, "B" berthed. */
  phases: string;
  /**
   * Per step, one char naming the grade the main engine is on: "H" HSFO,
   * "V" VLSFO, "M" MGO, "E" MEOH, "N" LNG, "B" B40. Packed as a string for
   * the same reason `phases` is — 744 steps × 62 vessels of it ships as props.
   *
   * Sourced from the CSV's `Active_Fuel`, not inferred. A tank standing still
   * is indistinguishable from a tank not being burned: the vessels whose
   * rotations touch no ECA port hold a flat compliance-grade figure all
   * window.
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
