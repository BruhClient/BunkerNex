import { NextResponse } from "next/server";
import { getBrentSeries, getPortPrices } from "@/lib/prices";

/**
 * Series for one port only. The full pricing set is ~700 KB of CSV; shipping
 * just the selected port keeps the client payload small.
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
  });
}
