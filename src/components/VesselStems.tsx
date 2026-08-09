"use client";

import { formatMt, formatPrice } from "@/lib/format";
import type { BunkerEvent } from "@/lib/bunkerEvents";

interface Props {
  /** This vessel's stems only, chronological. Filtered by the parent. */
  events: BunkerEvent[];
  stepIndex: number;
  onSeek: (step: number) => void;
}

/**
 * Every stem this vessel takes in the window, relative to the scrubbed moment.
 *
 * Stems after that moment are dimmed rather than hidden — the same past/now/
 * future treatment BunkerLog gives its rows, so the two read consistently. It
 * also keeps the section from being empty at step 0, which is where the
 * scrubber starts.
 */
export default function VesselStems({ events, stepIndex, onSeek }: Props) {
  if (events.length === 0) {
    return (
      <p className="px-4 text-[11px] leading-relaxed text-faint">
        This vessel takes no bunkers in the window. It opens at full tanks and
        the simulation never brings it down to its trigger.
      </p>
    );
  }

  const totalMt = events.reduce((sum, e) => sum + e.quantityMt, 0);
  const priced = events.filter((e) => e.valueUsd !== null).length;
  const lifted = events.reduce(
    (sum, e) => sum + (e.step <= stepIndex ? e.quantityMt : 0),
    0,
  );

  return (
    <>
      <div className="px-4 pb-2">
        <span className="tnum text-[11px] text-faint">
          {formatMt(lifted)} of {formatMt(totalMt)} MT lifted so far
        </span>
      </div>

      <ul>
        {events.map((event) => {
          const state =
            event.step === stepIndex
              ? "now"
              : event.step < stepIndex
                ? "past"
                : "future";

          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => onSeek(event.step)}
                className={`w-full px-4 py-1.5 text-left transition-colors hover:bg-surface-2 ${
                  state === "now"
                    ? "bg-accent/10"
                    : state === "future"
                      ? // Not yet happened at the scrubbed moment.
                        "opacity-40"
                      : ""
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="tnum text-[11px] text-fg">
                    {event.timestamp}
                  </span>
                  <span className="tnum text-xs text-fg">
                    {formatMt(event.quantityMt)} MT
                  </span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[10px]">
                  <span className="tnum text-faint" title={event.portName}>
                    {event.portCode} · {event.grade}
                  </span>
                  <span className="tnum">
                    {event.price ? (
                      <>
                        <span className="text-accent">
                          {formatPrice(event.price.value)}
                        </span>
                        {/* Blank, never $0 — an unpriced stem has no value,
                            and the note below counts how many that is. */}
                        {event.valueUsd !== null && (
                          <span className="text-muted">
                            {" "}
                            · $
                            {Math.round(event.valueUsd).toLocaleString("en-US")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="italic text-faint">Not assessed</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The same caveat the bunker log carries. Repeated rather than assumed:
          someone who only ever opens this panel would otherwise read these as
          the price quoted on the day of the stem. */}
      <p className="px-4 pt-2 text-[10px] leading-relaxed text-faint">
        {priced} of {events.length} priced. Figures are the latest assessment,
        not the price on the day of the stem, so value is an indication only.
        Only Singapore, Busan and Shanghai are assessed, and Shanghai carries no
        high-sulphur column.
      </p>
    </>
  );
}
