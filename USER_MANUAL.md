# BunkerNex User Manual

## What it is
BunkerNex is a maritime explorer: a map of PIL's container-service routes and vessels, layered with bunker fuel pricing, fleet fuel simulation, and bunker-planning tools. Three screens: the main map (Explorer), the Supplier HQ desk, and the Route Plan optimizer.

## 1. Main map (Explorer, "/")

**Layout**: header bar, left Filters sidebar, center map, right detail panel (port/vessel/service), bottom-anchored price forecast drawer + bunker log + time scrubber.

**Filters sidebar** (hamburger icon on mobile, always visible on desktop):
- **Vessel search** and **Port search** boxes — type a name to jump to it and pan the map.
- **Service/Region toggles** — check/uncheck individual service routes, or bulk-select by trade region (Intra Asia vs Asia-Europe). Hovering a service in the list highlights its route on the map.
- **Active filter pills** show what's currently applied, with a one-click Reset.
- **Map key** at the bottom explains the marker shapes (route port, price port, both, vessel heading, selected-service direction arrow).

**The map**: MapLibre dark map with schematic (not navigable) route arcs between ports. Click a port marker or vessel to open its detail panel on the right; only one of Port/Vessel/Service panel is shown at a time.

**Time scrubber** (bottom): drag or click to move through the simulated fleet window (currently 2026-05-05 → 2026-08-05, 3-hour steps). Tick marks show where bunker stems ("bunkering events") happen. Moving it updates vessel positions, fuel levels, and everything time-dependent on screen.

**Price forecast drawer** (bottom, open by default): a compact price outlook panel, collapsible.

**Bunker log** (bottom, collapsed by default): a running list of every bunker stem up to the current scrubber position. Click a row to seek the clock to that event or open the vessel.

### Port panel
Opens when you click a port. Shows:
- Bunker prices (expand to see price tiles + chart, if this port is priced)
- Supplier offers for that port's fuel grades, cheapest first, with a "BEST" chip
- Bunkering history — which vessels have stemmed here so far, what grades, how much
- Schedule — which services call here and when

### Vessel panel
Opens when you click a vessel (or select one from search). Shows, as of the scrubbed moment:
- Status (in transit / berthed), current leg, what fuel it's burning
- A fuel bar showing residual tank (HSFO/VLSFO) and compliance tank (MGO or MEOH/LNG/B40) levels against capacity and the bunkering trigger
- "Due to bunker" / safety-floor warnings when relevant
- **"Evaluate spot bunkering"** button (only while in transit) — opens the spot bunker requirement form
- Fuel-remaining trend chart, CO2e emitted and estimated CO2e cost charts (click any chart to seek the clock)
- Full bunkering history for this vessel
- Vessel specifications and assumed bunker figures
- Its service's published rotation, with any ports the simulation skips flagged

### Spot bunkering form
Reached via "Evaluate spot bunkering" on a vessel. A multi-section chief-engineer-style requirement form (grade & spec, quantity & ROB, cold flow, statutory/environmental, schedule/delivery, surveyor/quality testing, notes) with inline validation. While open, the app enters **focus mode**: sidebar hides, map locks on the vessel, clock freezes. You can:
- **Generate PDF** — exports the requirement as a document
- **"See bunkering combinations"** — submits the fixed grade/quantity and jumps to the Route Plan optimizer, pre-scoped to this vessel and position

Exit via the back arrow, Esc, or the map chip — your typed draft is kept if you step back into the vessel view and return.

## 2. Supplier HQ ("/hq")
A separate desk for evaluating suppliers at a given port and fuel grade (linked from the header, or reached with a port/grade/supplier deep link). Pick a **Port**, **Fuel grade**, and **forecast horizon** (10 or 30 days). Shows:
- Market positioning scatter (price vs. delivery capability)
- Quote history & price forecast chart
- Supplier scorecards (year-to-date performance, best first)
- Click a supplier to see their full bunkering transaction history

A footer notice states supplier quotes, barge fleets, and contract prices here are simulated, not sourced data.

## 3. Route Plan ("/route-plan")
The route-wide bunkering optimizer. Pick a **vessel** and a **position** (via the time scrubber), review/edit the **fixed nomination** (grade + quantity for the immediate next port — this is treated as fixed, not re-optimized), then click **Evaluate route**. It looks ahead up to 5 calls or 30 days and returns:
- **Top 3 ranked bunkering combinations** (cards, click to select one)
- A map of the selected combination's route, with recommended stops (gold ring) and the fixed nomination (violet ring) marked
- A cost comparison bar chart and a plain-language explanation of why the winning route is cheapest
- Price forecast charts (3 models + ensemble) for every port/grade the selected plan stems at
- Tank-level timelines (residual and compliance tanks) across the plan

A footer notice explains this is decision support (a greedy cheapest-reachable-call search), not a provably optimal solver, and that supplier data is simulated.

## Step-by-step: common tasks

