"use client";

import { serviceColor } from "@/lib/colors";
import type { Service } from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggle: (code: string) => void;
  onSetAll: (on: boolean) => void;
  onSelectService: (code: string) => void;
  open: boolean;
  onClose: () => void;
}

export default function ServiceSidebar({
  services,
  visibleServices,
  onToggle,
  onSetAll,
  onSelectService,
  open,
  onClose,
}: Props) {
  const allOn = visibleServices.length === services.length;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 flex w-[85%] max-w-[320px] flex-col border-r border-line bg-surface shadow-2xl transition-transform duration-200 ease-out md:static md:z-auto md:w-[300px] md:max-w-none md:translate-x-0 md:shadow-none ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="label">Services</span>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => onSetAll(true)}
            disabled={allOn}
            className="rounded px-2 py-1.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50 md:px-1.5 md:py-0.5"
          >
            All
          </button>
          <span className="text-line-strong">/</span>
          <button
            type="button"
            onClick={() => onSetAll(false)}
            disabled={visibleServices.length === 0}
            className="rounded px-2 py-1.5 text-muted transition-colors hover:text-fg disabled:cursor-default disabled:text-faint/50 md:px-1.5 md:py-0.5"
          >
            None
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close services menu"
            className="-mr-1 ml-1 flex size-8 items-center justify-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-fg md:hidden"
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {services.map((service) => {
          const on = visibleServices.includes(service.code);
          const color = serviceColor(service.code);
          return (
            <div
              key={service.code}
              className="group flex w-full items-start gap-3 border-b border-line/60 px-4 py-3 transition-colors hover:bg-surface-2"
            >
              <button
                type="button"
                onClick={() => onToggle(service.code)}
                className="min-w-0 flex-1 text-left"
                aria-pressed={on}
                aria-label={`${on ? "Hide" : "Show"} ${service.code} on map`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span
                      aria-hidden
                      className="block size-2.5 shrink-0 rounded-[3px] border transition-colors"
                      style={{
                        borderColor: on ? color : "var(--color-line-strong)",
                        background: on ? color : "transparent",
                      }}
                    />
                    <span
                      className="tnum text-[13px] font-semibold tracking-wide transition-colors"
                      style={{ color: on ? color : "var(--color-faint)" }}
                    >
                      {service.code}
                    </span>
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
              </button>
              <button
                type="button"
                onClick={() => onSelectService(service.code)}
                aria-label={`View ${service.code} route details`}
                className="-m-1.5 mt-[1.5px] shrink-0 rounded p-1.5 text-faint transition-colors hover:bg-surface hover:text-fg"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path
                    d="M5 2l5 5-5 5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <p className="border-t border-line px-4 py-3 text-[10px] leading-relaxed text-faint">
        Route lines are schematic great-circle arcs between published port
        calls, not navigable sailing tracks. Arrows show direction of
        travel.
      </p>
    </aside>
  );
}
