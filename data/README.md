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
| `VLSFO Prices.csv` | 43 columns: 25 assessed ports + **18 modelled** | 1973 | 2019-01-02 → 2026-08-05 |
| `HSGO Prices.csv` | 28 columns: 12 assessed + **16 modelled**, `IFO380` | 1973 | 2019-01-02 → 2026-08-05 |
| `LSMGO_MGO Prices.csv` | 49 columns: 28 assessed + **12 modelled `LSMGO`** + **9 modelled `MGO`** | 1973 | 2019-01-02 → 2026-08-05 |
| `MDO Prices.csv` | 2 columns, both modelled — Chittagong and Mongla | 1973 | 2019-01-02 → 2026-08-05 |
| `LNG Prices.csv` | 5 columns: 1 **reconstructed** hub + 4 modelled — see below | 1973 | 2021-10-01 → 2026-08-05 |
| `lng_anchors.csv` | published JKM and premium anchors behind the LNG hub — **not a price sheet** | 10 | anchors from 2021-09-30 |
| `Biofuel Prices.csv` | 7 columns, all modelled — 5 × `B24`, 2 × `B40` | 1973 | 2019-01-02 → 2026-08-05 |
| `Methanol Prices.csv` | 13 columns, `MEOH` + `VLSFOe`/`MGOe` equivalents + **1 modelled** (Ningbo) | 188 | 2022-12-16 → 2026-08-03 |
| `bunker_basis.csv` | provenance for the modelled columns — **not a price sheet**, and not read by the app | 264 | segments from 2019-01-02 |

`MDO Prices.csv` and `Biofuel Prices.csv` carry no assessed columns at all: every value
in them is modelled. They share the date spine of the three fossil sheets.

Coverage is the *date range of the file*, not of every column. Most columns start
much later than the first row — see "sparsity" below.

### Fuel availability — the Chief Engineer's sheet is the authority

**Which port×grade pairs exist at all** is decided by one source: `TYPES OF FUEL.xlsx`
in the Drive folder *Chief engineer input data (Operational Feasibility)*, a 26-row
sheet naming the fuels sold at each port this fleet calls. It governs `bunker_basis.csv`,
the three `NO_*_PORTS` sets in the movement generator and its `src/lib/eca.ts` mirror,
and the port and grade columns of `contracts/suppliers.csv`. Those had been derived
independently and disagreed with it at 14 of the 26 ports.

`Market_Status` in `bunker_basis.csv` carries three states, and they are not
interchangeable:

| Value | Meaning | Column emitted? |
|---|---|---|
| `priced` | market exists, basis modelled | yes |
| `no_market` | the sheet does not list this fuel at this port | no |
| `unpriced` | market exists, this dataset cannot price it | no |

Nothing is `unpriced` right now — LNG was, until its hub was reconstructed (below). The
state is kept rather than removed because it is where a fuel belongs when the sheet says
a port sells it and nothing here can put a number on it. **`no_market` and `unpriced`
produce identical output — no column — so the distinction lives only here.** Do not read
an absent column as an absent market without checking this field.

**Where the sheet overrode this file.** It gives HSFO to Chittagong, Mongla, Kolkata,
Bangkok, Jakarta and Semarang, all six of which this README previously recorded as
having no high-sulphur market; and by omission it takes VLSFO away from Chittagong,
Mongla and Kolkata, and removes Qinzhou and Yangon from the priced set entirely. The
earlier rows are gone from `bunker_basis.csv`; this paragraph is the record that they
existed.

**Two places the sheet does not get the last word,** both stated rather than quietly
resolved:

- **Assessed columns are never deleted.** The sheet lists only LSMGO at Busan and
  Shanghai, but `BUSAN MGO` and `SHANGHAI MGO` are real assessments in the source
  workbook. Deleting sourced data to match a summary sheet would destroy provenance.
  Both stay; the sheet governs modelled columns and stem routing, so nothing prices
  off them.
- **Bangladesh VLSFO.** PORTLAND (plibd.com) advertises VLSFO 0.50% across all three
  Bangladeshi seaports, and BunkaOil supplies IFO 380/180 and MGO at Chittagong and
  Mongla. The sheet omits VLSFO there. It wins by decision, and the contrary source is
  recorded in the `Data_Notes` of the blanked rows.

