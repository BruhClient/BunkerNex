"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { serviceColor } from "@/lib/colors";
import { formatDate, formatMt, formatPrice } from "@/lib/format";
import type { BunkerEvent } from "@/lib/bunkerEvents";

interface Props {
  /** Every stem in the window, chronological. Filtered to services here. */
  events: BunkerEvent[];
  visibleServices: string[];
  stepIndex: number;
  /** Date of the latest price assessment, for the provenance footer. */
  asOf: string | null;
  open: boolean;
  onToggle: () => void;
  onSeek: (step: number) => void;
  onSelectVessel: (name: string) => void;
}

type SortKey = "time" | "port" | "quantity" | "price" | "value";
type SortDir = "asc" | "desc";

/** Where a row sits relative to the scrubbed moment. */
type RowState = "past" | "now" | "future";

/** Totals only ever run to a few million, so one compact form covers them. */
const compactUsd = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export default function BunkerLog({
  events,
  visibleServices,
  stepIndex,
  asOf,
  open,
  onToggle,
  onSeek,
  onSelectVessel,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "time",
    dir: "asc",
  });

  // Same filter the map applies, so hiding a service empties it from both.
  const visible = useMemo(
    () => events.filter((e) => visibleServices.includes(e.serviceCode)),
    [events, visibleServices],
  );

  const totals = useMemo(() => {
    let mt = 0;
    let usd = 0;
    let priced = 0;
    for (const e of visible) {
      mt += e.quantityMt;
      if (e.valueUsd !== null) {
        usd += e.valueUsd;
        priced += 1;
      }
    }
    return { mt, usd, priced };
  }, [visible]);

  const rows = useMemo(() => sortEvents(visible, sort), [visible, sort]);

  // Steps that actually carry a stem, so the auto-scroll effect below can skip
  // the ~680 steps of the window that have none.
  const stemSteps = useMemo(
    () => new Set(visible.map((e) => e.step)),
    [visible],
  );

  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    // Only follows playback in chronological order — under any other sort the
    // current row is scattered and chasing it would just yank the list around.
    if (!open || sort.key !== "time") return;
    if (!stemSteps.has(stepIndex)) return;
    const row = bodyRef.current?.querySelector(`[data-step="${stepIndex}"]`);
    // "nearest" and no smooth behaviour: at 12 steps/s an animated scroll would
    // still be running when the next stem lands.
    row?.scrollIntoView({ block: "nearest" });
  }, [open, sort.key, stepIndex, stemSteps]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : // Time reads forward by default; every measure reads largest-first,
          // which is the question actually being asked of it.
          { key, dir: key === "time" ? "asc" : "desc" },
    );

  return (
    <section
      className="pointer-events-auto border-t border-line bg-bg/95 backdrop-blur"
      aria-label="Bunker log"
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            aria-hidden
            className={`shrink-0 text-faint transition-transform ${
              open ? "" : "rotate-180"
            }`}
          >
            <path
              d="M1 6.5 L5 2.5 L9 6.5"
              stroke="currentColor"
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="label shrink-0 leading-none">Bunker log</span>
          <span className="tnum truncate text-[11px] text-muted">
            {visible.length} {visible.length === 1 ? "stem" : "stems"} ·{" "}
            {formatMt(totals.mt)} MT
            {totals.priced > 0 && <> · ${compactUsd.format(totals.usd)} est.</>}
          </span>
        </button>
      </h2>

      {open && (
        <>
          <div className="max-h-[40vh] overflow-auto border-t border-line">
            <table className="w-full min-w-[620px] border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-bg">
                <tr className="border-b border-line">
                  <Th sort={sort} onSort={toggleSort} sortKey="time">
                    Time
                  </Th>
                  <Th>Vessel</Th>
                  <Th sort={sort} onSort={toggleSort} sortKey="port">
                    Port
                  </Th>
                  <Th>Grade</Th>
                  <Th sort={sort} onSort={toggleSort} sortKey="quantity" right>
                    MT
                  </Th>
                  <Th sort={sort} onSort={toggleSort} sortKey="price" right>
                    $/mt
                  </Th>
                  <Th sort={sort} onSort={toggleSort} sortKey="value" right>
                    Est. value
                  </Th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {rows.map((event) => (
                  <LogRow
                    key={event.id}
                    event={event}
                    state={
                      event.step === stepIndex
                        ? "now"
                        : event.step < stepIndex
                          ? "past"
                          : "future"
                    }
                    onSeek={onSeek}
                    onSelectVessel={onSelectVessel}
                  />
                ))}
              </tbody>
            </table>

            {rows.length === 0 && (
              <p className="px-4 py-6 text-center text-[11px] text-faint">
                No stems for the services currently shown.
              </p>
            )}
          </div>

          {/* The two gaps in this data, stated rather than averaged away. */}
          <p className="border-t border-line px-4 py-1.5 text-[10px] leading-relaxed text-faint">
            {totals.priced} of {visible.length} stems priced — only Singapore,
            Busan and Shanghai are assessed, and Shanghai carries no
            high-sulphur column. Figures are the latest assessment
            {asOf ? ` (${formatDate(asOf)})` : ""}, not the price on the day of
            the stem, so est. value is an indication only. No source attributes
            a stem to a supplier.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * One stem.
 *
 * Memoised because the drawer re-renders on every step during playback (12/s)
 * while at most a couple of rows change state — without this, all 154 would
 * re-render 12 times a second for nothing.
 */
const LogRow = memo(function LogRow({
  event,
  state,
  onSeek,
  onSelectVessel,
}: {
  event: BunkerEvent;
  state: RowState;
  onSeek: (step: number) => void;
  onSelectVessel: (name: string) => void;
}) {
  return (
    <tr
      data-step={event.step}
      onClick={() => {
        onSeek(event.step);
        onSelectVessel(event.vesselName);
      }}
      className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-2 ${
        state === "now"
          ? "bg-accent/10"
          : // Not yet happened at the scrubbed moment.
            state === "future"
            ? "opacity-40"
            : ""
      }`}
    >
      <td className="whitespace-nowrap py-1 pl-4 pr-3">
        <span className="flex items-center gap-2">
          {/* Same hue the service's route line carries on the map. */}
          <span
            aria-hidden
            className="h-3 w-0.5 shrink-0 rounded-full"
            style={{ background: serviceColor(event.serviceCode) }}
          />
          <span className="tnum text-fg">{event.timestamp}</span>
        </span>
      </td>
      <td className="max-w-[180px] truncate py-1 pr-3 text-fg">
        {event.vesselName}
      </td>
      <td className="whitespace-nowrap py-1 pr-3">
        <span className="tnum text-fg" title={event.portName}>
          {event.portCode}
        </span>
      </td>
      <td className="whitespace-nowrap py-1 pr-3 text-muted">{event.grade}</td>
      <td className="tnum whitespace-nowrap py-1 pr-3 text-right text-fg">
        {formatMt(event.quantityMt)}
      </td>
      <td className="whitespace-nowrap py-1 pr-3 text-right">
        {event.price ? (
          <span className="tnum text-accent">
            {formatPrice(event.price.value)}
          </span>
        ) : (
          <span className="italic text-faint">Not assessed</span>
        )}
      </td>
      <td className="tnum whitespace-nowrap py-1 pr-4 text-right text-muted">
        {/* Blank, not a dash and never 0 — an unpriced stem has no value here,
            and the footer counts how many that is. */}
        {event.valueUsd === null
          ? ""
          : `$${Math.round(event.valueUsd).toLocaleString("en-US")}`}
      </td>
    </tr>
  );
});

function Th({
  children,
  sortKey,
  sort,
  onSort,
  right,
}: {
  children: React.ReactNode;
  sortKey?: SortKey;
  sort?: { key: SortKey; dir: SortDir };
  onSort?: (key: SortKey) => void;
  right?: boolean;
}) {
  const active = sortKey !== undefined && sort?.key === sortKey;

  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
      }
      className={`label whitespace-nowrap py-1.5 font-normal ${
        right ? "pr-4 text-right" : "pl-4 pr-3 text-left"
      }`}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          // uppercase repeated from .label: a button does not inherit
          // text-transform, so without it the sortable headings sit in
          // mixed case beside the plain ones.
          className={`uppercase transition-colors hover:text-fg ${
            active ? "text-fg" : ""
          }`}
        >
          {children}
          <span aria-hidden className="ml-1 inline-block w-2">
            {active ? (sort.dir === "asc" ? "↑" : "↓") : ""}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function sortEvents(
  events: BunkerEvent[],
  { key, dir }: { key: SortKey; dir: SortDir },
): BunkerEvent[] {
  if (key === "time") {
    // Already chronological from allBunkerEvents.
    return dir === "asc" ? events : [...events].reverse();
  }

  const sign = dir === "asc" ? 1 : -1;

  return [...events].sort((a, b) => {
    if (key === "port") {
      return sign * a.portCode.localeCompare(b.portCode) || a.step - b.step;
    }
    if (key === "quantity") {
      return sign * (a.quantityMt - b.quantityMt) || a.step - b.step;
    }

    // Price and value are nullable for the 18 unpriced stems. Those sort to
    // the bottom under either direction rather than being ordered as if they
    // were 0 — a stem with no assessment is not a cheap stem.
    const av = key === "price" ? (a.price?.value ?? null) : a.valueUsd;
    const bv = key === "price" ? (b.price?.value ?? null) : b.valueUsd;
    if (av === null && bv === null) return a.step - b.step;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv) || a.step - b.step;
  });
}
