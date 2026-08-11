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

Four datasets live there:

- `data/schedules/PIL_Intra_Asia_{Service_Master,Port_Calls,Transit_Times}.csv` — service metadata, ordered port rotations, and published port-pair transit times.
- `data/pricing/*.csv` — wide sheets, one `Date` column plus one column per port-and-grade.
- `data/vessels/*.csv` — the 109-vessel specification sheet and the simulated fleet movement series.
- `data/emissions/energy_per_mt.csv` — a static energy-content reference, one row per fuel grade. See below.

### `PIL_Fleet_Live_Movement.csv` is the timeline, and it is generated

Nothing in `src/` hardcodes a start or end date. The scrubbed window is **entirely** derived from `data/vessels/PIL_Fleet_Live_Movement.csv`: `loadVesselTracks` ([src/lib/vessels.ts](src/lib/vessels.ts)) keeps only the first `Timestamp` and the row count, and every date the UI shows is index arithmetic from there against a hardcoded `STEP_HOURS = 3`. It currently runs **2026-05-05 00:00:00 → 2026-08-05 21:00:00** — 46,128 rows, 62 vessels × 744 three-hour steps.

This fleet size crosses the ~55-vessel point where shipping tracks as page props stops being a clearly reasonable trade-off (data/README.md flags this; the payload is now ~690 KB). Moving `PIL_Fleet_Live_Movement.csv` behind an API route, on the same pattern already used for pricing, is a reasonable next architectural step — treated as a conscious, deferred decision for this change rather than a silent one.

**To move the timeline, edit `WINDOW_START` and `STEPS` at the top of `scripts/gen-vessel-movement.mjs` and re-run it.** Those two constants are the whole window; rotations, phases, loop offsets and the ROB model are all derived, so the same fleet replays over the new dates. The script asserts every invariant in `data/README.md`'s "Refreshing" list before writing — including the one nothing at runtime checks, that every port in every rotation is actually visited — and is idempotent. Editing that CSV by hand instead will silently break those invariants.

### Every vessel runs three tanks, and none of it is inferred at runtime

The generator, not the app, applies the fuel rules. Three constants in `scripts/gen-vessel-movement.mjs` carry them, and each has an invariant that fails the run if the output violates it:

- `ECA_PORTS` — 22 ports across all four ECA/DECA zones the map draws (`src/lib/ecaZones.ts`): China's national port ECA and Korea's (11 ports, as before), plus the North Sea & English Channel ECA (Rotterdam, Antwerp, Hamburg, Le Havre, Southampton, Felixstowe) and the Mediterranean SOx ECA (Algeciras, Piraeus, Malta, Port Said, Valencia), added once the MGO tank was resized to cover them (see `MGO_MAX_RATIO` below). This set is **ground truth for berthed steps only**: a vessel alongside one of these ports is unconditionally on its ECA-compliance grade (MGO, or MEOH — below) from `ECA_LEAD_STEPS` (8 = 24 h) before to `ECA_TRAIL_STEPS` (1 = 3 h) after. VLSFO is 0.50% and does **not** clear this, so switching between the two residual grades would be non-compliance dressed as compliance.
- **Transit steps are decided by position, not call proximity.** A ~1-day call window undercounts real exposure: the zone polygons are drawn as generous envelopes (the Mediterranean SOx ring alone spans Gibraltar to Port Said), so a vessel can be visibly inside a shaded zone for days without being near any one call — the original bug report this fixed was vessels shown burning VLSFO/HSFO while their marker sat inside yellow. `scripts/gen-eca-zone-profile.mjs` precomputes, for every port-pair leg the fleet actually sails, the fraction-of-transit intervals during which the routed path (the same `seaRoute`/`multiPointArc` geometry `src/lib/vesselPosition.ts` renders) sits inside a zone, and writes `data/derived/eca_zone_windows.json`. `gen-vessel-movement.mjs` reads that file and ORs it into `eca[]` for transit steps, on top of the port-list window above. **Re-run `gen-eca-zone-profile.mjs` before `gen-vessel-movement.mjs`** whenever `src/lib/searoutes.ts`, `src/lib/ports.ts` or `src/lib/ecaZones.ts` change — same staleness risk a modelled price column has after a hub refresh. Consecutive ECA calls, or a long single-zone crossing, now correctly flag as one continuous stretch either way.
- `NO_HSFO_PORTS` / `NO_VLSFO_PORTS` / `NO_MGO_PORTS` — 11, 5 and 5 of the 38 route ports. The first eight of `NO_HSFO_PORTS` come straight off the Chief Engineer's availability sheet (see below); Algeciras, Piraeus and Malta were added for a different reason — no assessed HSFO column exists for any of the three, so a scrubber vessel calling there would otherwise stem HSFO with nothing to price it against. A scrubber vessel lifts VLSFO where there is no high-sulphur market; where there is no residual market **at all** — Chittagong, Mongla and Kolkata sell HSFO and distillate but no VLSFO — a non-scrubber hull stems nothing and must reach its next opportunity on what it carries. Qinzhou and Yangon are in all three: no confirmed bunker market of any kind. Assigning grade by scrubber fitting alone is the bug the first of these replaced; `data/README.md` records it. **`needFrom()` scans to the next call that can supply each tank separately** — a call selling HSFO but no distillate is not a distillate opportunity, and treating it as one is how a hull sails past the port it could not skip.
- `VLSFO_RESERVE_RATIO` / `MGO_MAX_RATIO` — scrubber vessels open 80/20 HSFO/VLSFO within `Max_ROB_MT`; the MGO tank is 0.40 × `Max_ROB_MT` and sits **outside** it, raised from 0.20 when ECA coverage extended to the North Sea/Channel and Mediterranean zones above — their merged windows exceeded the original ~4.4-day autonomy. `MGO_MAX_RATIO` is duplicated as `MGO_TANK_RATIO` in `src/lib/types.ts` because the generator cannot import from `src/` — change one, change the other. Position-based ECA detection (above) held this at 0.4 rather than raising it further — the real fix there was the MGO stem lift (below), not the tank ratio.