**LSMGO and MGO are different products, and the split falls on the ECA line.** China,
Korea, Port Klang, Singapore, Surabaya and Qui Nhon sell the 0.10% distillate; Southeast
Asia, India and the Bay of Bengal sell plain MGO. `priceSeriesFor()` in
`src/lib/bunkerEvents.ts` resolves a vessel's distillate tank per port accordingly.
Before this reconciliation every distillate stem priced off a plain `MGO` column,
which valued each China/Korea ECA switch at a 0.50% product's price.

#### The four fuels the sheet added

Confidence runs lowest at the bottom. All four are modelled; none is burned by the fleet.

| Grade | Ports | Hub | Anchor |
|---|---|---|---|
| `MDO` | Chittagong, Mongla | `SGSIN MGO` | DMB permits residual content, runs to 11.0 cSt and up to 0.50% S, and prices below DMA MGO. Set 20/mt under each port's own MGO basis; the discount is judgment, no Bay of Bengal spread was found. |
| `B40` | Jakarta, Surabaya | `SGSIN VLSFO` | **The one biofuel figure with a posted price behind it.** Pertamina posted B40 bunker prices on the B35→B40 mandate change of 2025-01-01: Jakarta $1,103/mt, Surabaya $1,049/mt, against a `SINGAPORE VLSFO` average of $590.5/mt that month. |
| `MEOH` (Ningbo) | Ningbo | `SGSIN MEOH` | First bonded green methanol STS at Meishan 2026-04-22 (503 mt to *COSCO Shipping Libra*); first supply licence Jan 2026 to Zhejiang FTZ PetroChina Fuel Oil. Basis sits above every assessed methanol spread in the file because Ningbo's product is certified **green** and the hub assessment is conventional. |
| `B24` | Singapore, Port Klang, Ningbo, Laem Chabang, Ho Chi Minh | `SGSIN VLSFO` | Argus assesses *marine biodiesel B24 dob Singapore*; the blend's LSFO component has fixed at +$190–200/mt over Platts FOB Singapore 0.5%S, and B30-VLSFO has run at a 20–30% premium. |

**`B24` is modelled off a modelled hub.** This dataset holds no assessed biofuel column,
so the Singapore B24 series is itself VLSFO plus a published premium — softer than
anything else priced here, including the MGO columns flagged below. Supply a daily Argus
B24 dob Singapore series and it becomes an ordinary assessed hub.

**The Ningbo methanol row reverses a finding this file used to carry** — that no
unassessed port in this fleet had a methanol market. That research predates the January
and April 2026 Ningbo-Zhoushan events and was correct when written.

#### LNG — the one reconstructed series

The sheet lists LNG at Singapore, Port Klang, Shanghai, Ningbo and Ho Chi Minh. Every
other grade here starts from an assessed daily series in the source workbook; LNG has
none, because the workbook carries no gas column and LNG does not track Brent. So the
Singapore hub is **reconstructed** by
[`scripts/gen-lng-prices.mjs`](../../scripts/gen-lng-prices.mjs):

```
singapore_lng($/mt) = (JKM($/MMBtu) + delivery_premium($/MMBtu)) x 52
```

**Run it before `gen-modelled-prices.mjs`** — it writes the hub column the four modelled
LNG ports are computed against, and that script throws without it.

`52 MMBtu/tonne` is arithmetic, not an assumption: two independently published pairs give
it — $736/mt at $14.16/MMBtu (Jan 2025) and $1,144/mt at $22.00/MMBtu (Aug 2026).

The anchors and their sources live in `lng_anchors.csv`. Three properties keep the
reconstruction honest, and all three should survive any refresh:

1. **Monthly resolution.** Values are held flat within a calendar month, so the chart
   draws a staircase. A real gas curve is violently volatile day to day; a smooth daily
   line would claim precision the anchors cannot support. The staircase is the tell.
2. **It starts where the evidence starts** — September 2021, the first anchor. Earlier
   dates are blank, not extrapolated, which is also true to the market: LNG bunkering at
   these ports barely existed before then.
3. **It self-checks against a figure no anchor is fitted to.** Platts assessed Singapore
   LNG bunker at $14.274/MMBtu across 2024 ($742.25/mt); the run fails if the
   reconstruction drifts more than 5% from it over that year. It currently lands 4.9%
   out — inside tolerance but not comfortably, and the slack is mostly the `inferred`
   2023 anchor, the weakest in the file.

