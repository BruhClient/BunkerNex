"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The first form controls in this codebase.
 *
 * The only precedent is TimeScrubber's range slider, styled by a hand-written
 * .bn-scrub block in globals.css. This deliberately does not follow it: every
 * control here is expressible in Tailwind, so the idiom stays beside the
 * components that use it rather than splitting across two files.
 *
 * NULL DISCIPLINE. Every control collapses an empty entry to null, never "" and
 * never 0 — a 0 MT stem or a 0.00% sulphur cap is a factual error, not a
 * missing value. That rule lives here, at the input boundary, so no caller has
 * to remember it. See CLAUDE.md.
 *
 * No focus styles anywhere: globals.css already rings button, input, select and
 * textarea on :focus-visible.
 */

const CONTROL =
  "w-full rounded border border-line-strong bg-surface-2 px-2.5 py-1.5 " +
  "text-[12px] text-fg placeholder:text-faint/60 transition-colors " +
  "disabled:cursor-default disabled:text-faint/50";

/**
 * HINT VS NOTE. `hint` records where a figure came from, or that this data
 * cannot confirm something — it stays on screen, because this project keeps
 * provenance visible rather than one click away. `note` is explanatory copy
 * that is read once and thereafter in the way, so it sits behind a `?`.
 *
 * Getting that backwards is the failure mode: a caveat behind a disclosure is a
 * caveat nobody reads. See CLAUDE.md.
 */

/**
 * The `?` that reveals a field's note.
 *
 * A `title` attribute would not do — invisible on touch, unreliable from the
 * keyboard — so this toggles the text into the field's own small-print slot.
 */
function NoteToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} note for ${label}`}
      className={`inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] font-semibold leading-none transition-colors ${
        open
          ? "border-accent/60 bg-accent/15 text-accent"
          : "border-line-strong text-faint hover:border-faint hover:text-fg"
      }`}
    >
      ?
    </button>
  );
}

/**
 * Label, control, then either a hint or an error — never both. An error
 * replaces its hint rather than stacking under it, so a field never grows two
 * lines of small print at once. A `note` is a third line, but only while its
 * `?` is open.
 */
export function Field({
  label,
  hint,
  note,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Explanatory copy, behind a `?`. Not a substitute for `hint` — see above. */
  note?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="label block">
          {label}
        </label>
        {note && (
          <NoteToggle
            open={noteOpen}
            onToggle={() => setNoteOpen((o) => !o)}
            label={label}
          />
        )}
      </div>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-[10px] leading-relaxed text-down">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[10px] leading-relaxed text-faint">{hint}</p>
      ) : null}
      {note && noteOpen && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted">{note}</p>
      )}
    </div>
  );
}

/**
 * Two controls side by side, for paired figures like a window's ends.
 *
 * Children are Fields, which carry their own px-4. Nested in a bare two-column
 * grid that leaves 40px of dead gutter between the pair — a tenth of the panel
 * at 420px, and enough to squeeze a datetime-local below the width Chrome needs
 * to render its value. The row owns the horizontal padding instead, so a pair
 * spans exactly what a lone Field does.
 */
export function FieldRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 px-4 [&>*]:px-0">{children}</div>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw.trim() === "" ? null : raw);
      }}
      className={CONTROL}
    />
  );
}

export function TextArea({
  id,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      id={id}
      rows={rows}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw.trim() === "" ? null : raw);
      }}
      className={`${CONTROL} resize-none leading-relaxed`}
    />
  );
}

/**
 * A number with its unit inside the field.
 *
 * Spinners are suppressed so the unit has room, and the value carries .tnum
 * like every other figure in this app.
 */
export function NumberInput({
  id,
  value,
  onChange,
  unit,
  step,
  min,
  max,
  placeholder,
  disabled,
}: {
  id?: string;
  value: number | null;
  onChange: (next: number | null) => void;
  unit?: string;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          // Blank and unparseable both become null. Number("") is 0, which is
          // exactly the coercion this app treats as a factual error.
          onChange(raw === "" || Number.isNaN(n) ? null : n);
        }}
        className={`${CONTROL} tnum ${unit ? "pr-12" : ""} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      {unit && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] text-faint"
        >
          {unit}
        </span>
      )}
    </div>
  );
}

/**
 * A zoneless wall-clock instant.
 *
 * datetime-local is the one input whose value has no timezone, which is exactly
 * the contract VesselTrack.startTimestamp keeps. The element wants
 * "YYYY-MM-DDTHH:mm" and the app stores "YYYY-MM-DD HH:mm", so the boundary is
 * a space/T swap — never a Date round-trip, which would introduce an offset the
 * source does not have.
 */
