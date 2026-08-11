/**
 * A chief engineer's spot bunker requirement: the shape, what can be prefilled
 * from a vessel, and what contradicts itself.
 *
 * Deliberately NOT in types.ts. Every interface there documents what a CSV
 * source contains; this is unsent user intent, and the derivation and
 * validation helpers belong beside it rather than in the source-of-truth file.
 *
 * Client-safe: nothing here touches node:fs, and nothing it imports does
 * either. Keep it that way — this module is bundled into the browser.
 *
 * NOTHING HERE IS SOURCED. Every field is typed by a person, or prefilled from
 * a simulated movement series and then edited. See data/README.md.
 */

import { hasMarketFor, isEcaPort } from "./eca";

/** How each grade's market is named in a supply warning. */
const GRADE_MARKET_LABEL: Record<SpotFuelGrade, string> = {
  HSFO: "high-sulphur",
  VLSFO: "VLSFO",
  MGO: "distillate",
};
import { portMeta } from "./ports";
import {
  MGO_TANK_RATIO,
  type VesselGrade,
  type VesselSpec,
  type VesselTrack,
} from "./types";
import { activeGradeAt, buildLegs, stepTimestamp } from "./vesselPosition";

/** Grades the desk can be asked for — the tank set the movement series models. */
export type SpotFuelGrade = "HSFO" | "VLSFO" | "MGO";

function isSpotFuelGrade(grade: VesselGrade): grade is SpotFuelGrade {
  return grade === "HSFO" || grade === "VLSFO" || grade === "MGO";
}

/** ISO 8217 editions the desk will accept. 2017 is the working standard. */
export type IsoSpecVersion = "2024" | "2017" | "2012" | "2010";

export type DeliveryLocation = "Anchorage" | "Alongside";

export type Surveyor = "VPS" | "Maritec" | "Intertek";

/** 380 CST is the default residual; 500 needs heater capacity confirmed. */
export type ResidualViscosityGrade = "380" | "500";

/** Residual grades share one tank and one capacity figure. */
export const RESIDUAL_GRADES: ReadonlySet<SpotFuelGrade> =
  new Set<SpotFuelGrade>(["HSFO", "VLSFO"]);

export function isResidual(grade: SpotFuelGrade | null): boolean {
  return grade !== null && RESIDUAL_GRADES.has(grade);
}

/** Which modelled tank a nominated grade draws on. */
export function tankFor(grade: SpotFuelGrade): VesselGrade {
  if (grade === "HSFO") return "HSFO";
  if (grade === "VLSFO") return "VLSFO";
  return "MGO";
}

export interface SpotBunkerRequest {
  // --- 1. Required fuel grade and ISO 8217 specification -------------------
  grade: SpotFuelGrade | null;
  /**
   * Attests the scrubber is *operational*. No dataset records this — the specs
   * sheet carries a fitting flag only. Meaningless unless grade is HSFO.
   */
  scrubberOperational: boolean;
  isoVersion: IsoSpecVersion | null;

  // --- 2. Confirmed quantity and ROB calculations --------------------------
  /** Metric tonnes. Null until entered; 0 is an error, not a blank. */
  nominationMt: number | null;
  /** Read-only: the movement series' ROB for the nominated tank, not CE-typed. */
  robMt: number | null;
  /** Burn to delivery. Derived from an assumed daily rate, not measured. */
  projectedConsumptionMt: number | null;
  portStayDays: number | null;

  // --- 3. Critical temperature and cold flow limits ------------------------
  /** °C. Declared for the voyage climate — ARA Nov–Jan and similar. */
  maxPourPointC: number | null;
  /**
   * mm²/s. The engine's OEM minimum, which is in no dataset, so this is the
   * CE's figure. Distillate nominations only.
   */
  minViscosityCst: number | null;
  /** Residual only. Null on a distillate nomination. */
  residualViscosityGrade: ResidualViscosityGrade | null;
  /** Heater/boiler capacity confirmed for 500 CST. Attestation only. */
  heaterConfirmedFor500Cst: boolean;

