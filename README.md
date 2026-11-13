# Flow Tides: rivers & tides for iPhone

River height and flow, tides, jetty/surf conditions and weather for the
places you pick, in one screen. A phone version of my KDE Plasma
"River & Tides" taskbar widget, as a web app you add to the iPhone home
screen. Same data, same sections, same rules for switching charts and days. Designed for an iPhone 13 mini in Safari (375 pt wide).
There's no server: the phone downloads straight from NOAA, USGS and Open-Meteo.

## Install on the phone

1. Open **https://myusernameismax.github.io/riverdash/** in **Safari**.
2. Tap Share → **Add to Home Screen** → Add.
3. Open it from the home screen icon ("Flow Tides"). It runs full screen without Safari's bars.

Like Apple Weather, the app opens on one place (the ★ one), and the **list button**
(bottom right) zooms out to the **Places** list; tapping a place there zooms into it.
The list has a search bar at the top: type a river, town, bay or gauge id (NOAA's,
like VIDO3, or a USGS number, like 14162500) and the results take the list's place
(the Places title and Edit slide up out of the way, so the search bar has the top).
It starts empty: **Add a place** opens that search. Gauges come from NOAA (with forecasts and
flood stages) and, where NOAA has none, straight from USGS.
Tapping a result adds it (✓) and starts loading its data; the results stay up so several
can go in at once (every gauge on a river, say). A floating **Add 2 Rivers To List**
button (1/5 of the way up the screen, in thumb reach; above the keyboard while it's up) keeps them and goes back to the Places list, scrolled to the new places (they light up for a moment); **Cancel** (or Back, or the back swipe) takes them out
again, and tapping a ✓ result takes just that one out. Adding a gauge or tide station
to an existing place happens straight away and goes back to it.
Places are saved on the phone only (nothing is sent anywhere but the public
data services below).

Under a place's name, each station's name (blue, with ↗ in front so it shows even when a long
name is cut off) opens a map at the exact spot
of the gauge or tide station. In search results, **Map ↗** does the same before adding.

## What's different from the widget

Only the inputs change from the desktop widget:

| Widget | Phone |
|---|---|
| Taskbar shows the ★ place | The app **opens on the ★ place**. ☆ on a place makes it the one that opens first. |
| Closing the popup resets to now | Leaving the app for over a minute does the same: it reopens on the ★ place, right now, default chart. Quick app switches keep your spot. |
| Hover the big chart | **Drag a finger sideways** on it. Tapping also shows a reading, and it stays up after you let go. Up/down drags still scroll the page. |
| Scroll to zoom / drag to pan | **Pinch** to zoom, move two fingers to pan, **double-tap** to reset. |
| Hover current weather | **Tap** the temperature for feels-like and wind. |
| Hover a weather day | Tap it (the day view shows all of it). |
| Hover a *Jetty / surf* day | Tap it. The picked row also shows the biggest swell and the calm window. |
| Hover the hourly graph | Drag a finger along it, or tap an hour. |
| Esc / mouse back button | **Swipe in from the left edge**, or tap Back / Week / Done. |
| (Back, one step at a time) | Closes what's on top (add page, share, the list's search, Edit, the Places list, Customize), then a picked day goes back to the week, then another place goes back to the ★ place. On the desktop: Esc or the mouse back button; in the panel popup, once more closes it. |
| Drag a row to reorder | In Edit, drag the **≡ handle**. |
| (Remove a place) | **Swipe it left** in the Places list (short swipe shows Delete, long swipe deletes), or Edit → red −. In search, tapping an already-added result (✓) takes it back out. All with Undo (up for 2 s; hold a finger on it to keep it). A swipe has to be clearly sideways; deleting outright takes 3/4 of the row. |
| Right-click → Configure… | Per place: the **sliders** button left of the name (Customize, below). Colors and timing are in `js/config.js`. |
| Refresh every 15 min | Same while it's open, plus a refresh each time you come back to it. **Pull down** from the top to refresh now (no refresh button). |

## Water temperature and normal flow

