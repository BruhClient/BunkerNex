"use client";

import { useCallback, useMemo, useState } from "react";
import PortPanel from "./PortPanel";
import RouteMap from "./RouteMap";
import ServiceSidebar from "./ServiceSidebar";
import { formatDate } from "@/lib/format";
import type { Port, PortCall, Service } from "@/lib/types";

interface Props {
  services: Service[];
  portCalls: PortCall[];
  ports: Port[];
  asOf: string | null;
  region: string;
}

export default function Explorer({
  services,
  portCalls,
  ports,
  asOf,
  region,
}: Props) {
  const [visibleServices, setVisibleServices] = useState<string[]>(() =>
    services.map((s) => s.code),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const portsByKey = useMemo(
    () => new Map(ports.map((p) => [p.key, p])),
    [ports],
  );
  const selectedPort = selectedKey
    ? (portsByKey.get(selectedKey) ?? null)
    : null;

  const toggleService = useCallback((code: string) => {
    setVisibleServices((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }, []);

  const setAll = useCallback(
    (on: boolean) => setVisibleServices(on ? services.map((s) => s.code) : []),
    [services],
  );

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[15px] font-semibold tracking-tight text-fg">
            Bunker<span className="text-accent">Nex</span>
          </span>
          <span className="hidden text-xs text-muted sm:inline">{region}</span>
        </div>
        <div className="flex items-center gap-5">
          {/* Mirrors the three marker styles in globals.css. */}
          <div className="hidden items-center gap-4 text-[11px] text-faint md:flex">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-white ring-1 ring-fg/50" />
              Route port
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rotate-45 border-2 border-[#9AA6B8]" />
              Bunker price port
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-accent ring-2 ring-accent/60" />
              Both
            </span>
          </div>
          <div className="text-right">
            <div className="label leading-none">Prices as of</div>
            <div className="tnum mt-0.5 text-xs text-fg">{formatDate(asOf)}</div>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <ServiceSidebar
          services={services}
          visibleServices={visibleServices}
          onToggle={toggleService}
          onSetAll={setAll}
        />

        <main className="relative min-w-0 flex-1">
          <RouteMap
            ports={ports}
            portCalls={portCalls}
            visibleServices={visibleServices}
            selectedKey={selectedKey}
            onSelectPort={setSelectedKey}
          />
        </main>

        <PortPanel
          port={selectedPort}
          portCalls={portCalls}
          onClose={() => setSelectedKey(null)}
        />
      </div>
    </div>
  );
}