  // --- 4. Environmental and statutory limits -------------------------------
  /** % m/m. 0.50 global, 0.10 inside a port ECA. Never 0. */
  maxSulphurPct: number | null;
  /** °C. Statutory floor 60; the desk asks suppliers to declare 70 or above. */
  minFlashPointC: number | null;
  supplierFlashDeclarationRequired: boolean;

  // --- 5. Schedule, port constraints and barging ---------------------------
  /** Destination LOCODE for the stem. Read-only: the current leg's target. */
  portCode: string | null;
  /**
   * Wall-clock "YYYY-MM-DD HH:mm", the same opaque convention as
   * VesselTrack.startTimestamp. Never parsed as UTC, never given a "Z".
   */
  etaWindowStart: string | null;
  etaWindowEnd: string | null;
  etdWindowStart: string | null;
  etdWindowEnd: string | null;
  deliveryLocation: DeliveryLocation | null;
  /** Bunkering alongside during cargo operations. */
  simops: boolean;
  /** Pair two grades onto one dual-grade barge to cut barging fees. */
  bargePairing: boolean;
  bargePairingGrade: SpotFuelGrade | null;

  // --- 6. Surveyor (BQS) and quality testing -------------------------------
  /**
   * Standing policy is NO BQS on conventional fuels. Forced true and locked on
   * a biofuel lifting.
   */
  bqsRequested: boolean;
  bqsSurveyor: Surveyor | null;
  /** SRCM Head approval reference. Required for a conventional-fuel BQS. */
  srcmApprovalRef: string | null;
  /** Why the exception: persistent short-delivery disputes on this lane. */
  bqsJustification: string | null;
  biofuelLifting: boolean;
  coqRequested: boolean;
  contaminantScreening: boolean;
  fqtSamplesPrepared: boolean;

  notes: string | null;
}

/**
 * The vessel facts the form reads but never edits.
 *
 * Every figure here is derived from a SIMULATED movement series. `arrivalStep`
 * in particular is not a published ETA — see the note on daysToArrival.
 */
export interface SpotContext {
  portCode: string | null;
  portName: string | null;
  fromPortCode: string | null;
  /** First berthed step of the current leg. */
  arrivalStep: number | null;
  arrivalTimestamp: string | null;
  departureTimestamp: string | null;
  /**
   * Days from the scrubbed step to arrival.
   *
   * NOT a lead time against a published ETA — no ETA exists in this data.
   * PIL's schedule CSVs carry loop-relative day numbers, not dates, so this is
   * read off the generated movement series. Intra-Asia legs are short, so this
   * routinely sits under the ETA-minus-6-working-days window. Warn on it;
   * never gate on it, or every vessel in the fleet fails.
   */
  daysToArrival: number | null;
  portStayDays: number | null;
  robByGrade: Record<VesselGrade, number>;
  /** HSFO + VLSFO, both at stepIndex: both draw on the one Max_ROB_MT figure. */
  residualRobMt: number;
  /**
   * Headroom projected for arrivalStep, not stepIndex — a stem lands in the
   * tank on delivery at the port, after the vessel has burned down whatever
   * it holds now over the transit. Reading straight off the current step
   * understates how much room will actually be there: the movement series
   * already simulated the burn for every step between here and arrival, so
   * this reads that future ROB directly rather than re-deriving it from
   * projectedBurnToArrivalMt's flat DWT-based rate.
   */
  residualHeadroomMt: number | null;
  /**
   * Same arrival-step basis as residualHeadroomMt. MGO sits outside
   * Max_ROB_MT and has its own, smaller tank.
   */
  mgoHeadroomMt: number | null;
  projectedBurnToArrivalMt: number | null;
  activeGrade: VesselGrade;
  scrubberFitted: boolean;
  isEcaDestination: boolean;
  /**
   * Grades this berth can actually supply, so the form can gate a segment
   * rather than only warn after the fact. Per-grade since the CE sheet: a port
   * can sell HSFO and no VLSFO, or nothing at all.
   */
  markets: Record<VesselGrade, boolean>;
  /**
   * Grades this specific hull can physically lift, independent of what the
   * destination port can supply. HSFO only on a scrubber-fitted hull; VLSFO
   * always; MGO only when the vessel's ECA-compliance tank is actually MGO —
   * a METHANOL_VESSELS/LNG_VESSELS/B40_VESSELS hull (VesselTrack.complianceGrade
   * MEOH/LNG/B40) carries none of this form's three tanks at all, per
   * CLAUDE.md's "A vessel carries exactly one compliance grade" note. The
   * dropdown filters to this set so the desk cannot draft a lift the hull has
   * no tank for; validateSpotRequest's grade check is the backstop.
   */
  carriedGrades: ReadonlySet<SpotFuelGrade>;
  /**
   * Grades actually selectable right now: carriedGrades narrowed further by
   * the ECA cap. Inside a port ECA, HSFO and VLSFO are residual grades that
   * cannot meet the 0.10% limit at any sulphur number typed into the form —
   * only the hull's compliance tank (MGO, if it carries one) is a lawful
   * lift. Outside an ECA this is identical to carriedGrades.
   */
  eligibleGrades: ReadonlySet<SpotFuelGrade>;
}