**The check has already earned its keep.** The first build had no 2025 anchor, ramped
straight from January 2025 to April 2026, and came out 13.3% above the published
average. Platts' 2026 yearly base rate ($783.42/mt for October 2024 to September 2025)
was promoted from validator to anchor to fix it, which is why the validation now uses
the 2024 bunker average instead — checking against a figure an anchor is derived from
would only prove arithmetic.

**Anything presenting an LNG figure should say it is reconstructed from published
anchors, not assessed.** The unblock is an assessed daily LNG bunker or JKM series
covering the window: drop one in as the hub and this script becomes unnecessary.

### Modelled columns — the ports nobody assesses

**Not every column in these files is an assessment, and nothing in the app marks which
is which.** Read this section before quoting any figure from a port outside the
assessed set.

Only 3 of the 26 ports this fleet stems at are quoted anywhere — Singapore, Busan and
Shanghai. The other 23 have no assessment and no obtainable history: Ship & Bunker
403s automated fetch and gates history behind Bunker Prices Pro, Bunker Index answers
"Subscribe to view this information" on every port page, OilMonster and LiveBunkers are
login-walled. Each is therefore **modelled**, the way an unassessed port is genuinely
quoted in the market:

```
modelled(port, grade, date) = assessed_hub(hub, grade, date) + basis(port, grade, date)
```

The basis lives in `bunker_basis.csv` and is materialised into the wide CSVs by
[`scripts/gen-modelled-prices.mjs`](../scripts/gen-modelled-prices.mjs).

**Re-run that script after every price refresh.** The modelled columns are computed
from the hub columns beside them, so the moment the hubs are updated the modelled
values are stale — and nothing at runtime can detect it. That is the standing cost of
keeping modelled and assessed data in one file.

Modelled ports, by hub:

| Hub | Ports |
|---|---|
| `SINGAPORE` | Port Klang, Chittagong, Mongla, Kolkata, Chennai, Gangavaram, Yangon, Haiphong, Ho Chi Minh, Qui Nhon, Laem Chabang, Bangkok, Jakarta, Surabaya, Semarang |
| `HONGKONG` | Shekou, Nansha, Xiamen, Qinzhou (+ all Chinese IFO380 — Shanghai has no IFO380 column) |
| `SHANGHAI` | Ningbo, Qingdao, Tianjin (VLSFO only) |
| `BUSAN` | Incheon |

`MGO` rides the same hub assignment as VLSFO, added for all 23 ports for chart
completeness — see "MGO and Methanol" below.

`bunker_basis.csv` columns: `Port_Code, Port_Name, Grade, Hub_Port_Code, Hub_Grade,
Effective_From, Basis_USD_Per_MT, Confidence, Source_Name, Source_URL, Source_Date,
Rationale, Data_Notes`. A segment runs until the next `Effective_From` for that
`(port, grade)`; there is no `Effective_To`. **Blank `Basis_USD_Per_MT` means no market
for that grade at that port; `0` means parity with the hub** — the same distinction as
"zeros here are real" in the vessel file. Blanks may only *lead* a series, so trimming
the leading nulls removes every null a blank basis can produce and the chart's
`connectNulls` never bridges a period we declared had no price.

`Confidence` is `sourced` (a published spread — only Qingdao and Jakarta),
`inferred` (read across from an assessed spread), or `judgment` (no source). **Every
`judgment` row brackets its number between two assessed spreads from this dataset** —
Port Klang between Singapore (hub, 0) and assessed Hong Kong (+11), Chittagong above
assessed Colombo (+65–70) — so each invented figure stays auditable against data
already in the repo.

**Calibrate on this dataset's own spreads, not published ones.** S&P reported the
Zhoushan/Shanghai–Singapore LSFO spread at $14/mt on 2026-04-07 and $18/mt on
2024-12-30; `VLSFO Prices.csv` gives **+78.0** and **+28.0** on those exact dates. It is
a different assessment series. The spreads to calibrate against, mean ± sd $/mt vs
Singapore:

