"use client";

import { serviceColor } from "@/lib/colors";
import { formatDays } from "@/lib/format";
import type { Port, PortCall } from "@/lib/types";

const UNAVAILABLE = "Unavailable in source";

export default function SchedulePanel({
  port,
  portCalls,
}: {
  port: Port;
  portCalls: PortCall[];
}) {
  const calls = portCalls
    .filter((c) => c.portCode === port.key)
    .sort((a, b) =>
      a.serviceCode === b.serviceCode
        ? a.sequenceNo - b.sequenceNo
        : a.serviceCode.localeCompare(b.serviceCode),
    );

  if (calls.length === 0) {
    return (
      <div className="px-4 py-5">
        <p className="text-xs text-faint">
          Not called by any service in this dataset.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-line/60">
      {calls.map((call) => {
        const color = serviceColor(call.serviceCode);
        const published = call.scheduleDataStatus !== UNAVAILABLE;

        return (
          <div
            key={`${call.serviceCode}-${call.sequenceNo}`}
            className="px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className="rounded-[2px] border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                  style={{ color, borderColor: color }}
                >
                  {call.serviceCode}
                </span>
                <span className="tnum text-[11px] text-faint">
                  call {call.sequenceNo}
                </span>
                {call.loopClosure && (
                  <span className="text-[10px] text-faint">· loop close</span>
                )}
              </div>
              <span className="text-[10px] text-muted">
                {call.directionPhase}
              </span>
            </div>

            {call.terminalName && (
              <p className="mt-1.5 text-[11px] leading-snug text-muted">
                {call.terminalName}
              </p>
            )}

            {published ? (
              <dl className="mt-2.5 grid grid-cols-4 gap-2">
                <Cell label="Arr" value={short(call.arrivalWeekday)} />
                <Cell label="Dep" value={short(call.departureWeekday)} />
                <Cell label="Dwell" value={formatDays(call.dwellDays)} />
                <Cell
                  label="To next"
                  value={formatDays(call.transitToNextDays)}
                />
              </dl>
            ) : (
              <p className="mt-2.5 text-[11px] italic text-faint">
                Arrival and departure weekdays not published in the source
                schedule.
              </p>
            )}

            {/* Outside the weekday guard — BD2 publishes stems but not days. */}
            {call.bunkerQuantityMt !== null && (
              <p className="mt-2 text-[11px] text-muted">
                Bunker{" "}
                <span className="tnum text-fg">{call.bunkerQuantityMt} MT</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
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
