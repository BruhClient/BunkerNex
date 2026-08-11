import { Suspense } from "react";
import HqDesk from "@/components/hq/HqDesk";
import { sortGrades } from "@/lib/colors";
import { portMeta } from "@/lib/ports";
import { BRENT_KEY, getPriceIndex, latestDataDate } from "@/lib/prices";
import { getPortMarkets } from "@/lib/suppliers";
import type { HqPortOption } from "@/components/hq/HqDesk";

// Same rule as the map page: the CSVs are read from disk per request, so a data
// edit shows up on reload. (The readCsv cache still needs a server restart.)
export const dynamic = "force-dynamic";

/**
 * The HQ bunker desk.
 *
 * A separate route rather than another panel in Explorer, for two reasons. The
 * map page's right-hand slot is capped at 420px and holds one panel at a time —
 * a five-supplier scatter and a six-line year chart are unreadable at that
 * width. And Explorer already runs the densest state machine in the app (three
 * mutually exclusive selections plus a four-phase spot sub-flow); adding a
 * fifth mode to it to host an unrelated workflow would be the riskiest possible
 * place to put this.
 *
 * This is the only other server component in the app. Same contract as
 * src/app/page.tsx: it reaches for node:fs here and passes plain data down.
 */
export default function HqPage() {
  const index = getPriceIndex();

  // Only ports that actually have a supplier panel. A port with prices but no
  // offers has nothing for this desk to evaluate, and listing it would let the
  // user select their way into a guaranteed empty state.
  const ports: HqPortOption[] = [];
  for (const portKey of index.keys()) {
    if (portKey === BRENT_KEY) continue;

    const markets = getPortMarkets(portKey);
    if (markets.length === 0) continue;

    const meta = portMeta(portKey);
    ports.push({
      key: portKey,
      name: meta?.name ?? portKey,
      country: meta?.country ?? null,
      grades: sortGrades(markets.map((m) => m.grade)),
    });
  }

  ports.sort((a, b) => a.name.localeCompare(b.name));

  return (
    // HqDesk reads its initial port/grade/supplier off the URL via
    // useSearchParams(), which requires a Suspense boundary in the app
    // router — otherwise `next build` bails the whole route to client-side
    // rendering.
    <Suspense fallback={null}>
      <HqDesk ports={ports} asOf={latestDataDate()} />
    </Suspense>
  );
}
