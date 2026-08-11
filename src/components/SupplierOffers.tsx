"use client";

import Link from "next/link";
import { useState } from "react";
import { GRADE_COLORS, GRADE_LABELS } from "@/lib/colors";
import { formatDate, formatDays, formatMt, formatPrice } from "@/lib/format";
import type { Grade, PortMarket, SupplierOffer } from "@/lib/types";

/**
 * The supplier panel for one port: baseline, then who quotes against it.
 *
 * Markets arrive ordered by grade with their offers already sorted cheapest
 * first, so this only picks a grade and renders. Laid out as a table rather
 * than a list because the panel exists to be compared down a column — the same
 * reason BunkerLog is a table.
 *
 * This table is deliberately thin — one current quote per supplier. The full
 * evaluation (a year of quote history, delivery-capability scatter, realised
 * scorecard, settled-stem history) lives at /hq, built at full page width
 * because it does not fit this panel's 420px cap. The links below are the
 * bridge between the two: they carry the port/grade/supplier already chosen
 * here straight into that view, so the panel/desk read as one flow rather
 * than two disconnected features.
 */
export default function SupplierOffers({
  markets,
  portKey,
}: {
  markets: PortMarket[];
  portKey: string;
}) {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (markets.length === 0) return null;

  const market = markets.find((m) => m.grade === grade) ?? markets[0];
  // Ties both highlight: two suppliers can land on the same number.
  const best = market.offers[0]?.price ?? null;

  const selectGrade = (next: Grade) => {
    setGrade(next);
    // The open row belongs to the grade being left, so it cannot stay open.
    setExpanded(null);
  };

  return (
    <div>
      {/* Grades are mutually exclusive, so this is the segmented control the
          chart's range picker uses — not the legend's multi-select toggles. */}
      {markets.length > 1 && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-px overflow-hidden rounded border border-line">
            {markets.map((m) => {
              const active = m.grade === market.grade;
              return (
                <button
                  key={m.grade}
                  type="button"
                  onClick={() => selectGrade(m.grade)}
                  aria-pressed={active}
                  className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-medium transition-colors ${
                    active
                      ? "bg-accent/15 text-accent"
                      : "text-faint hover:text-fg"
                  }`}
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      background: GRADE_COLORS[m.grade],
                      opacity: active ? 1 : 0.45,
                    }}
                  />
                  {GRADE_LABELS[m.grade]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Kept out of the table: the assessment is not a quote, and nobody sells
          at it. */}
      <div className="flex items-baseline justify-between gap-2 border-y border-line bg-surface-2 px-4 py-2">
        <span className="label">Baseline</span>
        <span className="flex items-baseline gap-2">
          <span className="tnum text-[13px] font-semibold text-fg">
            {formatPrice(market.baseline?.value)}
            <span className="ml-1 text-[10px] font-normal text-faint">
              $/mt
            </span>
          </span>
          <span className="tnum text-[10px] text-faint">
            {formatDate(market.baseline?.date)}
          </span>
        </span>
      </div>

      <table className="w-full table-fixed border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-line">
            <th className="label py-1.5 pl-4 pr-2 text-left font-normal">
              Supplier
            </th>
            <th className="label w-13 py-1.5 pr-2 text-right font-normal">
              $/mt
            </th>
            <th className="label w-12 py-1.5 pr-2 text-right font-normal">Δ</th>
            <th className="label w-16 py-1.5 pr-4 text-right font-normal">
              Parcel
            </th>
          </tr>
        </thead>

        <tbody>
          {market.offers.map((offer) => {
            const open = expanded === offer.supplier;
            return (
              <OfferRows
                key={offer.supplier}
                offer={offer}
                portKey={portKey}
                grade={market.grade}
                isBest={offer.price === best}
                open={open}
                onToggle={() => setExpanded(open ? null : offer.supplier)}
              />
            );
          })}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="text-[10px] text-faint">
          Select a supplier for delivery terms
        </span>
        <Link
          href={`/hq?port=${portKey}&grade=${market.grade}`}
          className="shrink-0 text-[10px] font-medium text-accent transition-colors hover:text-fg"
        >
          Full price history &amp; supplier scorecards →
        </Link>
      </div>
    </div>
  );
}

function OfferRows({
  offer,
  portKey,
  grade,
  isBest,
  open,
  onToggle,
}: {
  offer: SupplierOffer;
  portKey: string;
  grade: Grade;
  isBest: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        aria-expanded={open}
        className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-2 ${
          open ? "bg-surface-2" : ""
        }`}
      >
        <td className="py-1.5 pl-4 pr-2">
          <span className="flex items-baseline gap-1.5">
            {/* min-w-0 is what lets truncate engage — a flex child will not
                shrink below its content width without it. */}
            <span className="min-w-0 truncate text-fg" title={offer.supplier}>
              {offer.supplier}
            </span>
            <span
              className="shrink-0 rounded-[2px] border border-line px-1 text-[9px] font-semibold text-faint"
              title={offer.tierLabel}
            >
              T{offer.tier}
            </span>
          </span>
        </td>

        {/* The cheapest quote is accented rather than chipped — the same way
            BunkerLog marks a priced stem. */}
        <td
          className={`tnum py-1.5 pr-2 text-right font-semibold ${
            isBest ? "text-accent" : "text-fg"
          }`}
        >
          {formatPrice(offer.price)}
        </td>

        {/* Deliberately not the up/down palette. Green means the price rose
            everywhere else in this app; here the lower number is the better
            buy, so colouring by sign would invert the scale two panels apart. */}
        <td className="tnum py-1.5 pr-2 text-right text-muted">
          {formatDiff(offer.diff)}
        </td>

        <td className="tnum py-1.5 pr-4 text-right text-muted">
          {formatParcel(offer.minMt, offer.maxMt)}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line/60 bg-surface-2">
          <td colSpan={4} className="px-4 pb-3 pt-1">
            <dl className="grid grid-cols-4 gap-2">
              <Cell label="Delivery" value={offer.deliveryMode} />
              <Cell label="Pump" value={`${offer.pumpRateMtPerHour} MT/h`} />
              <Cell label="Lead" value={formatDays(offer.leadTimeDays)} />
              <Cell label="Terms" value={formatDays(offer.paymentTermsDays)} />
            </dl>
            <p className="mt-2 text-[10px] text-muted">
              {formatMt(offer.minMt)}–{formatMt(offer.maxMt)} MT ·{" "}
              {offer.availability}
            </p>
            <Link
              href={`/hq?port=${portKey}&grade=${grade}&supplier=${encodeURIComponent(offer.supplier)}`}
              className="mt-2 inline-block text-[10px] font-medium text-accent transition-colors hover:text-fg"
            >
              View {offer.supplier}&apos;s full record →
            </Link>
          </td>
        </tr>
      )}
    </>
  );
}

/** Label over value, the same shape SchedulePanel uses for its call figures. */
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 text-[11px] text-fg">{value}</dd>
    </div>
  );
}

/**
 * Signed differential. Unlike formatDelta this shows an explicit sign at parity
 * — a bare "0.0" would read as a missing quote rather than as one struck at the
 * assessment.
 */
function formatDiff(diff: number): string {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  return `${sign}${Math.abs(diff).toFixed(1)}`;
}

/**
 * Lifting range, e.g. "450–2.5k".
 *
 * formatMt would give "450–2,500", which does not fit the column at this panel
 * width. Sub-thousand figures stay in whole tonnes rather than collapsing to
 * one decimal — 150 MT rendered as "0.1k" understates the parcel by a third.
 * The full range is spelled out in the expanded row either way.
 */
function formatParcel(minMt: number, maxMt: number): string {
  const short = (v: number) =>
    v < 1000 ? String(Math.round(v)) : `${(v / 1000).toFixed(1)}k`;
  return `${short(minMt)}–${short(maxMt)}`;
}