**The MGO stem lifts up to the full published `Bunker_Quantity_MT`, capped by tank room** — the same formula the residual stem uses, no separate ratio. It used to cap each lift at a fifth of the published quantity (`MGO_STEM_RATIO`), which was fine when a ~1-day call window bounded total MGO need; position-based detection broke that assumption on the Europe/Mediterranean strings — MEDI's KOTA PUSAKA burns roughly 2,460 MT of MGO across its 42-day Algeciras-Le Havre-Antwerp-Rotterdam-Hamburg-Valencia chain, and a fifth of a 600 MT call could never keep pace regardless of `MGO_MAX_RATIO`. Every stop on that chain publishes a quantity anyway, so lifting the full amount (capped by tank room) is the direct fix.

**Three alternative ECA-compliance grades, on 30 of the 62 vessels.** Anything that isn't VLSFO/HSFO clears the 0.10% cap — the fleet models three alternatives besides MGO, generalized behind a `COMPLIANCE_FUEL` registry (vessel name → grade) in `scripts/gen-vessel-movement.mjs` rather than a per-grade boolean. Each grade started as a 2-vessel pilot on one service, then widened in two passes — first to every other intra-Asia service whose own rotation touches that grade's supply port(s) *and* actually enters an ECA (BD1/BD2/YGS touch Singapore but never enter an ECA at all, so a compliance tank there would be permanently full and never stemmed — tried, then swapped for a functional service once the flat ROB column made that obvious), then onto several Asia-Europe services too:

