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
| `PIL_Fleet_Live_Movement.csv` | one row per vessel per 3-hour step (5,280) |

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

### Open gap: no vessel ↔ service link, for 98 of 109 vessels

The specifications sheet carries no `Service_Code`, and no vessel name appears anywhere
in `schedules/`. `PIL_Fleet_Live_Movement.csv` supplies the link for the **11 vessels
it covers** and no others, so for the remaining 98 there is still no way to say which
ship runs a given service, and no way to tie a port call's `Bunker_Quantity_MT` to a
specific vessel's tank capacity. That needs a deployment or vessel-schedule source.
Same caution as `suppliers.ports`: don't infer it from vessel size or trade lane.

---

## `PIL_Fleet_Live_Movement.csv` — simulated movement and ROB series

**Source:** same Drive folder → **Vessel Live Movement** (Google Sheet
`1qcFyBa9_51cdK_Ul6pyEi3VGzel85BEo2a1F9Rbi1C8`, formerly titled "Wip - live vessel
mvt"). Sheet last modified 2026-08-08; **extracted 2026-08-09**.

One row per vessel per 3-hour step: position, operational phase, remaining-on-board
fuel by grade, and any bunker delivered. 5,280 rows — **11 vessels × exactly 480
steps**, 2026-08-01 00:00:00 → 2026-09-29 21:00:00, no gaps. This is the only file in
`data/` with a real timestamp and a fuel level that moves over time.

### It is a simulation, not telemetry — and it is generated from `vessel_assumptions.csv`

Each vessel's fuel drop per 3-hour step equals its assumed daily rate ÷ 8, to three
decimals, in both phases (ASTERIOS 2.559 observed vs 2.560 expected; KOTA CABAR 10.026
vs 10.026). The file is the assumption played forward in time, so it is a worked
example of the fuel model and **carries no independent evidence about real voyages**.
Reconciling it against actual noon reports would be circular.

The 11 vessels are the first 11 rows of the specifications sheet in alphabetical order
(ASTERIOS → KOTA DUNIA) — a demo slice, not an operational selection.

### `Synthetic_Latitude` / `Synthetic_Longitude` are fictional. Never map them.

The columns are renamed from the source's plain `Latitude`/`Longitude` because the
positions are not real. Every berth position is thousands of km from the port named in
the same row:

| Row says | Position given | Actual port | Off by |
|---|---|---|---|
| Qingdao | 3.92°N 150.04°E | 36.07°N 120.38°E | ~4,450 km |
| Shanghai | 11.80°N 161.60°E | 31.23°N 121.47°E | ~4,380 km |
| Busan | 9.17°S 85.71°E | 35.10°N 129.04°E | ~6,300 km |
| Surabaya | 12.42°N 175.46°W | 7.20°S 112.73°E | ~31,800 km |

All 5,280 points lie in a narrow equatorial band (lat −9.2 to +13.5) with longitude
covering the whole globe including the antimeridian. Fed to `RouteMap` they would
scatter the fleet across open Pacific, unrelated to the arcs drawn from `PORT_COORDS`.
**Use `Port_Code` → `PORT_COORDS` for anything geographic.** The columns are retained
only so the extract stays faithful to its source.

### The simulation breaks its own safety limits

Every vessel spends much of the window below the `Min_ROB_MT` from
`vessel_assumptions.csv`, and only 26 bunker events occur across 60 days:

| Vessel | rows below `Min_ROB_MT` | rows below `Bunkering_Trigger_MT` |
|---|---|---|
| KOTA DUNIA | 283 / 480 | 463 / 480 |
| KOTA CANTIK | 242 / 480 | 418 / 480 |
| KOTA AZAM | 226 / 480 | 375 / 480 |
| *(all 11)* | 55–283 | 185–463 |

**KOTA CANTIK and KOTA DUNIA reach exactly 0 MT** on 5 rows — no fuel onboard at all,
which is not a survivable state. Those rows are flagged in `Data_Notes`. The bunkering
trigger is plainly not enforced here, so **an optimiser that treats these ROB curves as
feasible operations is optimising an impossible schedule.** Fix the generator before
drawing conclusions about bunker timing from this file.

### Fuel grade does follow scrubber status

Scrubber-fitted vessels burn HSFO (`VLSFO_ROB_MT` flat at 0); non-scrubber vessels burn
VLSFO (`HSFO_ROB_MT` flat at 0). Exact across all 11. This is the MARPOL Annex VI rule
that the specifications sheet does *not* encode — that sheet lists `VLSFO; HSFO; MGO`
for every vessel regardless of scrubber. Where the two disagree, this file is the more
careful one.

`MGO_ROB_MT` is constant per vessel: MGO is never burned and never stemmed. It is a
static number, not a series.

### Conventions

- **`Port_Code` is added, not from the source.** The sheet's column is titled "Port /
  Location Code" but holds port *names* (`Qingdao`, not `CNTAO`). The name is kept as
  `Port_Name` and the LOCODE resolved beside it from `PIL_Intra_Asia_Port_Calls.csv` —
  never invented. All 18 distinct ports resolve, and all 18 exist in `PORT_COORDS`.
- **`Port_Name` is the leg *destination*, not the current location.** While
  `Operational_Phase` is `Transit` it names the port being sailed to; it only means
  "where the ship is" once the phase is `Berthed`. The source's "Location" wording is
  misleading.
- **`Berthed` and `Transit` columns were dropped.** Both were fully derivable from
  `Operational_Phase`, with zero disagreements across all 5,280 source rows.
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

Re-export the sheet as CSV, then reapply the transform: rename headers as above, drop
`Berthed`/`Transit`, resolve `Port_Code` from the port calls by name, and re-flag any
zero-ROB rows. Re-check that every port name still resolves — a new port in the feed
that is absent from `PORT_COORDS` would disappear from the map with no error.
