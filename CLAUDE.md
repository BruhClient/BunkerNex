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

Three datasets live there:

- `data/schedules/PIL_Intra_Asia_{Service_Master,Port_Calls,Transit_Times}.csv` — service metadata, ordered port rotations, and published port-pair transit times.
- `data/pricing/*.csv` — wide sheets, one `Date` column plus one column per port-and-grade.
- `data/vessels/*.csv` — the 109-vessel specification sheet and the simulated fleet movement series.

### `PIL_Fleet_Live_Movement.csv` is the timeline, and it is generated

Nothing in `src/` hardcodes a start or end date. The scrubbed window is **entirely** derived from `data/vessels/PIL_Fleet_Live_Movement.csv`: `loadVesselTracks` ([src/lib/vessels.ts](src/lib/vessels.ts)) keeps only the first `Timestamp` and the row count, and every date the UI shows is index arithmetic from there against a hardcoded `STEP_HOURS = 3`. It currently runs **2026-05-05 00:00:00 → 2026-08-05 21:00:00** — 26,040 rows, 35 vessels × 744 three-hour steps.

**To move the timeline, edit `WINDOW_START` and `STEPS` at the top of `scripts/gen-vessel-movement.mjs` and re-run it.** Those two constants are the whole window; rotations, phases, loop offsets and the ROB model are all derived, so the same fleet replays over the new dates. The script asserts every invariant in `data/README.md`'s "Refreshing" list before writing — including the one nothing at runtime checks, that every port in every rotation is actually visited — and is idempotent. Editing that CSV by hand instead will silently break those invariants.

The window deliberately ends on 2026-08-05, the last date in `data/pricing/*.csv`, so every bunker stem falls inside the priced period. If you move it past that date, stems again get priced off an assessment weeks older than the stem.

### UN/LOCODE is the join key, and `PORT_COORDS` is load-bearing

The two datasets are only connected by port code. [src/lib/ports.ts](src/lib/ports.ts) holds `PORT_COORDS`, a hand-authored table that is **the only place port geometry exists** — no CSV carries lat/lon.

The critical failure mode: `buildPortIndex` returns `null` for any port code missing from `PORT_COORDS` ([src/lib/schedules.ts](src/lib/schedules.ts)), and `RouteMap` skips any leg whose endpoint didn't resolve. Both fail **silently, with no error or warning** — the port and its route lines simply vanish from the map. Any new `Port_Code` value in a schedule CSV must get a `PORT_COORDS` entry in the same change.

Ports appearing in both datasets (currently Singapore, Shanghai, Busan) resolve to one marker flagged `isRoutePort` *and* `isPricePort`. The two sets are surfaced separately and never conflated.

### Pricing columns are parsed, not configured

[src/lib/prices.ts](src/lib/prices.ts) splits headers like `"LA LongBeach IFO380"` into port + grade by matching `GRADE_SUFFIXES` **longest-first** (so `MEOH VLSFOe` is not read as `VLSFO`), then resolving the prefix through `PRICE_PORT_ALIASES`. The source spells ports inconsistently and misspells several (`ROTERDAM`, `NORFORK`, `STPETERS`); every variant is aliased onto one key. Source rows are newest-first and get reversed for charting. Brent is stored under a `__BRENT` pseudo-port key in $/mt so it shares the chart's y-axis; the raw $/bbl column is deliberately ignored.

Adding a pricing port needs both an alias entry and a `PORT_COORDS` entry, or the column is dropped.

### Most price columns are modelled, and nothing marks them

Only 3 of the 26 ports this fleet stems at are assessed — Singapore, Busan and Shanghai. The other 23 carry **modelled** columns: an assessed hub series plus a documented basis differential, generated from `data/pricing/bunker_basis.csv` by `scripts/gen-modelled-prices.mjs` and written into `VLSFO Prices.csv`, `HSGO Prices.csv` and `LSMGO_MGO Prices.csv` under the ordinary `<PORT> <GRADE>` convention.

`MGO` follows the same hub table as VLSFO and was added for chart completeness only — `PRICE_SERIES` in `src/lib/bunkerEvents.ts` never reads it, so it can't reach a valuation. `Methanol Prices.csv` was deliberately **not** extended: researched and found to have no bunkering market at any of the 23 ports as of August 2026 (infrastructure exists only at Singapore, Shanghai/Zhoushan and emerging Korea/India facilities, none of which are in this fleet's unassessed set) — see `data/README.md` for sources.

They are deliberately indistinguishable downstream. They resolve through `PRICE_PORT_ALIASES`, chart like any other series, and **flow through `bunkerPriceSnapshot()` into stem valuations** — so a stem at Chittagong is priced off Singapore plus a judgment differential and reads exactly like a quoted one. `data/README.md` is the only record of which columns are which; check it before presenting any figure as an assessment.

**Re-run `node scripts/gen-modelled-prices.mjs` after every price refresh.** Modelled columns are computed from the hub columns beside them, so updating the hubs leaves them stale, and nothing at runtime can detect it. The script is idempotent.

Working rules:

- A blank `Basis_USD_Per_MT` means *no market for that grade at that port*; `0` means *parity with the hub*. Never conflate them — `Number("")` is `0`, so check emptiness before converting.
- Blanks may only **lead** a series. An interior blank would leave a null-run that the chart's `connectNulls` draws straight across; the generator throws instead.
- Every `judgment` row must bracket its figure between two assessed spreads from this dataset, recorded in `Rationale`.
- Published spreads do **not** reproduce here: S&P's Shanghai–Singapore LSFO spread of $14/mt on 2026-04-07 is **+78.0** in `VLSFO Prices.csv`. Calibrate on the repo's own assessed spreads.
- Adding a modelled port needs three things in one change — a `PORT_HEADER` entry in the generator, a `PRICE_PORT_ALIASES` entry, and a `PORT_COORDS` entry — or the column is silently dropped.

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