- `METHANOL_VESSELS` (`KOTA SEGAR`/`KOTA SEJARAH` — KCI's original pair — plus `ASTERIOS` on CVI) carry a MEOH tank. Ningbo (CNNGB) is the only port in this dataset with a priced methanol market, and it's the *only* MEOH supply port anywhere — an Asia-Europe candidate (`KOTA LEKAS`/EUROMED) has just one fill per loop to cover the whole round trip and failed `checkInvariants` even at the ratio buffer below, so MEOH stayed intra-Asia-only at 3 vessels.
- `LNG_VESSELS` (23 vessels) carry an LNG tank. LNG is priced at 5 ports (Singapore, Ningbo, Shanghai, Port Klang, Ho Chi Minh). 16 are intra-Asia: the CVI pilot (`KOTA NAGA`/`KOTA NALURI`) plus every other vessel on CVI, KCS, KCI, NCI, VCS and CCS whose rotation touches an LNG port and a real ECA window. 7 are Asia-Europe, once the ratio buffer covered their Europe-side exposure: `KOTA EBONY` (AE1), `KOTA ELAN` (AE2), `KOTA PLUMBAGO` (AE3), `KOTA PELANGI`/`KOTA PURI` (AE5, both), `KOTA LEMBAH`/`KOTA LAMBAI` (EUROMED, both).
- `B40_VESSELS` (`KOTA SAHABAT`/`KOTA SALAM` — NCI's own already-documented "deployment-derived, not PIL-published" pair — plus `KOTA SEMPENA` on the same NCI loop and `KOTA SINGA` on KCI) carry a B40 biofuel tank (60% MGO / 40% FAME). B40 is priced only at Jakarta and Surabaya, and no Europe-touching service calls either, so B40 stayed intra-Asia-only at 4 vessels. B24 (76% VLSFO / 24% FAME) is deliberately **not** modelled as a burned grade — it sits in VLSFO's ~0.5%S bracket, so it isn't ECA-compliant, and fitting it into the residual tank would mean redesigning the HSFO/VLSFO exclusive choice into a three-way one.

**Asia-Europe MEOH/LNG vessels needed a bigger tank, not just a qualifying port.** Every alternative-fuel supply port sits in Asia, and the compliance tank only draws down inside an ECA window — fine on an intra-Asia loop, wrong on an Asia-Europe one, where the vessel fills once in Asia and must then survive the entire Europe-side ECA exposure (North Sea/Channel, sometimes Mediterranean) with zero resupply chance, unlike an MGO-tanked vessel which can buy MGO at almost any European port along the way. `MEOH_MAX_RATIO`/`LNG_MAX_RATIO` carry a **×2.3 buffer** on top of their base energy-density figure to cover this, raised empirically against `checkInvariants` in steps (2x → 2.1x → 2.3x) — the same way `MGO_MAX_RATIO` itself went 0.2→0.4 for the same class of window. The failure margin did **not** shrink monotonically with the ratio: a bigger tank can make the trigger logic decide *not* to top up at the last safe port before the long Europe stretch, since the tank looks comfortably full against a proportionally bigger floor. Even at ×2.3, three LNG candidates and the one MEOH candidate tried still failed and stayed on MGO: `KOTA OCEAN` (AE6), `KOTA SYDNEY` (AE4, whose only near-qualifying port, Shanghai, is touched once per 70-day loop), `KOTA PUSAKA` (MEDI, Singapore only at the loop's start/end), and `KOTA LEKAS` (EUROMED, MEOH).

Each tank ratio (`MEOH_MAX_RATIO`/`LNG_MAX_RATIO`/`B40_MAX_RATIO`, mirrored as `MEOH_TANK_RATIO`/`LNG_TANK_RATIO`/`B40_TANK_RATIO` in `src/lib/types.ts`) starts from `MGO_MAX_RATIO × (42.7 / grade's own GJ/mt)` (`data/emissions/energy_per_mt.csv`) — smaller than MGO's for a denser fuel (LNG, 48.0 GJ/mt), larger for a less dense one (MEOH 19.9, B40 40.6) — for the same days of ECA-window autonomy, with MEOH/LNG's further ×2.3 buffer on top. B40 never needed the buffer — it stayed intra-Asia-only. A vessel carries exactly one compliance grade, never more than one — the three columns it doesn't carry read a flat `"0"` throughout, the same convention `HSFO_ROB_MT` already uses on a non-scrubber hull. Client-side, `VesselTrack.complianceGrade: VesselGrade` replaces the old `methanolFueled: boolean` — a two-way boolean stopped scaling once a third and fourth grade existed.

`Active_Fuel` (column 9) names the burning grade per row. **Read it; do not infer it** — a tank standing still is indistinguishable from a tank not being burned, and the compliance tank is flat all window for the vessels on ECA-free rotations (BD1, BD2, CAS, YGS). `activeGradeAt` in `src/lib/vesselPosition.ts` is the only decoder; client-side, the packed `activeGrades` char is `H`/`V`/`M`/`E`/`N`/`B` (HSFO/VLSFO/MGO/MEOH/LNG/B40) — not the string's first letter, since `"MGO"` and `"MEOH"` collide there.

**The bunker log resolves a stem's display grade through `stemDisplayGrade()`** (`src/lib/bunkerEvents.ts`), not by reading `event.grade` directly — `BunkerLog.tsx`/`VesselStems.tsx` both call it. This predates the LSMGO/MGO merge above, when the two were still separate priced products; now that `priceSeriesFor()` is an identity mapping the distinction is moot, but the indirection stays as the correct place a future grade split would go. `Active_Fuel` and the packed char encoding are unaffected — the tank itself is still `"MGO"`.

Twelve of the 27 Asia-Europe vessels (deployed on AE1, AE2, AE3 and AE5) carry `Max_ROB_MT`/`Min_ROB_MT`/`Bunkering_Trigger_MT` raised above the fleet-standard 3%/1%-of-DWT ratio, documented per-vessel in `PIL_Fleet_Vessel_Specifications.csv` `Data_Notes`. Every vessel in this fleet has an *identical* unrefuelled residual-tank range regardless of size — `Max_ROB_MT`, `Min_ROB_MT` and `Consumption_Transit_MT_Per_Day` are all fixed percentages of `DWT_MT`, so the ratios cancel to a flat ~22.2 days for any ship — and those four services each have a single leg (23-26 days, no intermediate call) that no vessel at the standard ratio can sail without bunkering mid-ocean. This is a real, checkable constraint, not a modelling gap: if you resize a vessel on one of these four services, re-derive against its longest `Transit_To_Next_Days` gap.

Two more vessels carry the same kind of override for a different reason: `KOTA MANZANILLO` and `KOTA SANTOS` (AE7, both scrubber-fitted) had their `Max_ROB_MT`/`Bunkering_Trigger_MT` raised once consumption became energy- rather than mass-based (below) — their Nhava Sheva-Karachi return leg has no intermediate stem, and a scrubber hull burning HSFO the whole way draws down its residual tank faster in mass terms than the fleet-standard rate, which is calibrated off VLSFO. `Min_ROB_MT` is untouched, same as the AE1/2/3/5 precedent.

Auxiliary and port-generator consumption is **not** modelled. MGO moves only where the main engine is on it.

### Consumption is energy-based, not a flat mass rate

`Consumption_Transit_MT_Per_Day` / `Consumption_Berth_MT_Per_Day` in `PIL_Fleet_Vessel_Specifications.csv` are still fixed percentages of `DWT_MT` (0.09%/0.015%), but the generator no longer burns them as a literal MT/day figure regardless of grade. Fuel grades hold different energy content (`data/emissions/energy_per_mt.csv`: HSFO 40.2 GJ/mt, VLSFO 41.7, MGO 42.7, MEOH 19.9), so a tonne of MGO does more propulsive work than a tonne of HSFO — and a tonne of methanol under half of either. The model is now `GJ/day = c × DWT_MT` — flat across the fleet, since every vessel is assumed to sail at the same speed — with `c` (`ENERGY_RATE_TRANSIT_GJ_PER_DWT_DAY` / `..._BERTH_...` in `scripts/gen-vessel-movement.mjs`) calibrated so a vessel burning VLSFO outside an ECA reproduces the old MT/day figures exactly (`0.0009 × 41.7` for transit, `0.00015 × 41.7` for berth). Mass burned per step is then energy ÷ that step's grade's own GJ/mt, drawn HSFO-first-then-VLSFO within the residual tank exactly as before, just energy-denominated across the switch.

The one thing this changes outside an ECA window: a scrubber vessel's HSFO burns slightly more mass per day than the VLSFO-calibrated baseline (40.2 vs 41.7 GJ/mt — same energy, denser fuel needed), which is what pushed `KOTA MANZANILLO`/`KOTA SANTOS` into the tank-resize above. Inside an ECA window, MGO burns measurably *less* mass per day than VLSFO would for the same work (42.7 vs 41.7 GJ/mt).

The window deliberately ends on 2026-08-05, the last date in `data/pricing/*.csv`, so every bunker stem falls inside the priced period. If you move it past that date, stems again get priced off an assessment weeks older than the stem.

### UN/LOCODE is the join key, and `PORT_COORDS` is load-bearing

The two datasets are only connected by port code. [src/lib/ports.ts](src/lib/ports.ts) holds `PORT_COORDS`, a hand-authored table that is **the only place port geometry exists** — no CSV carries lat/lon.

The critical failure mode: `buildPortIndex` returns `null` for any port code missing from `PORT_COORDS` ([src/lib/schedules.ts](src/lib/schedules.ts)), and `RouteMap` skips any leg whose endpoint didn't resolve. Both fail **silently, with no error or warning** — the port and its route lines simply vanish from the map. Any new `Port_Code` value in a schedule CSV must get a `PORT_COORDS` entry in the same change.

Ports appearing in both datasets (currently Singapore, Shanghai, Busan) resolve to one marker flagged `isRoutePort` *and* `isPricePort`. The two sets are surfaced separately and never conflated.

### Pricing columns are parsed, not configured

[src/lib/prices.ts](src/lib/prices.ts) splits headers like `"LA LongBeach HSFO"` into port + grade by matching `GRADE_SUFFIXES` **longest-first** (so `MEOH VLSFOe` is not read as `VLSFO`), then resolving the prefix through `PRICE_PORT_ALIASES`. The source spells ports inconsistently and misspells several (`ROTERDAM`, `NORFORK`, `STPETERS`); every variant is aliased onto one key. Source rows are newest-first and get reversed for charting. Brent is stored under a `__BRENT` pseudo-port key in $/mt so it shares the chart's y-axis; the raw $/bbl column is deliberately ignored.

Adding a pricing port needs both an alias entry and a `PORT_COORDS` entry, or the column is dropped.

### Most price columns are modelled, and nothing marks them

Only 10 of the 45 ports this fleet stems at are assessed — Singapore, Busan, Shanghai, Rotterdam, Antwerp, Hamburg, Algeciras, Piraeus, Malta and Colombo. 28 more carry **modelled** columns: an assessed hub series plus a documented basis differential, generated from `data/pricing/bunker_basis.csv` by `scripts/gen-modelled-prices.mjs` and written into `VLSFO Prices.csv`, `HSGO Prices.csv` and `MGO Prices.csv` under the ordinary `<PORT> <GRADE>` convention.

**7 route ports carry no pricing at all** — Cai Mep, Kaohsiung, Yantian, Karachi, Hazira, Mundra, Nhava Sheva, added with the Asia-Europe services. Every prior route port had some pricing coverage (assessed or modelled); these are the first that don't. A vessel still stems its published `Bunker_Quantity_MT` there in the fleet movement simulation — that logic doesn't consult pricing at all — but `bunkerPriceSnapshot()` has nothing to resolve the stem's value against, so it renders with a null price rather than a number. This is a deliberate scope boundary, not a bug: these 7 were never in scope for the modelled-pricing pass (only the 5 Europe ports with zero coverage were), and adding real pricing for them would mean inventing a basis with no CE-sheet or assessed-market anchor at all, unlike even the softest existing modelled columns.

### The Chief Engineer's sheet is the availability authority

`TYPES OF FUEL.xlsx` (Drive, *Chief engineer input data (Operational Feasibility)*) lists, per port, the fuels actually sold. It governs **which port×grade pairs exist** across `bunker_basis.csv`, the three `NO_*_PORTS` sets and `suppliers.csv`, and it overrode contrary research previously recorded in `data/README.md` at six ports. `Market_Status` in `bunker_basis.csv` carries three states: `priced`, `no_market`, and `unpriced` (market exists, nothing here can price it). Nothing is `unpriced` today — LNG was, until its hub was reconstructed.

Two things the sheet does **not** get the last word on, both deliberate:

- **Assessed columns are never deleted.** The sheet lists only the 0.10% distillate at Busan and Shanghai, but `BUSAN MGO` and `SHANGHAI MGO` are real assessments in the source workbook. Since the LSMGO/MGO merge (see below) they are exactly what stems price off — the modelled LSMGO-labelled column that used to win at both ports was retired in favour of the assessed one.
- **Bangladesh VLSFO.** The sheet omits it at Chittagong and Mongla while PORTLAND advertises VLSFO 0.50% at all three Bangladeshi seaports. The sheet wins by decision, with the contrary source recorded in the blanked rows' `Data_Notes`.

**`LSMGO` and `MGO` are treated as one product, `MGO`.** The Chief Engineer's sheet lists them separately and splits them on the ECA line — China, Korea, Port Klang, Singapore, Surabaya and Qui Nhon sold the 0.10% distillate; Southeast Asia, India and the Bay of Bengal sold plain MGO — but both are the same 42.7 GJ/mt distillate base, and this app now prices, labels and burns them as a single grade. `priceSeriesFor(grade, portCode)` in `src/lib/bunkerEvents.ts` is consequently an identity mapping; `data/pricing/MGO Prices.csv` (renamed from `LSMGO_MGO Prices.csv`) carries one column per port. Four ports had two independently priced series before the merge and needed a resolution rule, recorded in `data/README.md`: assessed data wins over modelled, and where both sides were the same tier the value already used for stem pricing (the former LSMGO side) survived. `TANK_SERIES` is unaffected — a tank's colour was already port-independent.

Beyond the fossil grades the sheet adds four fuels, all modelled from the hubs beside them:

- **MDO** at Chittagong and Mongla — DMB, priced under this port's own MGO basis.
- **B24** at Singapore, Port Klang, Ningbo, Laem Chabang, Ho Chi Minh, and **B40** at Jakarta and Surabaya. B40 is the one biofuel figure with a posted price behind it (Pertamina, 2025-01-01 mandate change). **B24 is modelled off a modelled hub** — this dataset holds no assessed biofuel column, so the Singapore B24 series is itself VLSFO plus a published premium. It is the softest priced column in the app.
- **MEOH at Ningbo**, from the port's first supply licence in January 2026. This **reverses** the earlier finding that no unassessed port here has a methanol market — that pass predates the Jan/Apr 2026 events. The basis carries a green-certification premium the conventional hub assessment does not.
- **LNG** at Singapore, Port Klang, Shanghai, Ningbo and Ho Chi Minh. The source workbook carries no gas column, so the Singapore hub is **reconstructed** by `scripts/gen-lng-prices.mjs` from published JKM anchors in `data/pricing/lng_anchors.csv`: `(JKM + delivery premium) × 52 MMBtu/t`. **Run that script before `gen-modelled-prices.mjs`** — it writes the hub column the four modelled ports need. It is the only reconstructed series in `data/pricing/`, it is emitted at **monthly resolution** so the chart draws a staircase rather than implying daily precision, it starts at its first anchor in September 2021 with earlier dates blank, and it self-checks against a published figure no anchor is fitted to (Platts' 2024 Singapore LNG bunker average). That check earned its keep: it caught a 13.3% overshoot on the first build.

They are deliberately indistinguishable downstream. They resolve through `PRICE_PORT_ALIASES`, chart like any other series, and **flow through `bunkerPriceSnapshot()` into stem valuations** — so a stem at Chittagong is priced off Singapore plus a judgment differential and reads exactly like a quoted one. `data/README.md` is the only record of which columns are which; check it before presenting any figure as an assessment.

**Re-run `node scripts/gen-modelled-prices.mjs` after every price refresh.** Modelled columns are computed from the hub columns beside them, so updating the hubs leaves them stale, and nothing at runtime can detect it. The script is idempotent.

Working rules:

- A blank `Basis_USD_Per_MT` means *no market for that grade at that port*; `0` means *parity with the hub*. Never conflate them — `Number("")` is `0`, so check emptiness before converting.
- Blanks may only **lead** a series. An interior blank would leave a null-run that the chart's `connectNulls` draws straight across; the generator throws instead.
- Every `judgment` row must bracket its figure between two assessed spreads from this dataset, recorded in `Rationale`.
- Published spreads do **not** reproduce here: S&P's Shanghai–Singapore LSFO spread of $14/mt on 2026-04-07 is **+78.0** in `VLSFO Prices.csv`. Calibrate on the repo's own assessed spreads.
- Adding a modelled port needs three things in one change — a `PORT_HEADER` entry in the generator, a `PRICE_PORT_ALIASES` entry, and a `PORT_COORDS` entry — or the column is silently dropped.

### Every priced port is a marketplace, and the offers are invented

`data/contracts/` is read at runtime now. [src/lib/suppliers.ts](src/lib/suppliers.ts)
turns each of the 53 priced ports into a market per fuel type: the baseline, plus 3–5
suppliers quoting against it. It reaches the UI through `markets` on
`GET /api/prices/[portKey]`, rendered by
[src/components/SupplierOffers.tsx](src/components/SupplierOffers.tsx) inside the port
panel.

**Offers store a differential, not a price.** `supplier_offers.csv` carries
`Offer_Basis_USD_Per_MT`; the price is `baseline + diff`, resolved at read time off the
latest non-null point — the same rule `bunkerPriceSnapshot()` uses, but across every
grade rather than the two the fleet stems. This is the opposite trade-off to
`gen-modelled-prices.mjs`: **nothing goes stale on a price refresh and there is nothing
to re-run.** Re-run `node scripts/gen-supplier-offers.mjs` only when `suppliers.csv`
changes.

Nothing here is sourced. The PIL supplier list has no rates, no ports and no grades;
the MSA's `Price Basis` is blank. Every differential and delivery term is generated,
and at the 23 modelled ports the baseline underneath is not an assessment either — so
a Chittagong offer is Singapore, plus a judgment basis, plus an invented supplier
spread, and reads exactly like a quote. The port panel carries that caveat in copy;
keep it wherever these figures are shown.

Working rules:

- **Three suppliers per port × grade is a floor the generator asserts**, naming the
  pair when coverage falls short. Adding a supplier needs a `ports` entry, a `grades`
  entry and a re-run in one change — a LOCODE with no price series throws.
- Randomness is seeded on `Port_Code|Grade|Supplier`, so the CSV is stable and
  reviewable. Don't hand-edit it; the next run overwrites it.
- **Tier 3 (bio/sustainable) is alternative fuels only** — methanol, B24 and B40.
  Widened from methanol alone when the CE sheet brought biofuel in as a real grade;
  the reasoning is unchanged, that a certified renewable blend is not a
  like-for-like quote against a fossil grade. `MEOH_VLSFOe` / `MEOH_MGOe` get no offers
  at all: they are the same physical methanol restated in energy-equivalent terms.
- The offer differential is **not** coloured with `text-up` / `text-down`. Those mean
  price direction everywhere else; here the lower number is the better buy, so
  colouring by sign inverts the scale two panels apart. An accent `BEST` chip on the
  cheapest quote carries the judgment instead.
- The script duplicates `PRICE_PORT_ALIASES` and the grade suffixes because `.mjs`
  can't import the TS source. An unknown column prefix throws rather than being
  skipped — silently dropping one there would drop a whole marketplace.

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

### `data/emissions/energy_per_mt.csv` is a static reference, and nothing reads it

Unlike every other CSV under `data/`, this one has no generator script and no runtime
consumer — no page, API route, or `src/lib` module parses it. It's a hand-researched
lookup of lower calorific value (LCV/NCV), in GJ/mt (numerically the same as MJ/kg),
for every fossil, biofuel and alternative grade the app tracks: `HSFO`, `VLSFO`,
`MGO`, `MDO`, `LNG`, `MEOH`, `B24`, `B40`, plus a reference-only `FAME_B100`
row that the B24/B40 blend figures are calculated from (76/24 and 60/40 splits against
VLSFO and MGO respectively). Primary source is IMO Resolution MEPC.364(79)'s LCV table;
VLSFO uses an Integr8/Ship & Bunker ISO 8217 assessed average instead, since the IMO
table doesn't itemize VLSFO separately from HFO.

`MEOH_VLSFOe` and `MEOH_MGOe` — the two energy-equivalent price restatements used
elsewhere in the pricing/supplier code (see "Every priced port is a marketplace"
above) — deliberately get no row of their own here: they're the same physical
methanol as `MEOH`, not distinct fuels, and the file's `Notes` column says so on the
`MEOH` row rather than duplicating it. If this file is ever wired into `src/` (e.g. to
compute $/GJ instead of $/mt), resolve those two grades to the `MEOH` row rather than
adding new ones.

`data/emissions/CO2_per_mt.csv` is the same kind of static, unconsumed reference —
tank-to-wake CO2 and CO2e (t/t) per grade, IMO Cf plus a flat EU MRV/FuelEU +0.049 t/t
CH4+N2O uplift.

### `data/emissions/co2e_cost_per_mt.csv` is generated, but still has no runtime consumer

`scripts/gen-co2e-cost.mjs` multiplies a EUA (EU Allowance — the traded EU ETS carbon
permit) price by each grade's `CO2e_TtW_MT_Per_MT` from `CO2_per_mt.csv`, at daily
resolution across the fleet's own window (2026-05-05 → 2026-08-05, borrowed from
`VLSFO Prices.csv`'s `Date` column). The EUA prices in `data/emissions/eua_carbon_price_anchors.csv`
are real published figures, linearly interpolated between anchors that bracket the
window — not a reconstruction like the LNG hub in `data/pricing/`. EUR→USD uses a
single fixed, documented rate rather than a second anchor series.

**It is a flat, unscoped cost, not a modelled compliance liability.** Real EU ETS
shipping rules only count 100% of a voyage's emissions when both port calls are in the
EU/EEA, 50% when only one is, and 0% otherwise — nothing in this codebase classifies a
port call as EU vs non-EU, so every column here is the un-scoped, 100%-of-emissions
figure. Read it as a ceiling, not an actual liability. See `data/README.md` for the
full derivation and sourcing.

### Null discipline

`str()` and `num()` return `null` for blank cells — blanks never become `""` or `0`, and `PricePoint.value` is nullable so gaps in a series stay gaps. This is deliberate and load-bearing: a `0 MT` bunker stem or a `0`-day transit would be a factual error, not a missing value. Preserve it when adding fields.

### Schedule data conventions

- Every service's rotation ends with a **loop-closing row** that repeats the first port, flagged `Loop_Closure_Flag=1`. It is included in `Port_Call_Count` and in the rendered stop list.
- `ETA_Day_Number` / `ETD_Day_Number` are integers relative to Day 0 of the loop — **not dates**. The only real date field is `Source_Effective_Date` (`YYYY-MM-DD`) in the service master, read as an opaque string and never parsed.
- `Key_Features` packs several bullets into one cell separated by `;`.
- `Schedule_Data_Status = "Unavailable in source"` marks rows whose weekdays the source PDF didn't publish; the panels branch on this string to show an explanatory note instead of empty columns. Don't fill such rows in with derived values — provenance is tracked per row via `Source_File` and `Data_Notes`.

### Asia-Europe services (AE1-AE7, MEDI, EUROMED)

20 services now, not 11 — `Trade_Region` is `"Asia-Europe"` for these 9, not `"Intra Asia"`, and the page header logic ([src/app/page.tsx](src/app/page.tsx)) counts distinct `Trade_Region` values rather than assuming one. Sourced from the "Main - PIL Intra Asia + Europe Services" Google Drive workbook, a separate document from the two Intra Asia sources the filenames still reference (`data/schedules/PIL_Intra_Asia_*.csv` — left as-is; renaming touches enough files that it was scoped out, see `data/README.md`).

What's specific to these nine, beyond the counts already folded into the sections above:

- AE1-AE7 are deep-sea Europe mainline strings (64-96 day loops); MEDI and EUROMED are Mediterranean/Suez loops with much shorter individual legs (≤7 days) because they route through Colombo, Port Said and the Med bunkering hubs rather than jumping straight from Singapore to North Europe.
- `src/lib/searoutes.ts` gained an entire westward corridor — Arabian Sea, Gulf of Aden, Red Sea, Suez, Mediterranean, Gibraltar, Atlantic, Channel, North Sea — roughly 33 new nodes chaining off the existing `BENGAL_S` node. Ports that already had `PORT_COORDS` but no `PORT_APPROACH` (Rotterdam, Antwerp, Hamburg, Piraeus, Malta, Algeciras, Colombo) picked up an approach node here for the first time too; before this they rendered as direct arcs despite having coordinates.
- `Transit_Times.csv` was **not** extended for these 9 — the source has no independent pairwise transit matrix for them, only the adjacent-leg figures already in `Port_Calls.Transit_To_Next_Days`, matching the sparse-coverage precedent already set by YGS.
- None of the 12 new ports get `NO_HSFO_PORTS`/`NO_VLSFO_PORTS`/`NO_MGO_PORTS` entries beyond the 3 HSFO-pricing exceptions noted above — there's no Chief Engineer sheet coverage for any of them, so the generator's default (full 3-grade availability) applies. Flagged as an explicit assumption, not a finding.