- **Water** tile (°F, change over 3 h) and chart tab, from the USGS gauge (the one
  behind a NOAA gauge, or the gauge itself), where it has a temperature sensor (all four Portland-area test gauges do).
  Measured only: nobody publishes a water temperature forecast, so the chart has no
  dashed part. Older than 2 h: "Measured … ago".
- Under the Flow chart: **Typical flow on Nov 11: 1,640 cfs**, the median flow on
  that calendar date over every year the USGS gauge has (e.g. 1911-2026 for the
  Sandy; the median, so flood years don't inflate it). It follows the reading bar's
  day, else the picked day, else today. USGS has no height history for these gauges.
- Both can be turned off per place under Customize → Show (Water temp).
- **View History** (in the tab's color, under the Flow chart next to Typical flow, and under the Water temp chart)
  turns the chart into a longer view: **1 wk · 1 mo · 3 mo · 1 yr · 5 yr** (no dates
  to type). The river's line keeps its good-range colors; a faint dashed line is the
  typical value for each date (the legend under the chart says Recorded Flow / Average
  Flow, or Temp; "average" here is the median for that date over every year, so floods
  don't skew it); dragging shows the value, date and average. 1 wk uses
  the 15-minute readings, longer ranges USGS's daily averages. Only for gauges with a
  USGS number, and only downloaded when opened (saved 6 h; 1 wk 15 min). **Done**, the
  back swipe, another tab or place, or picking a weather day goes back.
- Flows of 10,000 cfs or more show as 12.3k in the tiles and the list so they fit;
  the chart shows them in full.

## Places list and groups

- Opened with the **list button** at the bottom right (blue); the river view zooms out
  and the list zooms in. Big **Places** title with **Edit** on its right, the search
  bar under it (that's where places get added), then every place (none highlighted:
  the list is its own page now). Each row has the place's name, the readings and ★ on
  the right, and under the name its stations in full (as at the top of a place: "Sandy
  River near Marmot", "Tides: Newport"), wrapping across the whole row, under the
  readings too, when they're long; a group row lists its places ("Vida · Coburg").
- Tapping a row opens the place out of it: the row grows into the full page, its top
  edge racing up and its bottom edge down so both reach the screen's edges together
  (the list sinks back behind it). The list button does the same in reverse: the page
  shrinks back into its row (scrolled into view first; its group's row if that's
  closed) and the list settles with a small bounce. The list keeps its spot for next time.
- Each mini graph is one color that says how the place is doing: green in shape, red
  not, gray with no good range set. Coastal tide stations show the jetty / surf rating
  instead (green calm, yellow caution, red sketchy).
- Stars: yellow = the ★ place that opens first, gray = tap to make it that.

Places on the same river group themselves in the **Places** list once there are two or
more (from the gauge names: "McKenzie River near Vida", "McKenzie River above
Coburg" → **McKenzie**). The group row shows an arrow on the left, the name with the
number of gauges, and each gauge's mini graph side by side on the right (up to 4), each in its own status color
(green in shape, red not, gray no range). Tap the group to open
it; its places show where they are ("Vida", "Above Coburg") when they're all named
after the river.
Rivers with the same name in different states stay apart: the Deschutes gauges at
Moody and Madras group as **Deschutes (OR)**, and one near Rainier, WA shows as
**Deschutes (WA)**. The state comes from NOAA's name where it has one ("Deschutes
River (OR)") and otherwise from the station list, and is only shown when two places'
rivers share a name.

- **Your own groups:** Edit → **+ Group** adds a folder (named "New group", already
  selected so you can type over it; tap the name later to rename). In Edit each group
  is a tinted box around its name and its places; the name row has a deeper tint (no
  arrow, since groups are always open in Edit), and its places are indented as in the
  list. Edit has no stars, and the rows keep their heights going in and out of it. Drag a place by ≡ over a box and
  the gap where it'll land moves inside (the box grows around it); drag it below the
  box's end to take it out. Drag a group by its own ≡ to move it with its places.
  − on a group only ungroups (the places stay). Your own groups show even with one
  place; an empty new group is gone after Done. Dragging a place out of its river's
  group keeps it out; dragging it back in makes it automatic again.
- In Edit, **+ Group** and **Done** sit where Edit was and the search bar dims in place;
  nothing moves (long station names wrap the same way in both). Opening a group that runs off the screen scrolls it
  into view (never past its name).
  Places with the same name show where they are ("McKenzie · Vida").
- Groups travel with share links.

## Moving places between devices

Tap the **share** button in the bottom bar (next to Contact). It shows a QR code and a
link that hold your places and their settings (name, ★, shown tabs, good ranges,
jetty limits). The readings themselves aren't in it; they download fresh.

- **Scan the QR code** with the other device's camera, or send yourself the link.
  Opening it shows the places with **Add to mine** (new ones added, ones you
  already have take the link's settings) or **Replace mine**. Both can be undone
  from the note that pops up.
- **Someone new (no places yet)** skips that screen: the link's places load right
  away and the app opens on its ★ place, with the logo up until its data arrives.
  Good for demo links. The link stays in the address bar, so **Add to Home Screen**
  saves it with the icon: the home-screen app loads the same places on its first
  launch (the manifest has no `start_url` on purpose, so the icon opens the address
  it was added from). After that, the app ignores the link it was installed with,
  and a reopened tab ignores the link it already loaded.
- **Pasting:** Share → Import → Paste, or paste into the field.
- **iPhone:** a scanned or tapped link opens in Safari, which keeps its own
  storage, separate from the home-screen app. Tap **Copy for the home-screen app**
  there, then in the app: Share → Import → Paste.
- **Privacy:** everything is in the part after `#`, which browsers never send to
  a server, and the app removes it from the address bar right away (except for
  someone new, see above). Whoever has
  the link can see your place names and stations, nothing else.

## Customize a place

Tap the **sliders** button left of the place's name. The panel unfolds right under the
name, above the tiles (from further down, the page glides up first); Done folds it away.
In the panel's order:

- **Name**: rename the place (only here; the name at the top isn't editable).
- **Show**: turn tabs (Height, Flow, Water temp, Tide, Waves) on or off for this place.
  A hidden tab also hides its section (Next tides, Jetty / surf) and its settings here
  (its good range, the jetty limits); those are kept and come back with the tab, but
  don't count toward *in shape* while it's off.
  With tides shown, **Next tides** turns just the tide-times section off (the Tide
  chart stays); it travels with share links.
  A tab that's off isn't downloaded either (Height and Flow both off: no river
  history; Tide off: no tide predictions; Waves off: no wave forecast). What was
  already saved stays on the phone, so turning one back on soon after shows it right
  away; otherwise just its tile spins while it downloads. A station whose tabs are
  all off isn't named under the place's name. The app remembers which tabs each
  station has (`rt:avail`), so Show still offers ones that aren't being downloaded.
  Adding tides to a river place starts with **Waves** (and the jetty / surf rating)
  off; a tide station on its own shows them.
- **Good range**: a low and/or high bound for height, flow or tide. The chart draws
  the line green inside it and red outside (no shading). Next to the place's name:
  *in shape* / *too low* / *too high* (every reading with a range has to be in it).
  Leave a side blank for no limit.
- **Jetty / surf rating**: the wave heights for calm and sketchy, and the gust limits,
  for this spot (defaults come from `js/config.js`). **Reset** goes back to them.
- **Stations**: add a tide station to a river place (or a river gauge to a tide place), or
  remove one of the two (with Undo). River gauges show their USGS number here.
  To remove the last one, remove the place under Edit.

### Weather day view

Tap a day in **7-day weather**. Under the day's summary:

- **Top strip:** time and weather icon every 3 h. Night hours are shaded here only.
- Each graph has a short caption on its left ("Rain chance · %", "Temperature · °F").
- **Rain chance** (the big part): one bar per hour on a faint 0–100% track, solid
  from 30% (`rainDimBelow` in `js/config.js`), faint below. The peaks are labeled.
  A day with no hour at 30% or more gets a short, flat rain row.
- **Temperature:** a thin line, labeled only at its highs and lows (turns of 4°F or
  more, so small wiggles aren't labeled; the start and end count when they're one).
- Past hours are dimmed. Drag along it or tap for one hour's details.

### The reading bar and the weather move together

Tap or drag on the big chart to get the reading bar. It stays on the same time when
you switch tabs (Height → Flow → Tide → Waves), open a day and go back to the week.
Only switching to another place clears it.

- While the bar moves, the day it's on is highlighted in **7-day weather** (it doesn't
  open it). Drag through a week-long forecast and the highlight follows.
- In the week view every chart shows the same week as the weather (through the 7th
  day), as far as its data goes; rivers also the last 2 days, tides and waves start at now.
- With a weather day open, the bar picks the hour it's on in the hourly graph, and
  picking an hour there moves the bar to that hour.
- Opening a day while the bar is on a different day moves the bar to the same time
  of day on the opened day (Mon 3 PM → Fri 3 PM), so the chart shows that day.

### Where "Waves" comes from

Open-Meteo's marine forecast model (`wave_height`): the *significant wave height* of
the whole sea, i.e. swell and local wind waves combined. It is not the swell alone.
The swell part (`swell_wave_height`, with its period and direction) is shown when you
tap a day in *Jetty / surf* ("Biggest swell …"). It's a model forecast for the nearest
sea grid cell to the tide station, not a buoy reading.

## Files

| File | What |
|---|---|
| `index.html` | Page skeleton, home-screen settings |
| `css/app.css` | Layout, light/dark colors |
| `STYLE.md` | Style rules: no borders, tints for selection, wording, color meanings |
| `js/config.js` | Accent colors, jetty limits, timing (the phone's `Style.qml`) |
| `js/app.js` | Everything on screen, port of `main.qml` |
| `js/chart.js` | Big chart and mini graphs, port of `Chart.qml` |
| `js/data.js` | Downloads and crunches the data, port of `rivers.py` |
| `js/icons.js` | Weather and button icons |
| `js/share.js` | Share links: packs/unpacks places into the link, checks imported ones |
| `js/qr.js` | QR code maker (written for this app, no outside code) |
| `data/gauges.json`, `data/tides.json` | Station lists for search, shipped so search is instant (NOAA gauges carry their USGS number, so searching 14162500 finds the McKenzie near Vida) |
| `data/usgs.json` | USGS gauges NOAA doesn't carry (only shipped; refresh with the tool) |
| `sw.js` | Lets the app open with no signal (shows the last data) |
| `tools/update-station-lists.py` | Refreshes the shipped station lists (optional; the app fetches new NOAA lists itself when they're old). Looks up which USGS gauge each NOAA gauge is; `tools/noaa-usgs-ids.json` keeps those so reruns are quick |

Downloads are cached on the phone for the same times as the widget (river
history 3 h, tides 6 h, waves 3 h, weather 1 h, current readings 5 min; USGS-only
gauges 15 min, water temperature 30 min, typical flow 30 days).

## Trying it on the PC

    cd riverdash
    python3 -m http.server 8765
    # open http://localhost:8765 in Firefox, Responsive Design Mode (Ctrl+Shift+M), iPhone size

A mouse works too: hover, scroll-to-zoom, drag and Esc behave like the widget. In search
results, the row under the pointer is tinted so it's clear which one the + adds.

## Troubleshooting

- **A red line under the name:** a data site (NOAA, USGS, Open-Meteo) is down, or an id is wrong. The last copy keeps showing meanwhile.
- **Places got messed up / start over:** iPhone Settings → Apps → Safari → Advanced → Website Data → remove the site, then reopen the app. It starts empty.
- **Updates:** no need to reinstall. The app always opens from the copy saved on the
  phone (instant, works with no signal) and checks GitHub for a new version in the
  background with a few tiny requests. A new version is downloaded whole, then the
  app switches to it: right away if you just opened it and haven't touched anything,
  otherwise the next time you come back after a minute away. A short "Updated to the
  latest version" note shows; your places are kept.
- **Opening screen:** the app logo with "Getting the latest from NOAA…" until the
  place on screen has something to show (saved data counts, so normally it's only a
  blink). After 8 s it says "Slow connection · still loading…"; after the refresh
  finishes (or fails), or 30 s at most, it fades out either way. Before the page
  itself loads, iOS shows `icons/launch-1125x2436-*.png` (the same logo, sized for the
  iPhone 13 mini, light and dark). iOS may only pick that picture up when the icon
  is added to the home screen.
- **Loading order:** the app opens at once on the saved data (carried forward to now).
  Then it downloads the place on screen first, in full, then all the others together
  (4 at a time): the ★ place in full, the rest only what the places list shows. A
  place's weather, water temperature and typical flow download when you open it (if
  older than 15 min); while it does, a tile it may still get (Water for a just-added
  gauge, say) spins in its spot, and is gone if the gauge turns out not to have it.
  The USGS extras download alongside the river history, not after it. With 21 places: the shown place is current in ~2 s, all in ~6 s,
  with 62 downloads instead of 104.
- **Busy servers** (HTTP 429/5xx, e.g. a weather 503) get one quiet retry. Places
  within 10 km share one weather forecast; if weather can't be downloaded, the
  nearest saved one within 30 km stands in.
- **Weak or no signal:** the last downloaded readings show the moment the app opens,
  and fresh ones replace them when they arrive.
- **Opened after a while (or offline):** the saved data is carried forward to *now*
  using what it predicts: the river forecast, tide tables, wave and weather forecasts.
  A river reading over 2 h old is replaced by the forecast for now ("Forecast ·
  measured 8 h ago"); on the chart, only real measurements are solid, the rest is
  dashed, and the dot sits on the forecast at now. Past the end of a forecast, the
  last measurement shows with its age ("Measured 5 d ago"). The footer says
  **Offline · updated …** when nothing could be downloaded.
- **Don't delete and re-add the home-screen icon to update:** the home-screen app has
  its own storage, and removing the icon can wipe your saved places.

## Data sources (free, no key)

| Data | Source |
|---|---|
| River height, flow, forecast (the whole one, about 7 days, including what NOAA's site calls the trend), flood stages | NOAA National Water Prediction Service |
| Tides (predictions, live level where there's a sensor) | NOAA CO-OPS Tides & Currents |
| Flow when NOAA has none (e.g. the tidal Willamette at Portland, which runs backwards on a rising tide): the last 2 days, or only the latest number at gauges without a real-time series (the Flow tab then says "No flow history at this gauge") | USGS Water Data |
| Gauges NOAA doesn't carry (about half of USGS's real-time gauges, mostly creeks): height and flow every 15 min, last 2 days; no forecast or flood stages | USGS Water Data |
| Water temperature (last 3 days, measured; no forecast exists) | USGS Water Data, at gauges that have a sensor |
| Typical (median) flow for each calendar date (over all years) | USGS statistics service |
| Waves, wind, weather | Open-Meteo |

The jetty rating is a rough model forecast, not a buoy reading. Look at the
water yourself before going out on rocks or a jetty.

## Contact

**Contact** in the bottom bar opens an email to flowtidessupport@gmail.com (subject
"Flow Tides"), which forwards to Max. It's hidden in the desktop widget.

Easter egg: scroll to the end of the page, then keep pushing: the page lifts like a
rubber band over a small note, and springs back when you let go.

## Security

No accounts, no server, no tracking. The page only loads its own files and
talks only to the data services above (enforced by its Content-Security-Policy).

## Desktop wrappers

The Linux panel widget (and a planned Windows tray app) show this same hosted app
in a popup, so features only get written here. They use `window.flowTides`:
`summary()` (the ★ place's name, short readings and a mini graph for the taskbar),
`refresh()` (a hidden page doesn't refresh itself) and `openImport(link)`.
Keep those working when changing `app.js`.

