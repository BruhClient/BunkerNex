"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CheckRow,
  DateTimeInput,
  Field,
  FieldRow,
  NumberInput,
  SelectInput,
  Segmented,
  TextArea,
  TextInput,
  WarnCallout,
  useFieldId,
  type Option,
} from "./FormControls";
import { formatDateShort, formatMt } from "@/lib/format";
import {
  deriveSpotContext,
  errorFor,
  isResidual,
  prefillSpotRequest,
  tankFor,
  validateSpotRequest,
  type DeliveryLocation,
  type IsoSpecVersion,
  type ResidualViscosityGrade,
  type SpotBunkerRequest,
  type SpotContext,
  type SpotFuelGrade,
  type SpotIssue,
  type Surveyor,
} from "@/lib/spotBunker";
import { generateSpotBunkerPdf } from "@/lib/spotBunkerPdf";
import type { VesselSpec, VesselTrack } from "@/lib/types";

/**
 * The chief engineer's spot bunker requirement, as a form.
 *
 * Occupies the same slot as VesselPanel rather than opening a dialog: the
 * codebase has no modal primitive, and the requirement is a sub-view of the
 * vessel, not a separate destination. Esc goes back to the vessel rather than
 * closing outright — a stray keystroke should not destroy typed input.
 *
 * Mounting this puts Explorer into focus mode: the map holds on the vessel, the
 * services sidebar unmounts, and the timeline freezes. `onBack` is the exit, and
 * is reached three ways — Esc, the header's back arrow, and the map chip.
 * Freezing matters to this component specifically: `ctx` below is derived from
 * `stepIndex`, so a seek would re-base the arrival port, ROB and ECA status
 * under a draft that does not move with them.
 *
 * Seven sections, ~30 controls: fully expanded this is three screens of scroll,
 * so all but grade and quantity open collapsed, each showing its current values
 * on the header. The submit sits outside the scroll area because with sections
 * shut the error count is the only signal the form is incomplete.
 *
 * There is no <form> element — Enter does nothing, only the button submits.
 * `onSubmit` hands the validated draft and its derived `ctx` to Explorer,
 * which navigates to /route-plan preselected to this vessel, position and
 * nomination — the route-wide bunkering optimizer, not a single-port
 * supplier match.
 */

interface Props {
  spec: VesselSpec | null;
  track: VesselTrack | null;
  stepIndex: number;
  /** Held by Explorer so going back and returning keeps typed input. */
  draft: SpotBunkerRequest | null;
  onChange: (next: SpotBunkerRequest) => void;
  onSubmit: (value: SpotBunkerRequest, ctx: SpotContext) => void;
  onBack: () => void;
  onClose: () => void;
}

const ISO_OPTIONS: ReadonlyArray<Option<IsoSpecVersion>> = [
  { value: "2024", label: "ISO 8217:2024" },
  { value: "2017", label: "ISO 8217:2017 — standard" },
  { value: "2012", label: "ISO 8217:2012" },
  { value: "2010", label: "ISO 8217:2010" },
];

const DELIVERY_OPTIONS: ReadonlyArray<Option<DeliveryLocation>> = [
  { value: "Anchorage", label: "Anchorage" },
  { value: "Alongside", label: "Alongside" },
];

const CST_OPTIONS: ReadonlyArray<Option<ResidualViscosityGrade>> = [
  { value: "380", label: "380 CST" },
  { value: "500", label: "500 CST" },
];

const SURVEYOR_OPTIONS: ReadonlyArray<Option<Surveyor>> = [
  { value: "VPS", label: "VPS" },
  { value: "Maritec", label: "Maritec" },
  { value: "Intertek", label: "Intertek" },
];

/**
 * Panel width in px. Matches ServicePanel, VesselPanel and PortPanel — this is
 * a constant rather than the `max-w-[420px]` class they use only because
 * Explorer biases the map camera around it, and a vessel centred in the map
 * pane would sit underneath this.
 */
export const SPOT_PANEL_WIDTH = 420;

/**
 * Below this width the panel overlays the map instead of sitting beside it, so
 * the camera bias applies. Must stay in step with the `xl:static` in the
 * panel's own className below — this is Tailwind's `xl` breakpoint.
 */
export const SPOT_PANEL_INLINE_MIN = 1280;

// --- Sections -------------------------------------------------------------

type SectionId =
  | "grade"
  | "quantity"
  | "coldflow"
  | "statutory"
  | "schedule"
  | "survey"
  | "notes";

