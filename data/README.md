# `data/` — sources, format, and how to refresh

Everything under `data/` is the source of truth for the app. There is no build step
and no generated JSON: [`readCsv`](../src/lib/csv.ts) reads these files from disk at
request time, so editing a CSV and restarting the dev server picks up the change.

---

## `pricing/` — bunker and Brent price series

**Source:** Ship & Bunker, extracted from `Bunker Price Index as of 6/8/26.xlsx` in the
PIL Drive case folder → *BunkerWire/Bunker Price Data (Spot Price)*.

**Extract as of 2026-08-05.** Methanol lags at 2026-08-03 (see below).

### Refreshing

The workbook is itself a download from two Ship & Bunker feeds:

| Feed | URL |
|---|---|
| 10 days | `https://shipandbunker.com/feeds/one/prices.php` |
| 1 year | `http://shipandbunker.com/feeds/one/prices_1year.php` |

Register at `https://shipandbunker.com/register`. A new account does **not** work
immediately — the workbook's cover note says to email `Richard.ho@one-line.com` to
have the account activated with the service provider.

### Files

| File | Columns | Rows | Coverage |
|---|---|---|---|
| `Brent Prices.csv` | `Brent`, `BrentPMT` | 1966 | 2019-01-02 → 2026-08-05 |
| `VLSFO Prices.csv` | 25 ports | 1973 | 2019-01-02 → 2026-08-05 |
| `HSGO Prices.csv` | 12 ports, `IFO380` | 1973 | 2019-01-02 → 2026-08-05 |
| `LSMGO_MGO Prices.csv` | 28 columns, `LSMGO`/`MGO` | 1973 | 2019-01-02 → 2026-08-05 |
| `Methanol Prices.csv` | 12 columns, `MEOH` + `VLSFOe`/`MGOe` equivalents | 188 | 2022-12-16 → 2026-08-03 |

Coverage is the *date range of the file*, not of every column. Most columns start
much later than the first row — see "sparsity" below.

### Conventions

- `Date` is `YYYY-MM-DD`. The workbook mixes `M/D/YYYY` and `YYYY-MM-DD`; normalise
  on extract.
- Rows are **newest-first**. `lib/prices.ts` reverses them for charting.
- Blank cells stay **empty**, never `0`. A blank means "not quoted that day", and
  `PricePoint.value` carries it through as `null`.
- Numbers drop trailing zeros: the workbook's `533.00` is stored as `533`.
- Column headers are `<PORT> <GRADE>`. Port spellings are the source's own and are
  inconsistent — `ROTERDAM` in three files but `ROTTERDAM` in Methanol, plus the
  misspellings `Norfork` and `STPETERS`. Do not "fix" them in the CSVs; every
  variant is mapped in `PRICE_PORT_ALIASES` in [`lib/ports.ts`](../src/lib/ports.ts).

### Things that will look like bugs but are not

- **Methanol is weekly**, not daily, and lags the other grades by two days. Its 188
  rows are not a truncated file.
- **`Brent Prices.csv` has 7 fewer rows** than the other daily files (1966 vs 1973).
  Those are dates where the workbook's Brent cell is blank; the extract omits the row
  rather than writing an empty one. Latest such date: 2024-12-26.
- **`BrentPMT` precision is mixed.** Rows from 2019-08-21 onward carry the full float
  (`454.058994255065`); the 2019-01-02 → 2019-08-20 backfill carries the workbook's
  displayed 3-decimal value (`413.472`). The workbook is the only source for that
  period. The gap is under 0.001 $/mt.
- **Sparsity is real.** Only Brent and the 16 `SINGAPORE LSMGO` … `Norfork LSMGO`
  columns span the whole file. IFO380 columns start 2019-08-21; most VLSFO columns
  start in late 2019 (Singapore 2019-07-04, Genoa not until 2020-02-13); the
  `FUJAIRAH MGO` block starts 2019-09-11. `trimNulls` in
  [`lib/series.ts`](../src/lib/series.ts) drops the leading nulls per series so charts
  begin at each column's first real quote.
- **`SANTOS IFO380` stops in 2019.** 59 values, 2019-08-21 → 2019-11-14, recovered
  from the workbook's *Analysis -Old Ship & Bunker* sheet. The current sheet dropped
  the column entirely, so Santos has no IFO380 quote after 2019.

### Deliberately excluded