### Find a vessel and check its fuel status
1. On the main map, open the **Filters** sidebar (hamburger icon, top-left, on mobile — already open on desktop).
2. Click the **vessel search** box at the top and type the vessel's name.
3. Click the vessel in the results list. The map pans to it and its detail panel opens on the right.
4. Read the **fuel bar** near the top of the panel for residual (HSFO/VLSFO) and compliance-tank (MGO/MEOH/LNG/B40) levels.
5. Scroll down for the fuel-remaining trend chart, CO2e charts, and full bunkering history. Click anywhere on those charts to move the clock to that point in time.
6. Click the **×** top-right (or press **Esc**) to close the panel.

### Look up bunker prices and suppliers at a port
1. Click any port marker on the map (a white dot, a diamond, or an accent-colored dot — see the map key in the sidebar footer for what each shape means).
2. In the panel that opens, click **"Bunker prices"** to expand it — this shows price tiles and a chart, if the port is priced.
3. Scroll to **"Supplier offers"** to see quotes for each grade, cheapest first (marked **BEST**).
4. Scroll further for **"Bunkering history"** (which vessels have stemmed here) and **"Schedule"** (which services call here).
5. Click **×** or press **Esc** to close.

### Step through time
1. Drag the horizontal **time scrubber** at the very bottom of the map, or click anywhere along it to jump directly.
2. Small tick marks on the scrubber show moments when a bunker stem happens for a currently visible service.
3. Everything on screen — vessel positions, fuel levels, the bunker log — updates to match.

### Filter which services/vessels/ports show on the map
1. Open the **Filters** sidebar.
2. Under the region buttons, click a trade region to bulk-select all its services, or tick/untick individual service codes one at a time.
3. Hover a service name to preview its route highlighted on the map before selecting it.
4. Use the **Reset** pill (in Active filters) to clear vessel/port search text and turn every service back on.

### Submit a spot bunkering requirement (Chief Engineer flow)
1. Click a vessel to open its panel (see "Find a vessel" above).
2. If the vessel is currently **in transit** (not berthed), click **"Evaluate spot bunkering"**.
3. The app switches to **focus mode** — sidebar hides, map locks on this vessel, the clock freezes. A red pill top-left of the map shows you're in this mode and the pinned timestamp.
4. Work through the form sections top to bottom: **Fuel grade & specification**, **Quantity & ROB**, **Temperature & cold flow**, **Environmental & statutory**, **Schedule, port & barging**, **Surveyor & quality testing**, **Notes**. Click a section's header to expand/collapse it; only "Fuel grade" and "Quantity" are open by default.
5. Fill in required fields. If something's missing, the section header shows a red error count — click **"N fields need attention →"** at the bottom to jump straight to the first one.
6. When ready, choose one:
   - Click **"Generate PDF"** to export the requirement as a document.
   - Click **"See bunkering combinations →"** (enabled once there are no errors) to send this grade/quantity to the Route Plan optimizer, pre-loaded for this vessel and position.
7. To leave without submitting, click the back arrow next to the vessel name at the top, press **Esc**, or click **Exit** on the red focus-mode pill — your typed answers are kept if you come back to this vessel before closing it.

### Compare suppliers at a specific port (Supplier HQ)
1. From the main map's header, click **"Supplier HQ"** (hidden on narrow screens/focus mode).
2. Pick a **Port** from the dropdown.
3. Pick a **Fuel** grade from the button group next to it.
4. Pick a **Forecast horizon** — **10 days** or **30 days**.
5. Review the market scatter plot, then the quote history/forecast chart below it.
6. In **"Supplier record"**, click a supplier's row to select them — this highlights them across the charts above and reveals a **"Bunkering history"** table for just that supplier further down.
7. Click **BunkerNex** in the top-left to return to the main map, or **Route Plan** in the header to jump to the optimizer.

### Plan a route's bunkering (Route Plan optimizer)
1. From the main map or Supplier HQ header, click **"Route Plan"** — or arrive here automatically by submitting a spot bunkering form (see above).
2. Pick a **Vessel** from the dropdown.
3. Drag the **time scrubber** to set the vessel's current position.
4. Review the **Fixed nomination** (grade + quantity for the very next port) — edit the grade dropdown or the MT quantity field if needed; this value is treated as locked and is not itself re-optimized.
5. Click **"Evaluate route"**. A staged loading animation shows what's happening; when it finishes you'll see:
   - **Top 3 ranked bunkering combinations** — click a card to select it.
   - A map of that combination's route (gold ring = recommended stop, violet ring = your fixed nomination).
   - A cost bar chart and a written explanation of why it's the cheapest option.
   - Price forecast charts and tank-level timelines for the selected plan.
6. Click a different combination card at any time to update the map, charts, and explanation below it.

## Notes on the data
- "Prices as of" (top right on every screen) shows the latest date in the pricing data.
- Only some ports have real market pricing; others are modelled from a nearby hub, and a few carry no pricing at all — panels say so plainly when data is missing.
- Route lines everywhere are schematic sea-lane arcs, not actual navigable tracks.