const SECTION_TITLE: Record<SectionId, string> = {
  grade: "Fuel grade & specification",
  quantity: "Quantity & ROB",
  coldflow: "Temperature & cold flow",
  statutory: "Environmental & statutory",
  schedule: "Schedule, port & barging",
  survey: "Surveyor & quality testing",
  notes: "Notes",
};

/** Top to bottom, which is also the order the error jump searches. */
const SECTION_ORDER: ReadonlyArray<SectionId> = [
  "grade",
  "quantity",
  "coldflow",
  "statutory",
  "schedule",
  "survey",
  "notes",
];

/** Open on first paint: the two the engineer is actually here to decide. */
const DEFAULT_OPEN: ReadonlyArray<SectionId> = ["grade", "quantity"];

/**
 * Which section owns each field of the request.
 *
 * A Record over `keyof SpotBunkerRequest` rather than a list per section, so
 * adding a field to the request fails the type check until a section claims
 * it. Both the warning callouts and the collapsed headers' counts are derived
 * from here, and a warning raised against an unclaimed field would otherwise
 * render nowhere at all — which is exactly what the hand-written per-section
 * field lists this replaces made possible.
 */
const FIELD_SECTION: Record<keyof SpotBunkerRequest, SectionId> = {
  grade: "grade",
  scrubberOperational: "grade",
  isoVersion: "grade",

  nominationMt: "quantity",
  robMt: "quantity",
  projectedConsumptionMt: "quantity",
  portStayDays: "quantity",

  maxPourPointC: "coldflow",
  minViscosityCst: "coldflow",
  residualViscosityGrade: "coldflow",
  heaterConfirmedFor500Cst: "coldflow",

  maxSulphurPct: "statutory",
  minFlashPointC: "statutory",
  supplierFlashDeclarationRequired: "statutory",

  // Read-only on the request: the destination is now shown in the panel
  // header, but the field still belongs to the section it was carved from.
  portCode: "schedule",
  etaWindowStart: "schedule",
  etaWindowEnd: "schedule",
  etdWindowStart: "schedule",
  etdWindowEnd: "schedule",
  deliveryLocation: "schedule",
  simops: "schedule",
  bargePairing: "schedule",
  bargePairingGrade: "schedule",

  biofuelLifting: "survey",
  bqsRequested: "survey",
  bqsSurveyor: "survey",
  srcmApprovalRef: "survey",
  bqsJustification: "survey",
  coqRequested: "survey",
  contaminantScreening: "survey",
  fqtSamplesPrepared: "survey",

  notes: "notes",
};

/**
 * "2026-06-02 06:00" → "02 Jun 06:00".
 *
 * formatDateShort parses `<date>T00:00:00Z` and formats in UTC, so it takes the
 * date half alone — handed the whole stamp it would fail to parse. The clock
 * half is sliced, never parsed: these timestamps carry no timezone and a Date
 * round-trip would invent one.
 */
function shortStamp(ts: string): string {
  return `${formatDateShort(ts.slice(0, 10))} ${ts.slice(11, 16)}`;
}

/**
 * The one line a collapsed section shows in place of its fields.
 *
 * Values only, never a caveat. The section's warnings are already counted in
 * its header chip, and compressing a provenance note to four words would
 * misstate it.
 */
function summaryFor(id: SectionId, value: SpotBunkerRequest): string {
  const join = (parts: Array<string | null>) =>
    parts.filter((p): p is string => p !== null).join(" · ") || "—";

  switch (id) {
    case "grade":
      return join([
        value.grade ?? "no grade",
        value.isoVersion ? `ISO 8217:${value.isoVersion}` : null,
      ]);
    case "quantity":
      return join([
        value.nominationMt === null
          ? "no nomination"
          : `${formatMt(value.nominationMt)} MT`,
        `ROB ${formatMt(value.robMt)} MT`,
      ]);
    case "coldflow":
      return join([
        value.maxPourPointC === null ? null : `pour ≤ ${value.maxPourPointC} °C`,
        isResidual(value.grade)
          ? value.residualViscosityGrade
            ? `${value.residualViscosityGrade} CST`
            : null
          : value.minViscosityCst === null
            ? null
            : `visc ≥ ${value.minViscosityCst} mm²/s`,
      ]);
    case "statutory":
      return join([
        value.maxSulphurPct === null
          ? null
          : `S ≤ ${value.maxSulphurPct.toFixed(2)}%`,
        value.minFlashPointC === null
          ? null
          : `flash ≥ ${value.minFlashPointC} °C`,
      ]);
    case "schedule":
      return join([
        value.deliveryLocation,
        value.etaWindowStart ? shortStamp(value.etaWindowStart) : null,
        value.bargePairing ? "paired barge" : null,
      ]);
    case "survey":
      return join([
        value.biofuelLifting ? "biofuel" : null,
        value.bqsRequested ? `BQS ${value.bqsSurveyor ?? "—"}` : "no BQS",
        value.coqRequested ? "COQ" : null,
        value.fqtSamplesPrepared ? "FQT" : null,
      ]);
    case "notes":
      return value.notes ?? "—";
  }
}