`Bunker price from platts (do not use)` sits in the same Drive folder. The title is
the instruction — it is not extracted.

### Workbook layout, for the next extract

Two sheets. Use the first; the second is a historical subset.

| Sheet | Columns | Rows | Range |
|---|---|---|---|
| `Analysis Ship & Bunker` | 79 | 1973 | 2019-01-02 → 2026-08-05 |
| `Analysis -Old Ship & Bunker` | 43 | 435 | 2019-01-02 → 2020-09-09 |

The Old sheet is a strict subset except for `SANTOS IFO380`, and it names one column
`ANTWERP MGO` where the current sheet has `ANTWERP LSMGO`.

---

## `schedules/` — PIL service network

**Source:** PIL Drive case folder → *PIL Schedule data*.

| File | Grain |
|---|---|
| `PIL_Intra_Asia_Service_Master.csv` | one row per service |
| `PIL_Intra_Asia_Port_Calls.csv` | one row per call, ordered by `Sequence_No` |
| `PIL_Intra_Asia_Transit_Times.csv` | one row per origin/destination pair |

Ports join to pricing on UN/LOCODE. Some cells are quoted and contain commas, which
is why `readCsv` uses PapaParse rather than a plain split.

---

## `contracts/` — term-contract and supplier reference data

**Source:** PIL Drive case folder → *Term tender contract data (Supplier List)*
(`Bunker_Term_Contract.docx`, `SUPPLIER LIST.docx`).

**Neither document contains prices.** The contract is an unexecuted MSA template with
`[BUYER LEGAL NAME]` placeholders and a blank `Price Basis: ____` field; the supplier
list is prose with no rates and no port coverage. These files therefore support
*feasibility* modelling, not term-vs-spot price comparison.

| File | Grain |
|---|---|
| `suppliers.csv` | one row per supplier, tiered as the source groups them |
| `term_terms.csv` | one row per negotiable commercial parameter, with its clause |

**Open gap:** `suppliers.ports` is empty in every row. The source document does not
say which supplier serves which port, and guessing would be worse than a blank. Fill
it from a real supply-coverage source before using suppliers for port feasibility.

The most load-bearing value here is the guaranteed pumping rate, 400–800 MT/hour
(clause 3.3) — it feeds the `quantity ÷ pump rate` transfer-time check, and no other
file in `data/` carries a pump rate.

---

## `vessels/` — PIL fleet register

**Source:** PIL Drive case folder → *Vessel data* → **Vessel Specifications** (Google
Sheet `17SKe5NZoZoKBkFKLajvxcFKwOKQPwZivqenAze9f4aA`), a single sheet plus a footnote
block. Sheet last modified 2026-08-08; **extracted 2026-08-09**.

| File | Grain |
|---|---|
| `PIL_Fleet_Vessel_Specifications.csv` | one row per vessel (109) |
| `vessel_assumptions.csv` | one row per derived column (5) |
| `PIL_Fleet_Live_Movement.csv` | one row per vessel per 3-hour step (16,800) |

109 vessels: 101 named `KOTA *` plus ASTERIOS, LITTLE MERMAID, PACANDA, SALAM MAJU,
SC MARA, SELATAN DAMAI, ZHONG HANG SHENG and ZHU CHENG XIN ZHOU. Eleven flags,
Singapore dominant. DWT spans 8,150 (SELATAN DAMAI) to 156,620 (KOTA EAGLE and
KOTA EMERALD). IMO numbers are unique across the file.

### Five of the fourteen columns are assumptions, not measurements

The source footnote says "all cells in yellow are assumptions". Every bunker-related
column is a fixed percentage of DWT, verified to hold across all 109 rows:

| Column | % of DWT |
|---|---|
| `Max_ROB_MT` | 3.0% |
| `Min_ROB_MT` | 1.0% |
| `Consumption_Transit_MT_Per_Day` | 0.09% |
| `Consumption_Berth_MT_Per_Day` | 0.015% |
| `Bunkering_Trigger_MT` | 1.5% (= `Max_ROB_MT` ÷ 2) |

So these five carry **no vessel-specific information beyond DWT** — two ships of equal
DWT get identical figures regardless of engine, hull or service. Don't present them as
measured specs, and replace them with real noon-report or shipyard figures before any
consumption modelling is taken seriously. `vessel_assumptions.csv` holds the ratios
machine-readably so a consumer can re-derive or override them.