```
SHANGHAI  2020:14±16  2021:10±9   2022:22±22  2023:21±15  2024:17±16  2025:13±11  2026:2±32
HONGKONG  2020:-1±13  2021:-5±8   2022:10±22  2023:11±12  2024:11±11  2025:12±6   2026:21±27
BUSAN     2020:12±14  2021:24±16  2022:33±41  2023:30±19  2024:21±12  2025:27±19  2026:67±86
COLOMBO   2020:54±53  2021:50±17  2022:90±67  2023:65±27  2024:70±17  2025:65±15  2026:130±101
```

2026 is anomalous on every pair (sd 27–101), so the open-ended final segment is
calibrated on 2024–25 deliberately.

#### What this costs, stated plainly

- **A modelled column moves in lockstep with its hub.** A constant basis models the
  level, not the shape. The assessed spread standard deviations above (±9 to ±32) are
  comparable to several of the basis values themselves.
- **Modelled figures price bunker stems.** They sit in the files `bunkerPriceSnapshot()`
  reads, so a stem at Chittagong is valued off Singapore plus a judgment differential
  and looks identical to a quoted one in the bunker log. Any total built from those
  values is part modelled.
- **8 ports get no IFO380 column** — Nansha, Qinzhou, Shekou, Surabaya, Gangavaram,
  Yangon, Haiphong, Qui Nhon. That list, and every other availability question below,
  now comes from the Chief Engineer's `TYPES OF FUEL.xlsx` (see *Fuel availability*).
  It replaced a 12-port list this file had researched independently and got wrong at
  six ports in one direction and two in the other.

  This used to be a live inconsistency: the movement file assigned grade purely by
  scrubber fitting and never checked what a port could sell, so it recorded HSFO stems
  where no such stem could be lifted. **Fixed** — `NO_HSFO_PORTS` in
  [`scripts/gen-vessel-movement.mjs`](../scripts/gen-vessel-movement.mjs) holds the
  list, a scrubber vessel calling one of them lifts VLSFO into its compliant reserve
  instead, and an invariant fails the run if an HSFO stem ever lands at one. Two
  further sets sit beside it now, `NO_VLSFO_PORTS` and `NO_MGO_PORTS`, each with its
  own invariant. Laem
  Chabang was named here previously and should not have been: `LAEMCHABANG IFO380`
  carries 1,715 values through 2026-08-05.
- **Jakarta's column steps ~$143/mt on 2023-05-01.** Real: Pertamina moved to
  market-based pricing and exempted ocean-going vessels from 11% VAT, and the assessed
  premium narrowed from $210–256 to ~$87 (Argus). It is not smoothed — ramping would
  invent intra-period structure with no source.
- **Most `Source_URL`s are gated.** `Source_Name` + `Source_Date` + the figure quoted in
  `Rationale` are what make a `sourced` claim checkable; the URL is a pointer, not the
  evidence.

#### MGO and Methanol — one extended, one deliberately not

**`MGO` now prices stems.** It was originally extended for chart completeness only, but
`PRICE_SERIES` in `src/lib/bunkerEvents.ts` maps `VLSFO`/`HSFO`/`MGO` to
`VLSFO`/`IFO380`/`MGO`, so every one of the 116 MGO lifts recorded in
`PIL_Fleet_Live_Movement.csv` is valued off these columns. At 23 of the 26 ports that
figure is modelled, and — unlike the VLSFO basis — it is entirely `inferred`/`judgment`
confidence. Treat MGO stem values as the softest numbers in the app.

Methanol remains a chart-completeness question with no effect on valuations: no vessel
stems it.

