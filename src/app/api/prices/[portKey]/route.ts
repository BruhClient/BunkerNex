import { NextResponse } from "next/server";
import { getBrentSeries, getPortPrices } from "@/lib/prices";
import { getPortMarkets } from "@/lib/suppliers";

/**
 * Everything the port panel needs, for one port only. The full pricing set is
 * ~700 KB of CSV; shipping just the selected port keeps the client payload
 * small.
 *
 * The supplier markets ride along rather than taking a route of their own: a
 * panel is a dozen rows, and a second round trip would let the offers land
 * after the chart they are read against.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ portKey: string }> },
) {
  const { portKey } = await params;
  const grades = getPortPrices(portKey);

  return NextResponse.json({
    portKey,
    grades,
    // Offered as an optional overlay on every port's chart.
    brent: getBrentSeries(),
    // Empty for a port nobody quotes, matching how `grades` returns {}.
    markets: getPortMarkets(portKey),
  });
}
