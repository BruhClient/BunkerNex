# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server on :3000
npm run build    # production build (also runs the type check)
npm start        # serve the production build
npx tsc --noEmit # type check on its own
```

There is **no test runner and no linter configured** — `tsc` and `next build` are the only automated checks. Don't invent `npm test` or `npm run lint`; they don't exist.

If `next build` fails during "Collecting page data" with `Cannot find module .next/server/pages/_document.js`, the `.next` directory is stale: delete it and rebuild.

## Architecture

A single-page maritime explorer: PIL container-service schedules drawn on a MapLibre map, alongside bunker fuel price series per port.

### CSVs under `data/` are the source of truth

There is no database, no ORM, and no build step that generates data. `readCsv` ([src/lib/csv.ts](src/lib/csv.ts)) reads files off disk relative to `data/` at request time and **caches them in a module-level Map for the life of the server process**. Editing a CSV therefore requires a server restart, not just a page reload — `export const dynamic = "force-dynamic"` in [src/app/page.tsx](src/app/page.tsx) re-renders per request but does not clear that cache.

Two independent datasets live there:

- `data/schedules/PIL_Intra_Asia_{Service_Master,Port_Calls,Transit_Times}.csv` — service metadata, ordered port rotations, and published port-pair transit times.
- `data/pricing/*.csv` — wide sheets, one `Date` column plus one column per port-and-grade.

### UN/LOCODE is the join key, and `PORT_COORDS` is load-bearing

The two datasets are only connected by port code. [src/lib/ports.ts](src/lib/ports.ts) holds `PORT_COORDS`, a hand-authored table that is **the only place port geometry exists** — no CSV carries lat/lon.

The critical failure mode: `buildPortIndex` returns `null` for any port code missing from `PORT_COORDS` ([src/lib/schedules.ts](src/lib/schedules.ts)), and `RouteMap` skips any leg whose endpoint didn't resolve. Both fail **silently, with no error or warning** — the port and its route lines simply vanish from the map. Any new `Port_Code` value in a schedule CSV must get a `PORT_COORDS` entry in the same change.

Ports appearing in both datasets (currently Singapore, Shanghai, Busan) resolve to one marker flagged `isRoutePort` *and* `isPricePort`. The two sets are surfaced separately and never conflated.

### Pricing columns are parsed, not configured

[src/lib/prices.ts](src/lib/prices.ts) splits headers like `"LA LongBeach IFO380"` into port + grade by matching `GRADE_SUFFIXES` **longest-first** (so `MEOH VLSFOe` is not read as `VLSFO`), then resolving the prefix through `PRICE_PORT_ALIASES`. The source spells ports inconsistently and misspells several (`ROTERDAM`, `NORFORK`, `STPETERS`); every variant is aliased onto one key. Source rows are newest-first and get reversed for charting. Brent is stored under a `__BRENT` pseudo-port key in $/mt so it shares the chart's y-axis; the raw $/bbl column is deliberately ignored.

Adding a pricing port needs both an alias entry and a `PORT_COORDS` entry, or the column is dropped.

### Server/client boundary

`src/lib/schedules.ts` and `src/lib/prices.ts` import `node:fs` and **must never be pulled into a client bundle**. [src/app/page.tsx](src/app/page.tsx) is the only server component: it loads services, port calls, transit times and the port index, then passes them as props into the `"use client"` tree. This is why [src/components/ServicePanel.tsx](src/components/ServicePanel.tsx) re-implements a rotation sort inline rather than importing the exported `serviceRotation` helper.

Schedule data is small and ships as props. Pricing is not — the full set is ~700 KB — so charts fetch one port at a time from `GET /api/prices/[portKey]`, which returns that port's grades plus the Brent overlay.

[src/components/Explorer.tsx](src/components/Explorer.tsx) owns all interaction state (visible services, selected port, selected service, sidebar) and passes it down; the panels and map are otherwise stateless.

### Map rendering

MapLibre with CARTO Dark Matter (no API key needed). Route lines are **schematic great-circle arcs, not navigable tracks** — say so in any UI copy.

- Leg geometry comes from [src/lib/searoutes.ts](src/lib/searoutes.ts), a hand-authored sea-lane graph: `SEA_NODES` (points in navigable water), `SEA_EDGES` (node pairs whose straight segment is water end to end), and `PORT_APPROACH` (the first open water off each berth). `seaRoute` runs Dijkstra over it and `RouteMap` feeds the result to `multiPointArc`.
- **A port missing from `PORT_APPROACH` falls back to a direct great-circle arc, which may cut straight across a continent.** This is quieter than a missing `PORT_COORDS` entry — the port and its lines still render, only the geography is wrong — so a new `Port_Code` needs an entry in *both* tables.
- Layers are inserted *before* the basemap's first symbol layer so port labels win collision resolution against the style's own country labels.
- `text-font` must name a stack the style actually serves glyphs for, or MapLibre renders nothing and reports no error.
- Overlapping services are fanned apart with `line-offset` (and a matching `icon-offset` on the arrows), measured in **screen pixels**. Don't go back to displacing the geometry — bending a routed line sideways pushes it back onto land. `SERVICE_COLORS` in [src/lib/colors.ts](src/lib/colors.ts) gives each service a hue, falling back to grey for unknown codes.

### Null discipline

`str()` and `num()` return `null` for blank cells — blanks never become `""` or `0`, and `PricePoint.value` is nullable so gaps in a series stay gaps. This is deliberate and load-bearing: a `0 MT` bunker stem or a `0`-day transit would be a factual error, not a missing value. Preserve it when adding fields.

### Schedule data conventions

- Every service's rotation ends with a **loop-closing row** that repeats the first port, flagged `Loop_Closure_Flag=1`. It is included in `Port_Call_Count` and in the rendered stop list.
- `ETA_Day_Number` / `ETD_Day_Number` are integers relative to Day 0 of the loop — **not dates**. The only real date field is `Source_Effective_Date` (`YYYY-MM-DD`) in the service master, read as an opaque string and never parsed.
- `Key_Features` packs several bullets into one cell separated by `;`.
- `Schedule_Data_Status = "Unavailable in source"` marks rows whose weekdays the source PDF didn't publish; the panels branch on this string to show an explanatory note instead of empty columns. Don't fill such rows in with derived values — provenance is tracked per row via `Source_File` and `Data_Notes`.