Two defects in the source's footnote block, both settled by arithmetic:

- It labels **two** rows "Fuel consumption per day in transit (MT)", at 0.0900% and
  0.0150%. The 0.0150% row is the **berth** rate — a mislabel. (KOTA TEMA, DWT 86,800:
  berth 13.02 = 86,800 × 0.00015.)
- It **omits the bunkering trigger**. The 1.5% ratio is derived here, not quoted from
  the source; `vessel_assumptions.csv` flags it `stated_in_source=no`.

### Conventions

- Headers follow the `schedules/` style — `Title_Case_Underscore` with unit suffixes,
  plus trailing `Source_File` / `Data_Notes` provenance columns.
- **No thousands separators.** The sheet writes `22,750`; the CSV writes `22750`.
  This is not cosmetic — `num()` in [`lib/csv.ts`](../src/lib/csv.ts) is `Number(t)`,
  and `Number("22,750")` is `NaN`, which becomes `null`. Every tonnage would silently
  vanish. Never reintroduce them.
- Trailing zeros dropped, as in `pricing/`: the sheet's `75.90` is stored as `75.9`.
- `Main_Engine_Fuel_Types` packs several values into one cell separated by `;`, the
  same convention as `Key_Features` in the service master. The source uses commas.
- `Flag` keeps the source's spelling and casing, including `HONG KONG SAR,CHINA` with
  no space after the comma (4 vessels). It is quoted so PapaParse reads it as one
  field. Don't "fix" it, per the same rule that governs the pricing port spellings.
- UTF-8 **without BOM**, `\n` line endings. Two of the three `schedules/` CSVs carry a
  stray BOM; that was not reproduced here.

### Things that will look like bugs but are not

- **`KOTA ELAN` (1081843) and `KOTA ELOK` (1081831)** have IMO numbers starting with
  `1`, unlike the `9`-prefixed rest. Both pass the IMO check-digit algorithm (83→3,
  81→1) and are valid numbers for recent builds. Not typos — each row says so in
  `Data_Notes`.
- **`PACANDA` has a blank `Nominal_TEU`.** The source says `0`, but a 12,500 DWT
  container vessel cannot carry zero boxes; that is a missing value written as a
  number. Per the null discipline it is stored blank so `num()` yields `null`. It is
  the only blank in the column.
- **Every vessel lists the identical fuel capability**, `VLSFO; HSFO; MGO` — including
  the 45 with no scrubber. HSFO on a non-scrubber vessel is not MARPOL Annex VI
  compliant absent an exemption, so read this column as "engine can burn", not "vessel
  may lawfully burn". Anything that switches fuel by port needs a compliance rule of
  its own; this column will not supply one. (64 vessels are scrubber-fitted.)

### The vessel ↔ service link lives only in the movement file, and covers 35 of 109

The specifications sheet carries no `Service_Code`, and no vessel name appears anywhere
in `schedules/`. `PIL_Fleet_Live_Movement.csv` is the only place the link exists. It now
covers **35 vessels across all 11 services**, 2–5 per service, replacing an earlier
11-vessel slice that left BD1, BD2, CAS and YGS with no vessels at all.

Three services carry PIL's **published** deployment; the rest are **derived**, and every
vessel's first movement row states which in `Data_Notes`:

| Service | Vessels | Basis |
|---|---|---|
| NCI | KOTA SEJATI, SEMPENA, SABAS, SAHABAT, SALAM | first three published for the 2025-06-17 launch; the other two are sisters standing in for the HMM and X-Press partner ships, which are not in this fleet file |
| CCS | KOTA RIA, RUKUN, RAKYAT | published for the 2024-07-02 launch — geared, sized for the Hooghly |
| KCS | KOTA GABUNG, GADANG, GANDING, GAYA | PIL publishes "four vessels of about 2,800 TEU" unnamed; the G-class is the only exact-size group of four |
| KCI | KOTA SEGAR, SEJARAH, SETIA, SINGA | derived — 3,889 TEU, the band PIL states for the comparable NCI service |
| CVI | ASTERIOS, KOTA JOHAN, NABIL, NAGA, NALURI | derived — PIL's 2,200 TEU consortium average includes RCL/Interasia tonnage absent here |
| CAS | KOTA RAJA, RATNA, RATU, RAHMAT | derived — master states four vessels; geared R-class as on CCS |
| BD1 | KOTA ANGGUN, AZAM | derived — 1,454 TEU for Chittagong's draft and LOA |
| BD2 | KOTA DAHLIA, DUNIA | derived — 628 TEU for Mongla, the shallowest port here |
| YGS | KOTA HAKIM, HALUS | derived — sisters of KOTA HAPAS, the ship PIL actually runs |
| SCT | KOTA RAJIN, RANCAK | derived — 943 TEU for Bangkok Klong Toey |
| VCS | KOTA HANDAL, HARUM | derived — 1,080 TEU feeder berths |

