"use client";

import type { ReactNode } from "react";
import { serviceColor } from "@/lib/colors";
import type { Service } from "@/lib/types";

interface Props {
  services: Service[];
  visibleServices: string[];
  onToggle: (code: string) => void;
  onSetAll: (on: boolean) => void;
  onSelectService: (code: string) => void;
  /** Brings one service forward on the map; `null` restores equal weight. */
  onHoverService: (code: string | null) => void;
  /** Service code → vessels the movement series follows. Missing means none. */
  trackedVessels: Map<string, number>;
  open: boolean;
  onClose: () => void;
}

export default function ServiceSidebar({
  services,
  visibleServices,
  onToggle,
  onSetAll,
  onSelectService,
  onHoverService,
  trackedVessels,
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
          const vessels = trackedVessels.get(service.code) ?? 0;
          return (
            <div
              key={service.code}
              // Focus follows the pointer and the keyboard alike, so tabbing
              // through the list highlights the same route hovering does.
              onMouseEnter={() => onHoverService(service.code)}
              onMouseLeave={() => onHoverService(null)}
              onFocus={() => onHoverService(service.code)}
              onBlur={() => onHoverService(null)}
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
                    {/* The same hull drawn on the map, so the count reads as
                        "these markers" rather than as an abstract number. */}
                    <span
                      className={`flex shrink-0 items-center gap-0.5 transition-colors ${
                        !on
                          ? "text-faint/50"
                          : vessels > 0
                            ? "text-muted"
                            : "text-faint/60"
                      }`}
                      title={
                        vessels === 0
                          ? `No vessels tracked on ${service.code}`
                          : `${vessels} vessel${
                              vessels === 1 ? "" : "s"
                            } tracked on ${service.code}`
                      }
                    >
                      <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden>
                        <path
                          d="M8 1 C9.7 3 11 4.7 11 6.3 L11 13 L5 13 L5 6.3 C5 4.7 6.3 3 8 1 Z"
                          fill="currentColor"
                        />
                      </svg>
                      <span className="tnum text-[10px] leading-none">
                        {vessels}
                      </span>
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

      <div className="border-t border-line px-4 py-3">
        <span className="label">Map key</span>
        <dl className="mt-2 grid grid-cols-[18px_1fr] items-center gap-x-2.5 gap-y-1.5 text-[10px] text-faint">
          <LegendKey label="Route port">
            <span className="size-2.5 rounded-full bg-white ring-1 ring-fg/50" />
          </LegendKey>
          <LegendKey label="Bunker price port">
            <span className="size-2 rotate-45 border-2 border-muted" />
          </LegendKey>
          <LegendKey label="Route + price port">
            <span className="size-2.5 rounded-full bg-accent ring-2 ring-accent/60" />
          </LegendKey>
          <LegendKey label="Vessel, points to heading">
            {/* The same hull RouteMap draws, at the same orientation. */}
            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
              <path
                d="M8 1 C9.7 3 11 4.7 11 6.3 L11 13 L5 13 L5 6.3 C5 4.7 6.3 3 8 1 Z"
                fill="var(--color-fg)"
              />
            </svg>
          </LegendKey>
          <LegendKey label="Direction — selected service">
            <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden>
              <path d="M0 4h18" stroke="var(--color-muted)" strokeWidth="1.5" />
              <path
                d="M7 1.5 L10 4 L7 6.5"
                fill="none"
                stroke="var(--color-fg)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </LegendKey>
        </dl>
        <p className="mt-2.5 text-[10px] leading-relaxed text-faint">
          Schematic sea lanes between published calls — not navigable tracks.
        </p>
      </div>
    </aside>
  );
}

/** One row of the map key: swatch in a fixed-width column, label beside it. */
function LegendKey({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="flex h-3.5 items-center justify-center" aria-hidden>
        {children}
      </dt>
      <dd className="leading-snug">{label}</dd>
    </>
  );
}