const HOURS_PER_DAY = 24;
/** A delivery window needs width; the source gives an instant. Stated, not sourced. */
const WINDOW_PAD_HOURS = 12;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Shift a wall-clock "YYYY-MM-DD HH:mm" by whole hours.
 *
 * The UTC epoch is a calendar calculator only, and the result is reformatted by
 * hand — the same contract stepTimestamp keeps, so nothing shifts the value or
 * appends a "Z" the source does not support.
 */
export function shiftTimestamp(ts: string, hours: number): string {
  const [date, time = "00:00"] = ts.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, hh, mm) + hours * 3600_000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getUTCFullYear()}-${p2(at.getUTCMonth() + 1)}-${p2(at.getUTCDate())}` +
    ` ${p2(at.getUTCHours())}:${p2(at.getUTCMinutes())}`
  );
}

/**
 * Mon–Fri count between two wall-clock stamps.
 *
 * Not "working days" in any real sense: this data carries no port holiday
 * calendar and no timezone, so a public holiday counts as a working day. The UI
 * must say so wherever this figure appears.
 */
export function weekdaysBetween(from: string, to: string): number {
  const parse = (ts: string) => {
    const [y, m, d] = ts.split(" ")[0].split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const start = parse(from);
  const end = parse(to);
  if (end <= start) return 0;

  let count = 0;
  for (let t = start; t < end; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export function deriveSpotContext(
  spec: VesselSpec,
  track: VesselTrack,
  stepIndex: number,
): SpotContext {
  const legs = buildLegs(track);
  const leg = legs.find(
    (l) => stepIndex >= l.start && stepIndex < l.start + l.length,
  );

  const portCode = leg?.toKey ?? null;
  const lastStep = track.portCodes.length - 1;

  // transitSteps counts the *leading* steps of a leg, so start + transitSteps
  // is the first berthed step — arrival.
  const arrivalStep = leg
    ? Math.min(leg.start + leg.transitSteps, lastStep)
    : null;
  const departureStep = leg
    ? Math.min(leg.start + leg.length, lastStep)
    : null;

  const arrivalTimestamp =
    arrivalStep === null ? null : stepTimestamp(track, arrivalStep);
  const departureTimestamp =
    departureStep === null ? null : stepTimestamp(track, departureStep);

  const daysToArrival =
    arrivalStep === null
      ? null
      : round1(((arrivalStep - stepIndex) * track.stepHours) / HOURS_PER_DAY);

  const portStayDays = leg
    ? round1(((leg.length - leg.transitSteps) * track.stepHours) / HOURS_PER_DAY)
    : null;

  const robByGrade: Record<VesselGrade, number> = {
    HSFO: track.robMt.HSFO[stepIndex] ?? 0,
    VLSFO: track.robMt.VLSFO[stepIndex] ?? 0,
    MGO: track.robMt.MGO[stepIndex] ?? 0,
    // Not surfaced anywhere in this form (see SpotFuelGrade below) — carried
    // only so this record has a value for every VesselGrade.
    MEOH: track.robMt.MEOH[stepIndex] ?? 0,
    LNG: track.robMt.LNG[stepIndex] ?? 0,
    B40: track.robMt.B40[stepIndex] ?? 0,
  };
  const residualRobMt = robByGrade.HSFO + robByGrade.VLSFO;

  // A nomination is delivered on arrival, not now, so headroom has to be
  // measured against ROB at arrivalStep — the tank keeps burning down between
  // stepIndex and then. The movement series already simulated that burn for
  // every step in between (grade switches, ECA windows and all), so this
  // reads the future figure straight off it rather than approximating one
  // from projectedBurnToArrivalMt's flat, ungraded rate. Falls back to
  // stepIndex when no leg was found (arrivalStep null) — nothing to project.
  const arrivalRobStep = arrivalStep ?? stepIndex;
  const residualRobAtArrivalMt =
    (track.robMt.HSFO[arrivalRobStep] ?? 0) + (track.robMt.VLSFO[arrivalRobStep] ?? 0);
  const mgoRobAtArrivalMt = track.robMt.MGO[arrivalRobStep] ?? 0;

  // Max_ROB_MT is 3% of deadweight — derived, not a measured tank. Headroom off
  // it is an estimate and can only ever warn.
  const residualHeadroomMt =
    spec.maxRobMt === null
      ? null
      : Math.max(spec.maxRobMt - residualRobAtArrivalMt, 0);
  const mgoHeadroomMt =
    spec.maxRobMt === null
      ? null
      : Math.max(spec.maxRobMt * MGO_TANK_RATIO - mgoRobAtArrivalMt, 0);

  const projectedBurnToArrivalMt =
    spec.consumptionTransitMtPerDay === null || daysToArrival === null
      ? null
      : round1(spec.consumptionTransitMtPerDay * Math.max(daysToArrival, 0));

  const isEcaDestination = isEcaPort(portCode);
  const carriedGrades = new Set<SpotFuelGrade>([
    ...(track.scrubber ? (["HSFO"] as const) : []),
    "VLSFO",
    ...(track.complianceGrade === "MGO" ? (["MGO"] as const) : []),
  ]);
  // Inside an ECA, HSFO/VLSFO drop out regardless of hull capability — only
  // the compliance tank (MGO, if carried) survives the narrowing.
  const eligibleGrades = isEcaDestination
    ? new Set<SpotFuelGrade>(carriedGrades.has("MGO") ? ["MGO"] : [])
    : carriedGrades;

  return {
    portCode,
    portName: portCode ? (portMeta(portCode)?.name ?? portCode) : null,
    fromPortCode: leg?.fromKey ?? null,
    arrivalStep,
    arrivalTimestamp,
    departureTimestamp,
    daysToArrival,
    portStayDays,
    robByGrade,
    residualRobMt,
    residualHeadroomMt,
    mgoHeadroomMt,
    projectedBurnToArrivalMt,
    activeGrade: activeGradeAt(track, stepIndex),
    scrubberFitted: track.scrubber,
    isEcaDestination,
    markets: {
      HSFO: hasMarketFor("HSFO", portCode),
      VLSFO: hasMarketFor("VLSFO", portCode),
      MGO: hasMarketFor("MGO", portCode),
      // Methanol, LNG and B40 are never nominable through this desk form —
      // see SpotFuelGrade below — so these are never true regardless of port.
      MEOH: false,
      LNG: false,
      B40: false,
    },
    carriedGrades,
    eligibleGrades,
  };
}

/**
 * A draft seeded from where the vessel actually is.
 *
 * Only figures the data genuinely supports are filled.
 */
export function prefillSpotRequest(ctx: SpotContext): SpotBunkerRequest {
  // A request bound for a port ECA needs the vessel's ECA-compliance grade, not
  // whatever `ctx.activeGrade` reports it is burning right now — that figure
  // lags the real switch until ECA_LEAD_STEPS out (see CLAUDE.md's ECA_PORTS
  // section). This fleet gives scrubber-fitted hulls no exception inside an
  // ECA: every vessel is on a compliance grade before it enters one. Only
  // default to MGO if this hull actually carries that tank — a
  // METHANOL_VESSELS/LNG_VESSELS/B40_VESSELS hull has no MGO tank at all (see
  // ctx.carriedGrades) and gets no prefill while mid-ECA, same as it gets no
  // prefill outside one below: this form's ISO 8217/viscosity/pour-point
  // fields model conventional and distillate fuel, not the IGF-Code territory
  // methanol/LNG fall under or the biofuel-lifting convention B40 would need,
  // so the CE picks a grade manually.
  const grade: SpotFuelGrade | null = ctx.isEcaDestination
    ? ctx.carriedGrades.has("MGO")
      ? "MGO"
      : null
    : isSpotFuelGrade(ctx.activeGrade) && ctx.carriedGrades.has(ctx.activeGrade)
      ? ctx.activeGrade
      : null;

  return {
    grade,
    scrubberOperational: false,
    isoVersion: "2017",

    nominationMt: null,
    robMt: grade === null ? null : ctx.robByGrade[tankFor(grade)],
    projectedConsumptionMt: ctx.projectedBurnToArrivalMt,
    portStayDays: ctx.portStayDays,

    maxPourPointC: null,
    minViscosityCst: null,
    residualViscosityGrade: isResidual(grade) ? "380" : null,
    heaterConfirmedFor500Cst: false,

    // HSFO has no real-world 0.50% spec ceiling — that's VLSFO's, not HSFO's —
    // so defaulting to it produced a draft that failed the HSFO validation
    // rule below before the engineer touched a field. ISO 8217 RMG grades run
    // up to roughly 3.50%. `grade` can never be "HSFO" here when the
    // destination is inside an ECA (see above), so this is a plain grade
    // check, not a second ECA branch.
    maxSulphurPct: ctx.isEcaDestination ? 0.1 : grade === "HSFO" ? 3.5 : 0.5,
    minFlashPointC: 70,
    supplierFlashDeclarationRequired: true,

    portCode: ctx.portCode,
    etaWindowStart: ctx.arrivalTimestamp,
    etaWindowEnd: ctx.arrivalTimestamp
      ? shiftTimestamp(ctx.arrivalTimestamp, WINDOW_PAD_HOURS)
      : null,
    etdWindowStart: ctx.departureTimestamp,
    etdWindowEnd: ctx.departureTimestamp
      ? shiftTimestamp(ctx.departureTimestamp, WINDOW_PAD_HOURS)
      : null,
    deliveryLocation: null,
    simops: false,
    bargePairing: false,
    bargePairingGrade: null,

    bqsRequested: false,
    bqsSurveyor: null,
    srcmApprovalRef: null,
    bqsJustification: null,
    biofuelLifting: false,
    coqRequested: true,
    contaminantScreening: true,
    fqtSamplesPrepared: true,

    notes: null,
  };
}

export interface SpotIssue {
  field: keyof SpotBunkerRequest;
  level: "error" | "warn";
  message: string;
}

/** Ordering window the MSA mandates, in Mon–Fri days before arrival. */
const ORDER_LEAD_WORKING_DAYS = 6;

/**
 * Everything wrong with a draft, as errors and warnings.
 *
 * Pure, so the eventual supplier-matching step can reuse it verbatim to gate a
 * request rather than reimplementing the rules against the same fields.
 *
 * Nothing here blocks: there is no submit to block. Errors mark a contradiction
 * the engineer can see and fix; warnings mark a figure that is soft, derived or
 * outside a policy window.
 */
export function validateSpotRequest(
  draft: SpotBunkerRequest,
  ctx: SpotContext,
): SpotIssue[] {
  const issues: SpotIssue[] = [];
  const err = (field: keyof SpotBunkerRequest, message: string) =>
    issues.push({ field, level: "error", message });
  const warn = (field: keyof SpotBunkerRequest, message: string) =>
    issues.push({ field, level: "warn", message });

  const { grade } = draft;
  const residual = isResidual(grade);
  const distillate = grade === "MGO";

  // --- 1. Grade and ISO ----------------------------------------------------
  if (grade === null) {
    err("grade", "Nominate a grade.");
  } else if (!ctx.eligibleGrades.has(grade)) {
    // Unreachable through the UI, which disables any segment the hull does
    // not carry or the destination ECA rules out. Guards a draft mutated any
    // other way.
    err(
      "grade",
      ctx.carriedGrades.has(grade)
        ? `${ctx.portName ?? ctx.portCode} is inside an ECA — ${grade} cannot meet the 0.10% cap. Only this hull's compliance grade is a lawful lift here.`
        : grade === "HSFO"
          ? "No scrubber fitted — HSFO is not a lawful lift for this hull."
          : "This hull's ECA-compliance tank is not MGO — it has no MGO to lift.",
    );
  } else if (grade === "HSFO" && !draft.scrubberOperational) {
    err(
      "scrubberOperational",
      "Confirm the scrubber is fully operational. The specifications sheet records a fitting, not an operating state.",
    );
  }

  // Supply, for whichever grade is actually selected. Every grade has ports
  // that cannot sell it now: Chittagong and Kolkata carry no VLSFO, Haiphong
  // and Gangavaram no distillate, and Qinzhou and Yangon nothing at all.
  if (grade !== null && !ctx.markets[tankFor(grade)]) {
    warn(
      "grade",
      `No ${GRADE_MARKET_LABEL[grade]} bunker market at ${ctx.portName ?? ctx.portCode ?? "this port"}.`,
    );
  }

  if (draft.isoVersion === null) {
    err("isoVersion", "State the ISO 8217 edition the fuel must meet.");
  } else if (draft.isoVersion === "2010") {
    warn(
      "isoVersion",
      "The weakest of the four editions; 2017 or 2024 is the norm.",
    );
  }

  // --- 2. Quantity ---------------------------------------------------------
  if (draft.nominationMt === null) {
    err("nominationMt", "Nomination required.");
  } else if (draft.nominationMt <= 0) {
    err("nominationMt", "A 0 MT stem is not a nomination.");
  } else {
    const headroom = residual ? ctx.residualHeadroomMt : ctx.mgoHeadroomMt;
    if (headroom !== null && draft.nominationMt > headroom) {
      warn(
        "nominationMt",
        `${Math.round(draft.nominationMt)} MT exceeds the ${Math.round(headroom)} MT headroom projected on arrival. Capacity is a percentage of deadweight — a derived figure, not a measured tank.`,
      );
    }
  }

  // --- 3. Cold flow --------------------------------------------------------
  if (draft.maxPourPointC === null) {
    warn("maxPourPointC", "No pour point limit declared for the voyage climate.");
  }

  if (distillate) {
    if (draft.minViscosityCst === null) {
      warn("minViscosityCst", "State the engine's OEM minimum viscosity.");
    } else if (draft.minViscosityCst < 2 || draft.minViscosityCst > 5) {
      warn("minViscosityCst", "Outside the 2–5 mm²/s distillate band.");
    }
  }

  if (
    residual &&
    draft.residualViscosityGrade === "500" &&
    !draft.heaterConfirmedFor500Cst
  ) {
    err(
      "heaterConfirmedFor500Cst",
      "Confirm onboard heater and boiler capacity for 500 CST, or specify 380 CST.",
    );
  }

  // --- 4. Statutory --------------------------------------------------------
  const sulphur = draft.maxSulphurPct;
  if (sulphur === null) {
    err("maxSulphurPct", "State the maximum allowable sulphur content.");
  } else if (sulphur <= 0) {
    err("maxSulphurPct", "A 0.00% cap is not a specification.");
  } else if (sulphur > 5) {
    err("maxSulphurPct", "Above any marine fuel specification.");
  } else {
    if (ctx.isEcaDestination && sulphur > 0.1) {
      err(
        "maxSulphurPct",
        `${ctx.portName ?? ctx.portCode} caps sulphur at 0.10%.`,
      );
    }
    if (grade === "HSFO" && sulphur <= 0.5 && !draft.scrubberOperational) {
      err(
        "maxSulphurPct",
        "HSFO cannot meet a 0.50% cap without an operational scrubber — an exhaust gas cleaning system is IMO's recognised equivalent compliance method for the global sulphur cap.",
      );
    }
    if (grade === "VLSFO" && sulphur > 0.5) {
      warn("maxSulphurPct", "VLSFO is a 0.50% grade.");
    }
  }

  if (draft.minFlashPointC === null) {
    err("minFlashPointC", "State the minimum flash point.");
  } else if (draft.minFlashPointC < 60) {
    err("minFlashPointC", "Below the statutory minimum of 60 °C.");
  } else if (draft.minFlashPointC < 70) {
    warn(
      "minFlashPointC",
      "Below the 70 °C the desk asks suppliers to declare.",
    );
  }

  // --- 5. Schedule and barging ---------------------------------------------
  if (draft.etaWindowStart === null) {
    err("etaWindowStart", "State the ETA window.");
  } else if (
    draft.etaWindowEnd !== null &&
    draft.etaWindowEnd < draft.etaWindowStart
  ) {
    // Fixed-width "YYYY-MM-DD HH:mm" sorts lexically, so no Date round-trip.
    err("etaWindowEnd", "Window ends before it opens.");
  }

  if (ctx.arrivalTimestamp !== null && draft.etaWindowStart !== null) {
    const lead = weekdaysBetween(draft.etaWindowStart, ctx.arrivalTimestamp);
    // Legs in this fleet are days, not weeks, so this fires often. It is a
    // property of the simulated window, not of the engineer's input — warn only.
    if (lead < ORDER_LEAD_WORKING_DAYS) {
      warn(
        "etaWindowStart",
        `${lead} working days to arrival; the ETA-minus-6-working-days ordering window has passed. Mon–Fri count only — no port holiday calendar exists in this data.`,
      );
    }
  }

  if (draft.bargePairing) {
    if (draft.bargePairingGrade === null) {
      err("bargePairingGrade", "Name the second grade on the barge.");
    } else if (draft.bargePairingGrade === grade) {
      err("bargePairingGrade", "A dual-grade barge needs two different grades.");
    } else if (!ctx.eligibleGrades.has(draft.bargePairingGrade)) {
      // Same backstop as the primary grade check above — unreachable through
      // the UI once its options are filtered to ctx.eligibleGrades too.
      err(
        "bargePairingGrade",
        ctx.carriedGrades.has(draft.bargePairingGrade)
          ? `${ctx.portName ?? ctx.portCode} is inside an ECA — that grade cannot meet the 0.10% cap.`
          : "This hull does not carry that grade.",
      );
    }
  }

  // --- 6. Surveyor and testing ---------------------------------------------
  if (draft.biofuelLifting) {
    if (!draft.bqsRequested) {
      err("bqsRequested", "BQS is mandatory on a biofuel lifting.");
    }
    if (draft.bqsSurveyor !== null && draft.bqsSurveyor !== "Maritec") {
      warn("bqsSurveyor", "The desk coordinates Maritec on biofuel liftings.");
    }
  }

  if (draft.bqsRequested) {
    if (draft.bqsSurveyor === null) {
      err("bqsSurveyor", "Appoint a surveyor.");
    }
    if (!draft.biofuelLifting) {
      if (draft.srcmApprovalRef === null) {
        err(
          "srcmApprovalRef",
          "SRCM Head approval reference required — BQS is an exception to the standing no-BQS policy.",
        );
      }
      if (draft.bqsJustification === null) {
        err(
          "bqsJustification",
          "Justify the exception: persistent short-delivery disputes on this lane or with this supplier.",
        );
      }
    }
  }

  if (!draft.coqRequested) {
    warn(
      "coqRequested",
      "Without a COQ, density, viscosity and contaminant screening go unverified before the stem.",
    );
  }
  if (!draft.fqtSamplesPrepared) {
    warn(
      "fqtSamplesPrepared",
      "No bottles prepared for independent FQT samples on delivery.",
    );
  }

  return issues;
}

/** First error for a field, for rendering under the control. */
export function errorFor(
  issues: SpotIssue[],
  field: keyof SpotBunkerRequest,
): string | null {
  return (
    issues.find((i) => i.field === field && i.level === "error")?.message ?? null
  );
}