**The derived rows are sized by port constraint, not by trade lane or by what looks
plausible.** Draft and LOA are the binding facts: Kolkata sits up the Hooghly at roughly
7 m, Mongla is shallower still, and Bangkok Klong Toey caps near 1,200 TEU and 172 m LOA.
The earlier slice ignored this and had the 6,606 TEU KOTA CARUM calling Kolkata and
KOTA CABAR calling Bangkok — neither ship can physically reach either berth. **All six
6,606 TEU KOTA C-class ships were removed from this file for that reason**: that class
belongs on PIL's long-haul trades, not on an Intra-Asia feeder loop. If you extend the
deployment, size the ship to the tightest port in its rotation first.

Still open: 74 of 109 vessels have no service, and `suppliers.ports` in `contracts/`
remains empty.

---

## `PIL_Fleet_Live_Movement.csv` — simulated movement and ROB series

**Originally from:** same Drive folder → **Vessel Live Movement** (Google Sheet
`1qcFyBa9_51cdK_Ul6pyEi3VGzel85BEo2a1F9Rbi1C8`, formerly titled "Wip - live vessel
mvt"), sheet last modified 2026-08-08, extracted 2026-08-09. **That extract has since
been replaced** — see "Regenerated from the rotations" below. The Drive sheet is no
longer the shape of this file; only its column vocabulary survives.

One row per vessel per 3-hour step: destination port, operational phase,
remaining-on-board fuel by grade, and any bunker delivered. 16,800 rows — **35 vessels ×
exactly 480 steps**, 2026-08-01 00:00:00 → 2026-09-29 21:00:00, no gaps. This is the only
file in `data/` with a real timestamp and a fuel level that moves over time.

### It is a simulation, not telemetry — and it is generated from `vessel_assumptions.csv`

Each vessel's fuel drop per 3-hour step equals its assumed daily rate ÷ 8, to three
decimals, in both phases. The file is the assumption played forward in time, so it is a
worked example of the fuel model and **carries no independent evidence about real
voyages**. Reconciling it against actual noon reports would be circular.

### Regenerated from the rotations

The Drive extract's 11 tracks did not follow the schedules they claimed. They visited a
*subset* of each rotation and repeated the wrong loop length — ASTERIOS cycled every 22
days on a service PIL publishes as a 35-day loop, KOTA CABAR every 10 days against SCT's
14. Worse, **eight ports in `schedules/` were called by no vessel at all**: `SGSIN`,
`MYPKG`, `VNSGN`, `THLCH`, `INGAV`, `BDCGP`, `BDMGL` and `MMRGN`. Singapore is in 8 of the
11 rotations and carries the largest stems in the data, and every single track skipped it.

The file is now generated from `schedules/PIL_Intra_Asia_Port_Calls.csv`, so a vessel
visits **every** port in its rotation, in sequence, on the published loop length:

- Loop length is the loop-closing row's `ETA_Day_Number`; steps per loop = days × 8.
- A call is berthed over `[ETA_Day_Number × 8, ETD_Day_Number × 8)`. Every other step is
  transit toward the next call, labelled with **that** call's port — the file's existing
  convention that `Port_Name` is the leg destination while in transit.
- **Zero-dwell calls get one berthed step.** Several rotations publish `ETA == ETD` (CCS
  Xiamen day 0, YGS Singapore day 0). Without a minimum berth the call would have no row
  and nowhere to land its bunker stem.
- **A port change always gets at least one transit step.** SCT publishes Laem Chabang and
  Bangkok arriving the same day; without this the leg would not be drawn.
- **BD2's timetable is synthesised**, from `Transit_To_Next_Days` (5, 1, 5) plus 1-day
  dwells, giving the same 14-day loop as BD1 on the same trade. BD2's
  `Schedule_Data_Status` is `Unavailable in source` and its day-number cells are blank.
  Those blanks were **not** backfilled into the port calls CSV — the derivation lives in
  the generator only, and each BD2 vessel's first row says so in `Data_Notes`.
- Vessel *k* of *n* on a service starts at loop offset `round(k × steps_per_loop / n)`, so
  sisters are spread around the rotation instead of moving in lockstep.

Regenerating requires the vessel roster (above) and these rules; there is no script in the
repo. Re-derive it and re-check the invariants listed under "Refreshing".

### `Synthetic_Latitude` / `Synthetic_Longitude` are now blank. Never map them.

**Both columns are empty in every row**, so `num()` yields `null`. Nothing in `src/` reads
them. They are kept only so the header still matches the source's column vocabulary.

They are blank rather than carried forward because the source's values were fictional
*and* the rows are now re-timed, which would have paired invented coordinates with new
timestamps for no benefit. For the record, here is what the original extract contained —
the columns were renamed from the source's plain `Latitude`/`Longitude` precisely because
every berth position sat thousands of km from the port named in the same row:

| Row says | Position given | Actual port | Off by |
|---|---|---|---|
| Qingdao | 3.92°N 150.04°E | 36.07°N 120.38°E | ~4,450 km |
| Shanghai | 11.80°N 161.60°E | 31.23°N 121.47°E | ~4,380 km |
| Busan | 9.17°S 85.71°E | 35.10°N 129.04°E | ~6,300 km |
| Surabaya | 12.42°N 175.46°W | 7.20°S 112.73°E | ~31,800 km |

All 5,280 of those points lay in a narrow equatorial band (lat −9.2 to +13.5) with
longitude covering the whole globe including the antimeridian. Fed to `RouteMap` they
would have scattered the fleet across open Pacific, unrelated to the arcs drawn from
`PORT_COORDS`. **Use `Port_Code` → `PORT_COORDS` for anything geographic**, and if a
future refresh reintroduces coordinates, verify them against the port before mapping.

### The bunkering trigger is now enforced — it used to be ignored

The Drive extract broke its own safety limits. Every vessel spent much of the window below
`Min_ROB_MT`, only 26 bunker events occurred across 60 days, and **KOTA CANTIK and
KOTA DUNIA reached exactly 0 MT** — not a survivable state. Anything treating those curves
as feasible operations was optimising an impossible schedule.

The regenerated file enforces the rule the source omitted:

- ROB opens at `Max_ROB_MT` and burns `Consumption_Transit_MT_Per_Day ÷ 8` per transit step
  and `Consumption_Berth_MT_Per_Day ÷ 8` per berthed step, to three decimals — the
  consumption model is unchanged, and still comes from `vessel_assumptions.csv`.
- At the first berthed step of a call carrying a `Bunker_Quantity_MT`, a stem is lifted if
  ROB has fallen to `Bunkering_Trigger_MT` **or** if ROB minus the fuel needed to reach the
  next stem opportunity would fall below `Min_ROB_MT`. The second clause is the
  safety-critical one: it stops a vessel sailing past a bunker port it cannot skip.
- The stem is `min(Bunker_Quantity_MT, Max_ROB_MT − ROB)`, so a call's published quantity is
  never exceeded and the tank never overfills. Where capacity cuts the stem short, the row
  says so in `Data_Notes`.
- **Invariant, verified over all 16,800 rows: `Min_ROB_MT ≤ ROB ≤ Max_ROB_MT`.** ROB never
  reaches 0. 86 stems now occur across the fleet's 60 days, up from 26.

The ROB curves are still a model, not measurements — the consumption rates are a flat
percentage of DWT, so this remains a worked example. What changed is that it is now a
*feasible* one. If you regenerate, re-assert the invariant: a vessel whose `Max_ROB_MT`
cannot cover its longest inter-stem leg is the wrong ship for the service, and the fix is
the deployment, not a clamp.

### Fuel grade does follow scrubber status

Scrubber-fitted vessels burn HSFO (`VLSFO_ROB_MT` flat at 0); non-scrubber vessels burn
VLSFO (`HSFO_ROB_MT` flat at 0). Exact across all 35. This is the MARPOL Annex VI rule
that the specifications sheet does *not* encode — that sheet lists `VLSFO; HSFO; MGO`
for every vessel regardless of scrubber. Where the two disagree, this file is the more
careful one.

`MGO_ROB_MT` is constant per vessel: MGO is never burned and never stemmed. It is a
static number, not a series.

**It is blank for the 30 vessels the Drive extract did not cover.** The source's figure has
no derivable basis — across its 11 vessels it ranges from 0.13 to 0.72 of `Min_ROB_MT`, so
it is neither a ratio of DWT nor of any other column, unlike the five assumption columns in
the specifications sheet. There is nothing to extrapolate, so per the null discipline it
stays empty rather than invented. The five carried-over vessels (ASTERIOS, KOTA ANGGUN,
KOTA AZAM, KOTA DAHLIA, KOTA DUNIA) keep their real source values. `VesselPanel` hides the
"MGO remaining" row when it is null.

### Conventions

- **`Port_Code` and `Port_Name` both come from `PIL_Intra_Asia_Port_Calls.csv`**, copied as
  a pair so the name↔LOCODE mapping cannot drift. (The Drive sheet's column was titled
  "Port / Location Code" but held port *names* — `Qingdao`, not `CNTAO` — and the LOCODE was
  resolved from the port calls file, never invented. Same source, now for both columns.)
  All 26 distinct ports exist in `PORT_COORDS`, and all 26 in `PORT_APPROACH` too, so every
  leg routes through the sea-lane graph rather than falling back to a continent-crossing
  great-circle arc.
- **`Port_Name` is the leg *destination*, not the current location.** While
  `Operational_Phase` is `Transit` it names the port being sailed to; it only means
  "where the ship is" once the phase is `Berthed`. The source's "Location" wording is
  misleading.
- **`Berthed` and `Transit` columns were dropped.** Both were fully derivable from
  `Operational_Phase`, with zero disagreements across all 5,280 rows of the Drive extract.
- **`Timestamp` is `YYYY-MM-DD HH:MM:SS` with no timezone.** The source states none;
  it is read as an opaque sortable string, like `Source_Effective_Date` in the service
  master. Don't append `Z` or an offset — that would assert a fact the source lacks.
- Renamed `Bunker Complete (MT)` → `*_Bunkered_MT`: the value is a delivered quantity,
  and "complete" reads like a status flag.
- Rows are in source order — vessel, then time **ascending**. Unlike `pricing/`, this
  file is not newest-first and needs no reversal.

### Zeros here are real — unlike PACANDA's blank TEU

This file's `0`s are kept as `0`, which is the opposite call from the specifications
file, deliberately. `VLSFO_ROB_MT = 0` on a scrubber vessel is a true measurement (it
carries no VLSFO), and `HSFO_Bunkered_MT = 0` truly means no stem was delivered in that
interval. Neither is a missing value dressed up as a number, so the null-discipline rule
does not apply. Don't "clean" them into blanks.

### Refreshing

This file is no longer a transform of the Drive sheet, so re-exporting that sheet will not
refresh it. Regenerate it from `schedules/PIL_Intra_Asia_Port_Calls.csv` using the roster
and the timetable/ROB rules above, then assert all of the following before trusting it:

- 480 rows per vessel, a gapless 3-hour grid per vessel, one `Service_Code` per vessel.
- Every `Port_Code` a vessel visits is in **that service's** rotation — no vessel calling a
  port off its line.
- **Every port in every rotation is visited by at least one vessel of that service.** This
  is the check that was silently failing before, and the one worth running first.
- `Min_ROB_MT ≤ ROB ≤ Max_ROB_MT` on every row; the non-burned grade flat at 0.
- Every `Vessel_Name` resolves in `PIL_Fleet_Vessel_Specifications.csv`, and every
  `Port_Code` in both `PORT_COORDS` and `PORT_APPROACH`.

`loadVesselTracks` in [`lib/vessels.ts`](../src/lib/vessels.ts) throws on an unknown vessel
name or a port outside `PORT_COORDS`, so those two are caught at build time. The rotation
and ROB invariants are **not** — nothing in the app checks them, which is exactly how the
eight uncalled ports survived. Check them yourself.

If the fleet grows much beyond 35, watch the payload: these tracks ship as props from
`app/page.tsx`, roughly 250 KB of RSC payload at 35 vessels. Pricing moved behind
`GET /api/prices/[portKey]` at ~700 KB; that is the threshold to compare against.
