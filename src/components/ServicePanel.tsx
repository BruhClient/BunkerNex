"use client";

import { useEffect } from "react";
import { formatDays } from "@/lib/format";
import type { PortCall, Service, TransitTime } from "@/lib/types";

const UNAVAILABLE = "Unavailable in source";

interface Props {
  service: Service | null;
  portCalls: PortCall[];
  transitTimes: TransitTime[];
  onClose: () => void;
}

export default function ServicePanel({
  service,
  portCalls,
  transitTimes,
  onClose,
}: Props) {
  const serviceCode = service?.code ?? null;

  // Esc closes the panel, mirroring PortPanel's Esc handling.
  useEffect(() => {
    if (!serviceCode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [serviceCode, onClose]);

  if (!service) return null;

  // Full ordered stop list for this service (loop-closing duplicate
  // included). Inlined rather than imported from lib/schedules — that
  // module reads CSVs off disk via node:fs and can't be pulled into a
  // client component's bundle.
  const rotation = portCalls
    .filter((c) => c.serviceCode === service.code)
    .sort((a, b) => a.sequenceNo - b.sequenceNo);
  const legs = transitTimes.filter((t) => t.serviceCode === service.code);

  // Transit_Times.csv is already grouped by direction then origin per
  // service, so preserving arrival order here is enough — no re-sorting.
  const byDirection = new Map<string, TransitTime[]>();
  for (const leg of legs) {
    const list = byDirection.get(leg.direction) ?? [];
    list.push(leg);
    byDirection.set(leg.direction, list);
  }

  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-2xl xl:static xl:z-auto xl:shadow-none"
      aria-label={`${service.name} detail`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold leading-tight text-fg">
            {service.code}{" "}
            <span className="font-normal text-muted">· {service.name}</span>
          </h2>
          <p className="tnum mt-0.5 text-[11px] text-faint">
            {service.uniquePortCount} ports · {service.frequency}
          </p>
          {service.keyFeatures.length > 0 && (
            <ul className="mt-2 space-y-1">
              {service.keyFeatures.map((feature) => (
                <li
                  key={feature}
                  className="text-[11px] leading-relaxed text-muted"
                >
                  {feature}
                </li>
              ))}
            </ul>
          )}
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
        <section>
          <div className="px-4 pb-1 pt-3.5">
            <span className="label">Route · visiting order</span>
          </div>
          <div className="divide-y divide-line/60">
            {rotation.map((call, i) => {
              const published = call.scheduleDataStatus !== UNAVAILABLE;
              return (
                <div key={`${call.sequenceNo}-${i}`} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="tnum shrink-0 text-[11px] text-faint">
                        {i + 1}.
                      </span>
                      <span className="truncate text-[13px] font-medium text-fg">
                        {call.portName}
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {call.country}
                      </span>
                    </span>
                    {call.loopClosure && (
                      <span className="shrink-0 text-[10px] text-faint">
                        loop close
                      </span>
                    )}
                  </div>

                  {published ? (
                    <dl className="mt-2 grid grid-cols-4 gap-2">
                      <Cell label="Arr" value={short(call.arrivalWeekday)} />
                      <Cell label="Dep" value={short(call.departureWeekday)} />
                      <Cell label="Dwell" value={formatDays(call.dwellDays)} />
                      <Cell
                        label="To next"
                        value={formatDays(call.transitToNextDays)}
                      />
                    </dl>
                  ) : (
                    <p className="mt-2 text-[11px] italic text-faint">
                      Arrival and departure weekdays not published in the
                      source schedule.
                    </p>
                  )}

                  {/* Sits outside the weekday guard: BD2 has stem figures even
                      though its arrival days are unpublished. Loop-closing
                      calls have no stem and render nothing at all. */}
                  {call.bunkerQuantityMt !== null && (
                    <p className="mt-2 text-[11px] text-muted">
                      Bunker{" "}
                      <span className="tnum text-fg">
                        {call.bunkerQuantityMt} MT
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-2 border-t border-line">
          <div className="px-4 pb-1 pt-3.5">
            <span className="label">Transit times</span>
          </div>

          {legs.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-faint">
              Not published for this service.
            </p>
          ) : (
            [...byDirection.entries()].map(([direction, rows]) => (
              <div key={direction} className="px-4 pb-3">
                <p className="label pb-1.5 pt-1">{direction}</p>
                <div className="space-y-1.5">
                  {rows.map((leg) => (
                    <div
                      key={`${leg.originPortCode}-${leg.destinationPortCode}`}
                      className="flex items-center justify-between gap-3 text-[12px]"
                    >
                      <span className="min-w-0 truncate text-muted">
                        {leg.originPort} → {leg.destinationPort}
                      </span>
                      <span className="tnum shrink-0 text-fg">
                        {formatDays(leg.transitDays)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </aside>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="tnum mt-0.5 text-[12px] text-fg">{value}</dd>
    </div>
  );
}

/** "Saturday" -> "Sat", so four columns fit without wrapping. */
function short(weekday: string | null): string {
  return weekday ? weekday.slice(0, 3) : "—";
}
