"use client";

import { serviceColor } from "@/lib/colors";
import type { Service } from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggle: (code: string) => void;
  onSetAll: (on: boolean) => void;
}

export default function ServiceSidebar({
  services,
  visibleServices,
  onToggle,
  onSetAll,
}: Props) {
  const allOn = visibleServices.length === services.length;

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="label">Services</span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onSetAll(true)}
            disabled={allOn}
            className="rounded px-1.5 py-0.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50"
          >
            All
          </button>
          <span className="text-line-strong">/</span>
          <button
            type="button"
            onClick={() => onSetAll(false)}
            disabled={visibleServices.length === 0}
            className="rounded px-1.5 py-0.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50"
          >
            None
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {services.map((service) => {
          const on = visibleServices.includes(service.code);
          const color = serviceColor(service.code);
          return (
            <button
              key={service.code}
              type="button"
              onClick={() => onToggle(service.code)}
              aria-pressed={on}
              className="group flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <span
                aria-hidden
                className="mt-[3px] size-3 shrink-0 rounded-[3px] border transition-colors"
                style={{
                  borderColor: on ? color : "var(--color-line-strong)",
                  background: on ? color : "transparent",
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span
                    className="tnum text-[13px] font-semibold tracking-wide transition-colors"
                    style={{ color: on ? color : "var(--color-faint)" }}
                  >
                    {service.code}
                  </span>
                  <span className="tnum shrink-0 text-[10px] text-faint">
                    {service.uniquePortCount} ports · {service.frequency}
                  </span>
                </span>
                <span
                  className={`mt-0.5 block truncate text-xs ${
                    on ? "text-fg" : "text-faint"
                  }`}
                  title={service.name}
                >
                  {service.name}
                </span>
                {on && service.keyFeatures.length > 0 && (
                  <span className="mt-1.5 block text-[11px] leading-relaxed text-muted">
                    {service.keyFeatures[0]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-faint">
        Route lines are schematic great-circle arcs between published port
        calls, not navigable sailing tracks.
      </p>
    </aside>
  );
}
