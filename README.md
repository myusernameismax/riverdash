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

It starts empty: tap **+ Add** and search for a river, town, bay or gauge id.
Places are saved on the phone only (nothing is sent anywhere but the public
data services below).

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
| Drag a row to reorder | In Edit, drag the **≡ handle**. |
| Right-click → Configure… | Per place: tap **Customize** under the place (below). Colors and timing are in `js/config.js`. |
| Refresh every 15 min | Same while it's open, plus a refresh each time you come back to it. |

## Customize a place

Tap **Customize** at the bottom of a place:

- **Show**: turn tabs (Height, Flow, Tide, Waves) on or off for this place. A hidden tab
  also hides its section (Next tides, Jetty / surf).
- **Good range**: a low and/or high bound for height, flow or tide. The chart shades
  that band and draws the line green inside it and red outside; the tile and the
  places list show *in shape* / *too low* / *too high*. Leave a side blank for no limit.
- **Jetty / surf rating**: the wave heights for calm and sketchy, and the gust limits,
  for this spot (defaults come from `js/config.js`). **Reset** goes back to them.
- **Stations**: remove the river gauge or the tide station from a place (with Undo).
  To remove the last one, remove the place under Edit.

- **Name**: rename the place (tapping the name at the top works too).

### The reading bar and the weather move together

Tap or drag on the big chart to get the reading bar. It stays on the same time when
you switch tabs (Height → Flow → Tide → Waves), open a day and go back to the week.
Only switching to another place clears it.

- While the bar moves, the day it's on is highlighted in **7-day weather** (it doesn't
  open it). Drag through a week-long forecast and the highlight follows.
- With a weather day open, the bar picks the hour it's on in the hourly graph, and
  picking an hour there moves the bar to that hour.

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
| `js/config.js` | Accent colors, jetty limits, timing (the phone's `Style.qml`) |
| `js/app.js` | Everything on screen, port of `main.qml` |
| `js/chart.js` | Big chart and mini graphs, port of `Chart.qml` |
| `js/data.js` | Downloads and crunches the data, port of `rivers.py` |
| `js/icons.js` | Weather and button icons |
| `data/gauges.json`, `data/tides.json` | Station lists for search, shipped so search is instant |
| `sw.js` | Lets the app open with no signal (shows the last data) |
| `tools/update-station-lists.py` | Refreshes the shipped station lists (optional; the app fetches new ones itself when they're old) |

Downloads are cached on the phone for the same times as the widget (river
history 3 h, tides 6 h, waves 3 h, weather 1 h, current readings 5 min).

## Trying it on the PC

    cd riverdash
    python3 -m http.server 8765
    # open http://localhost:8765 in Firefox, Responsive Design Mode (Ctrl+Shift+M), iPhone size

A mouse works too: hover, scroll-to-zoom, drag and Esc behave like the widget.

## Troubleshooting

- **A red line under the name:** a NOAA site is down, or an id is wrong. The last copy keeps showing meanwhile.
- **Places got messed up / start over:** iPhone Settings → Apps → Safari → Advanced → Website Data → remove the site, then reopen the app. It starts empty.
- **Updates:** no need to reinstall. The app checks for a new version each time it
  opens, and when you come back to it after more than a minute away; if there is
  one it reloads itself (a short "Updated to the latest version" note shows) and
  keeps your places. If a change still doesn't show, swipe the app away in the app
  switcher and open it again.
- **Don't delete and re-add the home-screen icon to update:** the home-screen app has
  its own storage, and removing the icon can wipe your saved places.

## Data sources (free, no key)

| Data | Source |
|---|---|
| River height, flow, forecast, flood stages | NOAA National Water Prediction Service |
| Tides (predictions, live level where there's a sensor) | NOAA CO-OPS Tides & Currents |
| Flow when NOAA has none | USGS Water Data |
| Waves, wind, weather | Open-Meteo |

The jetty rating is a rough model forecast, not a buoy reading. Look at the
water yourself before going out on rocks or a jetty.

## Security

No accounts, no server, no tracking. The page only loads its own files and
talks only to the data services above (enforced by its Content-Security-Policy).