/** A collapsed section's error or warning tally. */
function CountChip({
  count,
  noun,
  tone,
}: {
  count: number;
  noun: string;
  tone: "down" | "warn";
}) {
  return (
    <span
      // A bare numeral is not a label.
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"}`}
      className={`tnum rounded px-1 py-px text-[9px] font-semibold ${
        tone === "down" ? "bg-down/15 text-down" : "bg-warn/15 text-warn"
      }`}
    >
      {count}
    </span>
  );
}

/**
 * One disclosure section.
 *
 * The body is unmounted when shut, not hidden: a display:none field would keep
 * its inputs in the tab order, so tabbing through a closed form would land on
 * controls nobody can see.
 */
function Section({
  id,
  open,
  summary,
  errorCount,
  warnCount,
  onToggle,
  registerRef,
  children,
}: {
  id: SectionId;
  open: boolean;
  summary: string;
  errorCount: number;
  warnCount: number;
  onToggle: (id: SectionId) => void;
  registerRef: (id: SectionId, el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const bodyId = `spot-section-${id}`;

  return (
    <section
      ref={(el) => {
        registerRef(id, el);
      }}
      className="border-t border-line first:border-t-0"
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <svg
          width="7"
          height="10"
          viewBox="0 0 7 10"
          aria-hidden
          className={`shrink-0 text-faint transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          <path
            d="M1.5 1L5.5 5l-4 4"
            stroke="currentColor"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="label shrink-0">{SECTION_TITLE[id]}</span>
        <span className="ml-auto flex min-w-0 items-center gap-1.5">
          {!open && (
            <span className="tnum truncate text-[10px] text-faint">
              {summary}
            </span>
          )}
          {errorCount > 0 && (
            <CountChip count={errorCount} noun="error" tone="down" />
          )}
          {warnCount > 0 && (
            <CountChip count={warnCount} noun="warning" tone="warn" />
          )}
        </span>
      </button>
      {open && (
        <div id={bodyId} className="pb-2">
          {children}
        </div>
      )}
    </section>
  );
}

export default function SpotBunkerPanel({
  spec,
  track,
  stepIndex,
  draft,
  onChange,
  onSubmit,
  onBack,
  onClose,
}: Props) {
  // Esc returns to the vessel rather than closing. VesselPanel installs its own
  // listener, and Explorer mounts exactly one of the two, so a second Esc
  // closes the panel without the two handlers ever racing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const ctx = useMemo(
    () => (spec && track ? deriveSpotContext(spec, track, stepIndex) : null),
    [spec, track, stepIndex],
  );

  // Seed on first open. Rendering falls back to the same prefill so the very
  // first paint is never an empty form.
  useEffect(() => {
    if (ctx && draft === null) onChange(prefillSpotRequest(ctx));
  }, [ctx, draft, onChange]);

  const value = useMemo(
    () => draft ?? (ctx ? prefillSpotRequest(ctx) : null),
    [draft, ctx],
  );

  const issues = useMemo(
    () => (value && ctx ? validateSpotRequest(value, ctx) : []),
    [value, ctx],
  );

  const bySection = useMemo(() => {
    const map = new Map<SectionId, SpotIssue[]>();
    for (const issue of issues) {
      const id = FIELD_SECTION[issue.field];
      const list = map.get(id);
      if (list) list.push(issue);
      else map.set(id, [issue]);
    }
    return map;
  }, [issues]);

  // View state, not the requirement: this resets when the panel unmounts on a
  // step back to the vessel. `spotDraft` in Explorer protects what matters.
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionId>>(
    () => new Set(DEFAULT_OPEN),
  );

  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // A wrong default should never rely on the engineer finding a shut section to
  // discover why the submit button won't enable. Any section that already
  // carries an error on the very first paint — the field's default was wrong,
  // not something the engineer typed — opens automatically. Mount-only: once
  // open, a section stays exactly where the engineer leaves it, even if a
  // later edit clears or introduces an error, so it does not fight a manual
  // toggle.
  useEffect(() => {
    setOpenSections((prev) => {
      const withErrors = SECTION_ORDER.filter((id) =>
        (bySection.get(id) ?? []).some((i) => i.level === "error"),
      );
      if (withErrors.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...withErrors]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectionEls = useRef(new Map<SectionId, HTMLElement>());
  const registerSection = useCallback(
    (id: SectionId, el: HTMLElement | null) => {
      if (el) sectionEls.current.set(id, el);
      else sectionEls.current.delete(id);
    },
    [],
  );

  const ids = {
    iso: useFieldId("iso"),
    nomination: useFieldId("nom"),
    rob: useFieldId("rob"),
    burn: useFieldId("burn"),
    stay: useFieldId("stay"),
    pour: useFieldId("pour"),
    visc: useFieldId("visc"),
    sulphur: useFieldId("sul"),
    flash: useFieldId("flash"),
    etaFrom: useFieldId("etaf"),
    etaTo: useFieldId("etat"),
    etdFrom: useFieldId("etdf"),
    etdTo: useFieldId("etdt"),
    port: useFieldId("port"),
    headroom: useFieldId("headroom"),
    delivery: useFieldId("del"),
    pairGrade: useFieldId("pair"),
    surveyor: useFieldId("surv"),
    srcm: useFieldId("srcm"),
    justification: useFieldId("just"),
    notes: useFieldId("notes"),
  };

  if (!spec || !track || !ctx || !value) return null;

  const patch = (fields: Partial<SpotBunkerRequest>) =>
    onChange({ ...value, ...fields });

  const err = (field: keyof SpotBunkerRequest) => errorFor(issues, field);
  const errorCount = issues.filter((i) => i.level === "error").length;

  /** Everything a Section needs but its children, derived from one id. */
  const section = (id: SectionId) => {
    const list = bySection.get(id) ?? [];
    return {
      id,
      open: openSections.has(id),
      summary: summaryFor(id, value),
      errorCount: list.filter((i) => i.level === "error").length,
      warnCount: list.filter((i) => i.level === "warn").length,
      onToggle: toggleSection,
      registerRef: registerSection,
    };
  };

  const warningsIn = (id: SectionId) =>
    (bySection.get(id) ?? [])
      .filter((i) => i.level === "warn")
      .map((i) => i.message);

  /** What makes collapsing safe: no error can hide behind a shut header. */
  const jumpToFirstError = () => {
    const target = SECTION_ORDER.find((id) =>
      (bySection.get(id) ?? []).some((i) => i.level === "error"),
    );
    if (target === undefined) return;

    setOpenSections((prev) => new Set(prev).add(target));
    // The section may have only just been expanded, so the scroll waits for
    // the commit that renders its body.
    requestAnimationFrame(() =>
      sectionEls.current
        .get(target)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
  };

  const residual = isResidual(value.grade);
  const distillate = value.grade === "MGO";

  // Only grades this specific hull can actually lift *and* that are lawful
  // at the destination are selectable — ctx.eligibleGrades (src/lib/spotBunker.ts)
  // narrows ctx.carriedGrades (scrubber fitting, and whether this hull's one
  // ECA-compliance tank is MGO at all — a METHANOL_VESSELS/LNG_VESSELS/
  // B40_VESSELS hull carries none of this form's three tanks) further by
  // ctx.isEcaDestination: inside a port ECA, HSFO/VLSFO drop out regardless
  // of hull capability, since neither can meet the 0.10% cap. validateSpotRequest
  // enforces the same set as a backstop if a draft is ever mutated some other way.
  const gradeOptions: ReadonlyArray<Option<SpotFuelGrade>> = [
    {
      value: "HSFO",
      label: "HSFO",
      disabled: !ctx.eligibleGrades.has("HSFO"),
      disabledReason: ctx.eligibleGrades.has("HSFO")
        ? undefined
        : ctx.carriedGrades.has("HSFO")
          ? `${ctx.portName ?? "This port"} is inside an ECA — HSFO cannot meet the 0.10% cap.`
          : "No scrubber fitted — HSFO is not a lawful lift for this hull.",
    },
    {
      value: "VLSFO",
      label: "VLSFO",
      disabled: !ctx.eligibleGrades.has("VLSFO"),
      disabledReason: ctx.eligibleGrades.has("VLSFO")
        ? undefined
        : `${ctx.portName ?? "This port"} is inside an ECA — VLSFO cannot meet the 0.10% cap.`,
    },
    {
      value: "MGO",
      label: "MGO",
      disabled: !ctx.eligibleGrades.has("MGO"),
      disabledReason: ctx.eligibleGrades.has("MGO")
        ? undefined
        : "This hull's ECA-compliance tank is not MGO — it has no MGO to lift.",
    },
  ];

  /**
   * Changing grade moves the ROB reading to the new tank. Current ROB is a
   * read-only figure off the movement series, not a CE-typed one, so this
   * always re-syncs it rather than only when the engineer hasn't touched it.
   */
  const selectGrade = (next: SpotFuelGrade) => {
    patch({
      grade: next,
      robMt: ctx.robByGrade[tankFor(next)],
      // A distillate has no 380/500 choice; a residual defaults to 380.
      residualViscosityGrade: isResidual(next)
        ? (value.residualViscosityGrade ?? "380")
        : null,
      heaterConfirmedFor500Cst: isResidual(next)
        ? value.heaterConfirmedFor500Cst
        : false,
    });
  };

  /** Biofuel makes BQS mandatory and steers the surveyor to Maritec. */
  const selectBiofuel = (on: boolean) =>
    patch({
      biofuelLifting: on,
      bqsRequested: on ? true : value.bqsRequested,
      bqsSurveyor: on ? (value.bqsSurveyor ?? "Maritec") : value.bqsSurveyor,
    });

  const headroom = residual ? ctx.residualHeadroomMt : ctx.mgoHeadroomMt;

  return (
    // Same width as ServicePanel, VesselPanel and PortPanel. `w-full` keeps
    // narrow screens unchanged. The width comes from the constant rather than a
    // Tailwind class so the camera bias in Explorer cannot drift out of step.
    <aside
      style={{ maxWidth: SPOT_PANEL_WIDTH }}
      className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:shadow-none"
      aria-label={`Spot bunker requirement for ${spec.name}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 mb-1 flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] text-faint transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <svg
              width="9"
              height="8"
              viewBox="0 0 9 8"
              aria-hidden
              className="shrink-0"
            >
              <path
                d="M4 1L1 4l3 3M1 4h7"
                stroke="currentColor"
                strokeWidth="1.3"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="truncate">{spec.name}</span>
          </button>
          <h2 className="truncate text-[15px] font-semibold leading-tight text-fg">
            Spot bunker requirement
          </h2>
          {/* The leg and the berth: context about what the requirement is for,
              not schedule input, so it lives here rather than costing two rows
              inside the schedule section. */}
          <p className="tnum mt-1 text-[11px] leading-relaxed text-faint">
            {ctx.fromPortCode ?? "—"} → {ctx.portCode ?? "—"}
            {ctx.portName ? ` ${ctx.portName}` : ""} · arriving{" "}
            {ctx.arrivalTimestamp ?? "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="-mr-1 shrink-0 rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
            />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* --- 1. Grade and specification --- */}
        <Section {...section("grade")}>
          <Field
            label="Required grade"
            hint={
              gradeOptions
                .filter((o) => o.disabled && o.disabledReason)
                .map((o) => o.disabledReason)
                .join(" ") || "Every grade below is a lawful lift here."
            }
            error={err("grade")}
          >
            <Segmented
              value={value.grade}
              options={gradeOptions}
              onChange={selectGrade}
            />
          </Field>

          {value.grade === "HSFO" && (
            <CheckRow
              checked={value.scrubberOperational}
              onChange={(on) => patch({ scrubberOperational: on })}
              label="Exhaust gas cleaning scrubber is fully operational"
              hint="The specifications sheet records a fitting, not an operating state — nothing in this data can confirm it."
              error={err("scrubberOperational")}
            />
          )}

          <Field
            label="ISO 8217 edition"
            htmlFor={ids.iso}
            note="The edition the delivered fuel must meet."
            error={err("isoVersion")}
          >
            <SelectInput
              id={ids.iso}
              value={value.isoVersion}
              options={ISO_OPTIONS}
              onChange={(v) => patch({ isoVersion: v })}
            />
          </Field>

          <WarnCallout messages={warningsIn("grade")} />
        </Section>

        {/* --- 2. Quantity and ROB --- */}
        <Section {...section("quantity")}>
          <Field
            label="Nomination"
            htmlFor={ids.nomination}
            hint="See headroom on arrival below before nominating a quantity."
            error={err("nominationMt")}
          >
            <NumberInput
              id={ids.nomination}
              value={value.nominationMt}
              onChange={(v) => patch({ nominationMt: v })}
              unit="MT"
              step={10}
              min={0}
              placeholder="0"
            />
          </Field>

          <FieldRow>
            <Field
              label="Current ROB"
              htmlFor={ids.rob}
              hint="Read off the movement series — not typed."
              error={err("robMt")}
            >
              <NumberInput
                id={ids.rob}
                value={value.robMt}
                onChange={() => {}}
                unit="MT"
                step={1}
                disabled
              />
            </Field>
            <Field
              label="Burn to delivery"
              htmlFor={ids.burn}
              hint="Assumed daily rate."
              error={err("projectedConsumptionMt")}
            >
              <NumberInput
                id={ids.burn}
                value={value.projectedConsumptionMt}
                onChange={(v) => patch({ projectedConsumptionMt: v })}
                unit="MT"
                step={1}
              />
            </Field>
          </FieldRow>

          <Field
            label="Headroom on arrival"
            htmlFor={ids.headroom}
            hint={
              headroom === null
                ? "No capacity figure exists for this vessel."
                : headroom === 0
                  ? `Tank projected full on arrival at ${ctx.portName ?? ctx.portCode ?? "port"} — no room for a top-up until it burns down.`
                  : `Room left in the ${residual ? "residual" : "distillate"} tank once the vessel reaches ${ctx.portName ?? ctx.portCode ?? "port"} — Current ROB minus the burn already simulated for the leg, not today's figure.`
            }
          >
            <NumberInput
              id={ids.headroom}
              value={headroom}
              onChange={() => {}}
              unit="MT"
              disabled
            />
          </Field>

          <FieldRow>
            <Field label="Port stay" htmlFor={ids.stay}>
              <NumberInput
                id={ids.stay}
                value={value.portStayDays}
                onChange={(v) => patch({ portStayDays: v })}
                unit="days"
                step={0.5}
              />
            </Field>
          </FieldRow>

          <WarnCallout messages={warningsIn("quantity")} />
        </Section>

        {/* --- 3. Temperature and cold flow --- */}
        <Section {...section("coldflow")}>
          <Field
            label="Maximum pour point"
            htmlFor={ids.pour}
            note="Declare for the voyage climate — an ARA transit between November and January needs a lower figure than this trade."
            error={err("maxPourPointC")}
          >
            <NumberInput
              id={ids.pour}
              value={value.maxPourPointC}
              onChange={(v) => patch({ maxPourPointC: v })}
              unit="°C"
              step={1}
            />
          </Field>

          {distillate && (
            <Field
              label="Minimum viscosity"
              htmlFor={ids.visc}
              hint="The engine's OEM minimum. Distillates run 2–5 mm²/s; nothing in this data records the engine limit."
              error={err("minViscosityCst")}
            >
              <NumberInput
                id={ids.visc}
                value={value.minViscosityCst}
                onChange={(v) => patch({ minViscosityCst: v })}
                unit="mm²/s"
                step={0.1}
              />
            </Field>
          )}

          {residual && (
            <>
              <Field
                label="Residual viscosity"
                note="500 CST needs enough onboard heating to bring it down for burning."
                error={err("residualViscosityGrade")}
              >
                <Segmented
                  value={value.residualViscosityGrade}
                  options={CST_OPTIONS}
                  onChange={(v) => patch({ residualViscosityGrade: v })}
                />
              </Field>

              {value.residualViscosityGrade === "500" && (
                <CheckRow
                  checked={value.heaterConfirmedFor500Cst}
                  onChange={(on) => patch({ heaterConfirmedFor500Cst: on })}
                  label="Onboard heaters and boilers can handle 500 CST"
                  hint="Not recorded anywhere in this data. Without the capacity, stick to 380 CST."
                  error={err("heaterConfirmedFor500Cst")}
                />
              )}
            </>
          )}

          <WarnCallout messages={warningsIn("coldflow")} />
        </Section>

        {/* --- 4. Environmental and statutory --- */}
        <Section {...section("statutory")}>
          <Field
            label="Maximum sulphur"
            htmlFor={ids.sulphur}
            hint={
              ctx.isEcaDestination
                ? `${ctx.portName ?? ctx.portCode} sits inside a port ECA: 0.10% maximum.`
                : value.grade === "HSFO"
                  ? value.scrubberOperational
                    ? "With the scrubber confirmed operational, HSFO meets the 0.50% global cap through equivalent compliance — ISO 8217 RMG grades still run up to roughly 3.50%."
                    : "HSFO has no 0.50% spec — that's VLSFO's ceiling. ISO 8217 RMG grades run up to roughly 3.50%, unless an operational scrubber is confirmed above."
                  : "0.50% is the global cap; a port ECA cuts it to 0.10%."
            }
            error={err("maxSulphurPct")}
          >
            <NumberInput
              id={ids.sulphur}
              value={value.maxSulphurPct}
              onChange={(v) => patch({ maxSulphurPct: v })}
              unit="% m/m"
              step={0.01}
              min={0}
            />
          </Field>

          <Field
            label="Minimum flash point"
            htmlFor={ids.flash}
            note="Statutory minimum is 60 °C; the desk asks suppliers to declare 70 °C or above."
            error={err("minFlashPointC")}
          >
            <NumberInput
              id={ids.flash}
              value={value.minFlashPointC}
              onChange={(v) => patch({ minFlashPointC: v })}
              unit="°C"
              step={1}
            />
          </Field>

          <CheckRow
            checked={value.supplierFlashDeclarationRequired}
            onChange={(on) => patch({ supplierFlashDeclarationRequired: on })}
            label="Require a supplier flash point declaration"
            note="Confirming the actual figure, not just the specification."
          />

          <WarnCallout messages={warningsIn("statutory")} />
        </Section>

        {/* --- 5. Schedule, port and barging --- */}
        <Section {...section("schedule")}>
          {/* The project's provenance rule. Nothing in this repo carries a
              published ETA, and a window that looks quoted would read as one. */}
          <div className="mx-4 mb-1 mt-1 rounded border border-warn/40 bg-warn/10 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-warn">
              <span className="font-semibold">Arrival is simulated.</span> It is
              read off the generated movement series, not a published ETA — the
              schedule data carries loop-relative day numbers, not dates. Treat
              the window below as a placeholder for a real ETA feed.
            </p>
          </div>

          <FieldRow>
            <Field
              label="ETA from"
              htmlFor={ids.etaFrom}
              error={err("etaWindowStart")}
            >
              <DateTimeInput
                id={ids.etaFrom}
                value={value.etaWindowStart}
                onChange={(v) => patch({ etaWindowStart: v })}
              />
            </Field>
            <Field label="ETA to" htmlFor={ids.etaTo} error={err("etaWindowEnd")}>
              <DateTimeInput
                id={ids.etaTo}
                value={value.etaWindowEnd}
                onChange={(v) => patch({ etaWindowEnd: v })}
              />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="ETD from" htmlFor={ids.etdFrom}>
              <DateTimeInput
                id={ids.etdFrom}
                value={value.etdWindowStart}
                onChange={(v) => patch({ etdWindowStart: v })}
              />
            </Field>
            <Field label="ETD to" htmlFor={ids.etdTo}>
              <DateTimeInput
                id={ids.etdTo}
                value={value.etdWindowEnd}
                onChange={(v) => patch({ etdWindowEnd: v })}
              />
            </Field>
          </FieldRow>

          <Field
            label="Bunkering location"
            htmlFor={ids.port}
            hint="Always the vessel's next port on this leg — read-only here, set from its current position."
          >
            <TextInput
              id={ids.port}
              value={ctx.portName ?? ctx.portCode}
              onChange={() => {}}
              disabled
            />
          </Field>

          <Field
            label="Bunkering Method"
            htmlFor={ids.delivery}
            error={err("deliveryLocation")}
          >
            <SelectInput
              id={ids.delivery}
              value={value.deliveryLocation}
              options={DELIVERY_OPTIONS}
              onChange={(v) => patch({ deliveryLocation: v })}
            />
          </Field>

          <CheckRow
            checked={value.simops}
            onChange={(on) => patch({ simops: on })}
            label="Bunkering during cargo operations (SIMOPS)"
            note="Flag it so the desk can clear the simultaneous operation with the terminal."
          />

          <CheckRow
            checked={value.bargePairing}
            onChange={(on) =>
              patch({
                bargePairing: on,
                bargePairingGrade: on ? value.bargePairingGrade : null,
              })
            }
            label="Pair grades on one dual-grade barge"
            note="Two grades on a single barge cuts the barging fee."
          />

          {value.bargePairing && (
            <Field
              label="Second grade on the barge"
              htmlFor={ids.pairGrade}
              error={err("bargePairingGrade")}
            >
              <SelectInput
                id={ids.pairGrade}
                value={value.bargePairingGrade}
                options={gradeOptions}
                onChange={(v) => patch({ bargePairingGrade: v })}
              />
            </Field>
          )}

          <WarnCallout messages={warningsIn("schedule")} />
        </Section>

        {/* --- 6. Surveyor and quality testing --- */}
        <Section {...section("survey")}>
          <p className="px-4 pb-1 pt-1 text-[11px] leading-relaxed text-faint">
            Conventional fuels run under a standing no-BQS policy. An exception
            needs SRCM Head approval; a biofuel lifting is always surveyed.
          </p>

          <CheckRow
            checked={value.biofuelLifting}
            onChange={selectBiofuel}
            label="This is a biofuel lifting"
            note="Forces a bunker quantity survey and steers the appointment to Maritec."
          />

          <CheckRow
            checked={value.bqsRequested}
            onChange={(on) => patch({ bqsRequested: on })}
            disabled={value.biofuelLifting}
            label="Appoint a bunker quantity surveyor"
            hint={
              value.biofuelLifting
                ? "Locked on: BQS is mandatory on a biofuel lifting."
                : "An exception to the cost-saving policy — justify it below."
            }
            error={err("bqsRequested")}
          />

          {value.bqsRequested && (
            <>
              <Field
                label="Surveyor"
                htmlFor={ids.surveyor}
                error={err("bqsSurveyor")}
              >
                <SelectInput
                  id={ids.surveyor}
                  value={value.bqsSurveyor}
                  options={SURVEYOR_OPTIONS}
                  onChange={(v) => patch({ bqsSurveyor: v })}
                />
              </Field>

              {!value.biofuelLifting && (
                <>
                  <Field
                    label="SRCM Head approval reference"
                    htmlFor={ids.srcm}
                    error={err("srcmApprovalRef")}
                  >
                    <TextInput
                      id={ids.srcm}
                      value={value.srcmApprovalRef}
                      onChange={(v) => patch({ srcmApprovalRef: v })}
                      placeholder="Approval reference"
                    />
                  </Field>

                  <Field
                    label="Justification"
                    htmlFor={ids.justification}
                    hint="Persistent short-delivery disputes on this lane or with this supplier. No dispute history is carried in this data."
                    error={err("bqsJustification")}
                  >
                    <TextArea
                      id={ids.justification}
                      value={value.bqsJustification}
                      onChange={(v) => patch({ bqsJustification: v })}
                      placeholder="Why this stem needs a surveyor"
                    />
                  </Field>
                </>
              )}
            </>
          )}

          <CheckRow
            checked={value.coqRequested}
            onChange={(on) => patch({ coqRequested: on })}
            label="Request the supplier's laboratory COQ in advance"
            note="Verify density and viscosity before the barge comes alongside."
          />

          <CheckRow
            checked={value.contaminantScreening}
            onChange={(on) => patch({ contaminantScreening: on })}
            label="Screen for chemical contaminants"
            note="Chlorinated organic compounds and similar, which ISO 8217 alone may not detect."
          />

          <CheckRow
            checked={value.fqtSamplesPrepared}
            onChange={(on) => patch({ fqtSamplesPrepared: on })}
            label="Sampling bottles prepared for independent FQT"
            note="Our own samples to the lab on delivery, alongside the retained manifold sample."
          />

          <WarnCallout messages={warningsIn("survey")} />
        </Section>

        {/* --- Anything the six sections do not cover --- */}
        <Section {...section("notes")}>
          <Field label="For the desk" htmlFor={ids.notes}>
            <TextArea
              id={ids.notes}
              value={value.notes}
              onChange={(v) => patch({ notes: v })}
              placeholder="Anything else the bunker desk should know"
            />
          </Field>
        </Section>
      </div>

      {/* --- Submit, pinned --- */}
      {/* Outside the scroll area: with sections shut the error count is the
          only thing saying the form is incomplete, and it should never be three
          screens down. No position:sticky needed — the aside is a flex column
          and the scroll region above takes the slack. */}
      <div className="shrink-0 border-t border-line px-4 pb-3 pt-2.5">
        {errorCount > 0 && (
          <button
            type="button"
            onClick={jumpToFirstError}
            className="mb-1.5 block w-full rounded text-center text-[10px] text-down transition-colors hover:text-fg"
          >
            {errorCount} {errorCount === 1 ? "field needs" : "fields need"}{" "}
            attention →
          </button>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => generateSpotBunkerPdf(spec, ctx, value, issues)}
            className="rounded border border-line-strong bg-surface-2 px-3 py-2 text-[12px] font-semibold text-fg transition-colors hover:border-faint"
          >
            Generate PDF
          </button>
          <button
            type="button"
            disabled={errorCount > 0}
            onClick={() => onSubmit(value, ctx)}
            className="flex-1 rounded border border-line-strong bg-accent/15 px-3 py-2 text-[12px] font-semibold text-accent transition-colors hover:bg-accent/25 disabled:cursor-default disabled:bg-surface-2 disabled:text-faint/60 disabled:hover:bg-surface-2"
          >
            See bunkering combinations →
          </button>
        </div>
      </div>
    </aside>
  );
}