**`MGO` was modelled for all 23 ports**, same hub assignment as VLSFO, entirely
`inferred`/`judgment` confidence (no published spread was found for any of them).
Marine gasoil is treated as realistically universal at ports that already take
VLSFO/HSFO stems on a live rotation — it is what generators and auxiliary engines run
on. Directly confirmed for the hardest cases: Chittagong and Mongla (Selim Shah Marine
Enterprise supplies IFO/MGO/MDO at both — [dieselduck.info](https://www.dieselduck.info/forum/viewtopic.php?t=1503)),
Jakarta ([livebunkers.com](https://www.livebunkers.com/jakarta)), and Port Klang
([oilmonster.com](https://www.oilmonster.com/bunker-fuel-prices/far-east-and-south-pacific/port-klang/76)).
Every port gets a single `MGO` column, not a parallel `LSMGO`, matching the file's own
regional convention — Busan, Hong Kong and Shanghai are already labelled `MGO`, while
`LSMGO` shows up mostly at Japan/Europe/Americas ports.

The basis itself reads across the assessed `HONGKONG MGO`, `SHANGHAI MGO` and
`BUSAN MGO` minus `SINGAPORE MGO` spreads already in `LSMGO_MGO Prices.csv`. That
spread is considerably noisier than VLSFO's — `SHANGHAI MGO − SINGAPORE MGO` swings
from a 2019 mean of −385 (sd 318, almost certainly thin-liquidity days rather than a
real signal) to a 2022 mean of +98 — so Singapore-hub ports are bracketed against the
calmer `BUSAN MGO` spread (+13 to +46 across the period) rather than Shanghai's.

**Superseded — Ningbo now carries a modelled `MEOH` column.** The research below was
correct when written but predates the port's first supply licence (January 2026) and
its first bonded green methanol STS bunkering (April 2026); Ningbo-Zhoushan *is* in
this fleet's unassessed set, which the paragraph missed. See *Fuel availability* above.
The rest still holds: no other unassessed port here has a methanol market.

**Methanol was researched and found to have no market at any of the 23 ports — left
unmodelled by finding, not by oversight.** As of August 2026, methanol bunkering
infrastructure exists only at Singapore (MPA licences to Golden Island/GET/PetroChina
effective 2026-01-01, plus the new Jurong Port green-methanol terminal —
[MPA](https://www.mpa.gov.sg/media-centre/details/singapore-to-award-licences-for-methanol-bunkering),
[Splash247](https://splash247.com/singapore-locks-in-methanol-suppliers-for-2026-takeoff/)),
Shanghai/Zhoushan (PetroChina's first China licence), and emerging South Korea/India
facilities that name Kandla specifically — not any port in this fleet's rotation,
including Incheon, the one Korean port in scope. Modelling it anyway would price a fuel
this fleet never burns (`VesselGrade` is `"VLSFO" | "HSFO"` only) off a hub set where
only Singapore is assessed, with no comparable Asian port to calibrate a basis against —
fabrication with no anchor, unlike the `judgment` rows above which all bracket against a
real spread in this dataset.

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
| `suppliers.csv` | one row per supplier (74), tiered as the source groups them |
| `supplier_offers.csv` | one row per port × grade × supplier (465), **generated** |
| `term_terms.csv` | one row per negotiable commercial parameter, with its clause |

The most load-bearing value in `term_terms.csv` is the guaranteed pumping rate,
400–800 MT/hour (clause 3.3) — it feeds the `quantity ÷ pump rate` transfer-time
check, no other file in `data/` carries a pump rate, and it is also the band
`Pump_Rate_MT_Per_Hour` is drawn from in `supplier_offers.csv`. Lead times come from
`firm_nomination_window`, 5–10 working days (clause 1.2(b)).

### `suppliers.csv` — 24 rows from the source, 49 added

`source_basis` separates them. The 24 `source` rows keep the document's own names,
tiers and prose; their `ports` and `grades` are **not** from the source and are
assigned here.

The source roster is Europe- and major-weighted with no Asian regional physicals at
all, while 25 of the 48 priced ports are Intra-Asia. Making every port reach three
credible suppliers therefore needed real regional names — Sinopec Zhoushan, Chimbusco,
SK Energy, ENEOS, IOCL, Pertamina, PTT, Petrolimex, Petronas, ENOC, Peninsula, Minerva,
Astron and the rest. Those carry `source_basis=added`. The alternative was quoting Qui
Nhon out of Sunpine AB, which satisfies the count and fails the smell test.

`ports` and `grades` are `;`-separated, the same convention as `Key_Features` and
`Main_Engine_Fuel_Types`. Together they are the coverage rule: a supplier is eligible
for a port × grade only if it lists both, **and** the port actually has a series for
that grade.

### `supplier_offers.csv` — every figure is simulated

Generated by [`scripts/gen-supplier-offers.mjs`](../scripts/gen-supplier-offers.mjs).
Nothing in it is sourced. The supplier list has no rates; the MSA has a blank
`Price Basis: ____`. Every differential, lifting range, lead time and payment term is
invented to give each port a market that behaves plausibly.

Offers store a **differential, not a price**:

```
offer(port, grade, supplier) = baseline(port, grade) + Offer_Basis_USD_Per_MT
```

`src/lib/suppliers.ts` resolves the baseline at read time from the latest non-null
point in `pricing/`. So unlike the modelled price columns, **these do not go stale on
a price refresh** — there is nothing to re-run when `pricing/` moves. Re-run the
generator only when `suppliers.csv` changes.

Differential bands, and why they are shaped that way:

| Tier | Band $/mt | Reasoning |
|---|---|---|
| 1 — Global major | +3 … +14 | brand, ISO 8217 assurance, 45-day credit |
| 2 — Trader / independent physical | −8 … +4 | reselling someone else's cargo, competes on price |
| 3 — Bio / sustainable | +15 … +60, **MEOH only** | certified renewable product, genuinely dearer |
| 4 — Regional / state-owned | −6 … +5 | refinery on its own doorstep |

Ex-wharf deliveries take a further −1.5 (no barge cost). `Payment_Terms_Days` is
derived from the differential rather than drawn — 45 above +6, 30 at or above parity,
15 below — so credit and premium can never contradict each other.

Working rules:

- **Randomness is seeded** on `Port_Code|Grade|Supplier`. The output is reviewable in
  git and re-running is a no-op. Never hand-edit the file — the next run overwrites it.
- **Three suppliers per port × grade is a floor, asserted, not a hope.** The generator
  throws naming the pair if coverage falls short. 64 of the 134 markets sit exactly on
  it; the rest carry 4 or 5.
- **Tier 3 is alternative fuels only** — methanol, B24 and B40. A certified renewable
  blend is not a like-for-like quote against a fossil grade, so those suppliers never
  appear in a VLSFO or IFO380 panel. Widened from methanol alone when the CE sheet
  brought biofuel in as a real grade; the reasoning is unchanged. Asserted after
  generation.
- **`MEOH_VLSFOe` and `MEOH_MGOe` get no offers.** They are the same physical methanol
  restated in energy-equivalent terms; quoting them separately triple-counts one market.
- **Thin markets are derived, not listed.** Below 6 eligible suppliers a port gets
  longer lead times and `Availability` skewed to `Enquire`. That stays true when
  coverage changes, which a hardcoded port list would not.
- Adding a supplier needs a `ports` entry, a `grades` entry and a generator re-run in
  the same change. A LOCODE with no price series throws rather than being skipped.

**These offers are indistinguishable from real quotes downstream, and at the 23
modelled ports they spread off a baseline that is not an assessment either** — a hub
series plus a documented basis, per the `pricing/` section above. The port panel says
so in copy; anything else that presents them must too.

---

## `vessels/` — PIL fleet register

**Source:** PIL Drive case folder → *Vessel data* → **Vessel Specifications** (Google
Sheet `17SKe5NZoZoKBkFKLajvxcFKwOKQPwZivqenAze9f4aA`), a single sheet plus a footnote
block. Sheet last modified 2026-08-08; **extracted 2026-08-09**.

| File | Grain |
|---|---|
| `PIL_Fleet_Vessel_Specifications.csv` | one row per vessel (109) |
| `vessel_assumptions.csv` | one row per derived column (8 — 5 from the source footnote, 3 for the MGO tank) |
| `PIL_Fleet_Live_Movement.csv` | one row per vessel per 3-hour step (26,040) |

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
remaining-on-board fuel by grade, and any bunker delivered. 26,040 rows — **35 vessels ×
exactly 744 steps**, 2026-05-05 00:00:00 → 2026-08-05 21:00:00, no gaps. This is the only
file in `data/` with a real timestamp and a fuel level that moves over time.

**This file is the app's timeline.** Nothing in `src/` hardcodes a start or end date:
`loadVesselTracks` keeps the first `Timestamp` and the row count, and every date the UI
shows is index arithmetic from there. The window closes on **2026-08-05**, the last date in
`pricing/`, so every stem falls inside the priced period — see "The bunkering trigger" below.

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

All of the above is implemented by [`scripts/gen-vessel-movement.mjs`](../scripts/gen-vessel-movement.mjs),
which holds the roster and these rules and asserts every invariant under "Refreshing" before
it writes. **To move the timeline, edit `WINDOW_START` and `STEPS` at the top of that script
and re-run it** — those two constants are the whole window, and the fleet simply replays over
the new dates. It is idempotent.

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
  and `Consumption_Berth_MT_Per_Day ÷ 8` per berthed step — the consumption model is
  unchanged, and still comes from `vessel_assumptions.csv`. **The running ROB is rounded to
  three decimals after each step; the burn rate itself is not.** The distinction is not
  cosmetic: KOTA SEJATI burns 46.58 ÷ 8 = 5.8225 MT per transit step, so pre-rounding the
  rate shifts thousands of cells and the odd step legitimately drops 5.823 rather than 5.822.
- At the first berthed step of a call carrying a `Bunker_Quantity_MT`, a stem is lifted if
  ROB has fallen to `Bunkering_Trigger_MT` **or** if ROB minus the fuel needed to reach the
  next stem opportunity would fall below `Min_ROB_MT`. The second clause is the
  safety-critical one: it stops a vessel sailing past a bunker port it cannot skip. The
  rule is applied per tank, against the residual pair jointly and MGO separately.
- The residual stem is `min(Bunker_Quantity_MT, Max_ROB_MT − residual ROB)`, so a call's
  published quantity is never exceeded and the tank never overfills. Where capacity cuts
  the stem short, the row says so in `Data_Notes` — 73 of 134 residual stems.
- **Invariants, verified over all 26,040 rows before the file is written:**
  `Min_ROB_MT ≤ HSFO + VLSFO ≤ Max_ROB_MT`, and MGO within its own tank. Neither reaches
  0; the tightest margins are 3.445 MT above `Min_ROB_MT` and 1.557 MT above the MGO
  floor. **250 stems** occur across the fleet's 93 days — 57 HSFO, 77 VLSFO, 116 MGO —
  against the Drive extract's 26.

The ROB curves are still a model, not measurements — the consumption rates are a flat
percentage of DWT, so this remains a worked example. What changed is that it is now a
*feasible* one. If you regenerate, re-assert the invariant: a vessel whose `Max_ROB_MT`
cannot cover its longest inter-stem leg is the wrong ship for the service, and the fix is
the deployment, not a clamp.

### Every vessel runs three tanks, and switches fuel for ECA calls

This replaces the old one-grade-per-vessel model, in which a vessel burned HSFO or VLSFO
by scrubber fitting, the other residual column was flat at 0, and MGO was a parked
number. Three things drive the current model.

**Compliance.** High-sulphur fuel exists only on a scrubber-fitted hull. The 15
non-scrubber vessels carry `HSFO_ROB_MT` and `HSFO_Bunkered_MT` flat at 0 — a true zero,
not a missing value. This is the MARPOL Annex VI rule the specifications sheet does *not*
encode: it lists `VLSFO; HSFO; MGO` for every vessel, which means "engine can burn", not
"vessel may lawfully burn". Where the two disagree, this file is the more careful one.

**Supply.** The 20 scrubber vessels carry **both** residual grades, sharing `Max_ROB_MT`
— HSFO as the main fuel and VLSFO as a compliant reserve, opening at 80/20. The reserve
is not decorative: 12 of the 26 ports have no HSFO market (see "What this costs" above),
and a scrubber vessel stemming at one lifts VLSFO instead. Burn takes HSFO first, so the
reserve stands until HSFO runs out. All 20 hold VLSFO at every step; an invariant fails
the run otherwise.

**The ECA switch.** Ten of the 26 ports sit in China's or Korea's national port ECA:
`CNNGB CNNSA CNQZH CNSHA CNSHK CNTAO CNTSN CNXMN KRINC KRPUS`. Those cap sulphur at
**0.10%**, which VLSFO (0.50%) does not clear — so the switch fuel has to be MGO, and
switching between the two residual grades would look like compliance without being it.
Per the source rule: on MGO from **8 steps (24 h) before** a berth at an ECA port until
**1 step (3 h) after** it ends. Consecutive ECA calls merge into one window, which is why
a KCS vessel running Busan → Incheon → Qingdao → Shanghai barely returns to its main fuel
between them. `Active_Fuel` records which grade is burning at each step; it is written
out rather than inferred, because a tank standing still is indistinguishable from a tank
not being burned.

**MGO is now a series, not a constant** — burned and stemmed, 116 lifts. Its tank sits
*outside* `Max_ROB_MT` (ASTERIOS opens at 683 MT of residual, exactly its `Max_ROB_MT`,
and carries MGO on top) and is taken as **0.20 × `Max_ROB_MT`**, floor `÷3`, trigger `÷2`
— recorded in `vessel_assumptions.csv`, mirrored in `MGO_TANK_RATIO` in
`src/lib/types.ts` for the fuel bar. That ratio **supersedes the five hand-carried
figures** from the Drive extract (ASTERIOS, KOTA ANGGUN, KOTA AZAM, KOTA DAHLIA,
KOTA DUNIA), which had no derivable basis — 0.13 to 0.72 of `Min_ROB_MT` across 11
vessels, a ratio of nothing. Three of the five land near 0.20 × `Max_ROB_MT`; two do not.
Holding five hand figures beside thirty derived ones would have made the series
inconsistent the moment MGO started moving.

**10 of the 35 vessels never enter an ECA** — BD1 ×2, BD2 ×2, CAS ×4, YGS ×2, whose
rotations run Singapore/Bangladesh/Kolkata/Yangon. Their `MGO_ROB_MT` is flat all window
and their `Active_Fuel` never reads MGO. That is correct rather than a gap: auxiliary and
port-generator consumption is **not** modelled here, so MGO moves only where the main
engine is on it. An invariant checks both directions — a rotation touching an ECA port
whose MGO never moves fails, and so does the reverse.

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
- **`Active_Fuel` was added**, after `Operational_Phase`, taking `VLSFO`, `HSFO` or `MGO`.
  It is the one column here that is derived rather than sourced, and it is written out
  instead of left to be inferred: a reader cannot tell a fuel switch from an untouched
  tank by watching ROB, because MGO is flat all window on 10 of the 35 vessels.
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
refresh it. Run `node scripts/gen-vessel-movement.mjs`, which regenerates it from
`schedules/PIL_Intra_Asia_Port_Calls.csv` and asserts all of the following **before** it
writes, throwing rather than emitting a file that violates any of them:

- 744 rows per vessel, a gapless 3-hour grid per vessel, one `Service_Code` per vessel.
- Every `Port_Code` a vessel visits is in **that service's** rotation — no vessel calling a
  port off its line.
- **Every port in every rotation is visited by at least one vessel of that service.** This
  is the check that was silently failing before, and the one worth running first.
- `Min_ROB_MT ≤ HSFO + VLSFO ≤ Max_ROB_MT` on every row, and MGO inside its own tank.
- **Compliance:** every non-scrubber vessel holds and stems exactly 0 HSFO, and no
  `Active_Fuel` reads HSFO on an unfitted hull.
- **Supply:** no HSFO stem lands at a port in `NO_HSFO_PORTS`, no VLSFO stem at one in
  `NO_VLSFO_PORTS`, and no distillate stem at one in `NO_MGO_PORTS`.
- **The reserve:** no scrubber vessel runs its VLSFO to zero.
- **The ECA switch happened:** MGO moves on every rotation that calls an ECA port, and on
  no rotation that does not.
- `Active_Fuel` is one of `VLSFO`/`HSFO`/`MGO`, and the vessel is holding some of it.
- Every `Vessel_Name` resolves in `PIL_Fleet_Vessel_Specifications.csv`, and every
  `Port_Code` in both `PORT_COORDS` and `PORT_APPROACH`.

`loadVesselTracks` in [`lib/vessels.ts`](../src/lib/vessels.ts) throws on an unknown vessel
name or a port outside `PORT_COORDS`, so those two are also caught at build time. The
rotation and ROB invariants are **not** checked anywhere in the app — which is exactly how
the eight uncalled ports survived — so if you ever build this file by any route other than
the generator, assert them yourself.

The generator reads `PORT_COORDS` and `PORT_APPROACH` by scraping `src/lib/ports.ts` and
`src/lib/searoutes.ts`, since no CSV carries port geometry. That scrape throws if it finds
fewer than 26 codes, so reformatting either object literal fails loudly instead of turning
the check into a vacuous pass.

Watch the payload: these tracks ship as props from `app/page.tsx`, roughly **390 KB of RSC
payload at 35 vessels × 744 steps** (up from ~250 KB at 480 steps). Pricing moved behind
`GET /api/prices/[portKey]` at ~700 KB; that is the threshold to compare against. There is
room for the fleet to grow to roughly 55 vessels *or* for a longer window, not both — the
next expansion of either dimension should move tracks behind an API route on the same
pattern.