export function DateTimeInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <input
      id={id}
      type="datetime-local"
      value={value ? value.replace(" ", "T") : ""}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? null : raw.replace("T", " "));
      }}
      className={`${CONTROL} tnum [color-scheme:dark]`}
    />
  );
}

export interface Option<T> {
  value: T;
  label: string;
  /** Renders struck through and unclickable. */
  disabled?: boolean;
  /** Tooltip explaining a disabled option — say why, not that. */
  disabledReason?: string;
}

/**
 * A dropdown. The popup itself is OS chrome: the option colours land on
 * Chrome and Windows and are ignored by Safari. Accepted rather than replaced
 * with a custom listbox.
 */
export function SelectInput<T extends string>({
  id,
  value,
  options,
  onChange,
  placeholder = "—",
  disabled,
}: {
  id?: string;
  value: T | null;
  options: ReadonlyArray<Option<T>>;
  onChange: (next: T | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : (e.target.value as T))
        }
        className={`${CONTROL} appearance-none pr-8`}
      >
        <option value="" className="bg-surface text-fg">
          {placeholder}
        </option>
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="bg-surface text-fg"
          >
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint"
      >
        <path
          d="M1 1l3 3 3-3"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    </div>
  );
}

/**
 * Mutually exclusive choices, laid out as one bar.
 *
 * Generalises the segmented control PriceChart uses for its range picker and
 * SupplierOffers for its grade tabs. A disabled option is struck through rather
 * than hidden — the same treatment VesselPanel gives a rotation port the track
 * never visits, so "exists but not available here" reads the same way twice.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: ReadonlyArray<Option<T>>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-px overflow-hidden rounded border border-line">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={o.disabled}
            title={o.disabledReason}
            aria-pressed={active}
            className={`flex flex-1 items-center justify-center px-2 py-1.5 text-[10px] font-medium transition-colors ${
              active
                ? "bg-accent/15 text-accent"
                : o.disabled
                  ? "cursor-default text-faint/40 line-through"
                  : "text-faint hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A checkbox whose whole label block is the hit target.
 *
 * A button with role="checkbox" rather than an input: these rows carry a hint
 * line as well as a label, and the hint should be clickable too.
 */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  note,
  error,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
  /** Explanatory copy, behind a `?`. Not a substitute for `hint` — see above. */
  note?: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);

  return (
    // Relative so the `?` can float over the row rather than sit beside it: a
    // button inside a button is invalid, but the hover fill should still run
    // the full width.
    <div className="relative">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`flex w-full items-start gap-2.5 py-2 pl-4 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent ${
          note ? "pr-9" : "pr-4"
        }`}
      >
        <span
          aria-hidden
          className={`mt-px flex size-3.5 shrink-0 items-center justify-center rounded-[2px] border transition-colors ${
            checked
              ? "border-accent bg-accent/20 text-accent"
              : "border-line-strong text-transparent"
          } ${disabled ? "opacity-50" : ""}`}
        >
          <svg width="8" height="7" viewBox="0 0 8 7">
            <path
              d="M1 3.5l2 2L7 1"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="min-w-0">
          <span
            className={`block text-[11px] leading-snug ${
              disabled ? "text-muted" : "text-fg"
            }`}
          >
            {label}
          </span>
          {hint && (
            <span className="mt-0.5 block text-[10px] leading-relaxed text-faint">
              {hint}
            </span>
          )}
        </span>
      </button>
      {note && (
        <div className="absolute right-3 top-2.5">
          <NoteToggle
            open={noteOpen}
            onToggle={() => setNoteOpen((o) => !o)}
            label={label}
          />
        </div>
      )}
      {/* Indented past the checkbox so it reads as the label's continuation:
          px-4 plus the 14px box and its 10px gap. */}
      {note && noteOpen && (
        <p className="pb-1 pl-10 pr-4 text-[10px] leading-relaxed text-muted">
          {note}
        </p>
      )}
      {error && (
        <p className="px-4 pb-1 text-[10px] leading-relaxed text-down">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A section's soft problems, in the callout idiom VesselPanel uses for a vessel
 * below its safety minimum. Warnings never block; they mark a figure that is
 * derived, outside a policy window, or unverifiable from this data.
 */
export function WarnCallout({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="mx-4 mt-2 rounded border border-warn/40 bg-warn/10 px-3 py-2">
      <ul className="space-y-1">
        {messages.map((m) => (
          <li key={m} className="text-[11px] leading-relaxed text-warn">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stable ids for label/control pairs without threading them through props. */
export function useFieldId(prefix: string): string {
  const id = useId();
  return `${prefix}${id}`;
}
