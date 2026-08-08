import Explorer from "@/components/Explorer";
import { latestDataDate } from "@/lib/prices";
import { buildPortIndex, loadPortCalls, loadServices } from "@/lib/schedules";

// CSVs are read from disk per request, so a data edit shows up on reload.
export const dynamic = "force-dynamic";

export default function Page() {
  const services = loadServices();
  const portCalls = loadPortCalls();
  const ports = buildPortIndex(portCalls);
  const asOf = latestDataDate();

  const region = services[0]
    ? `${services[0].tradeRegion} · ${services[0].subRegion}`
    : "";

  return (
    <Explorer
      services={services}
      portCalls={portCalls}
      ports={ports}
      asOf={asOf}
      region={region}
    />
  );
}
