# Oregon state gauges (waiting on the data owners)

Status: **not in the app yet.** Requests have been sent to both data owners; nothing in
the app changes until one of them says yes.

## What's missing

Some Oregon gauges aren't in NOAA's National Water Prediction Service or in USGS Water
Data, the two river sources the app uses, so search can't find them. Example: **MLSO3,
Metolius above Allingham GS** (NWPS answers "could not find gauge ID").

They're run by the **Oregon Water Resources Department (OWRD)**. NOAA's **Northwest River
Forecast Center (NWRFC)** plots some of them on its own site (with the NOAA logo), which
is why they look like NOAA gauges.

- OWRD lists about 560 gauges reporting in near real time; about 240 of those are USGS
  gauges (already in the app), so about **320 would be new**.
- MLSO3 is OWRD station **14088500**, "Metolius R at Allingham RS nr Sisters".

## Where the data is

| Source | Address (MLSO3 as the example) | What it has |
|---|---|---|
| OWRD | `https://apps.wrd.state.or.us/apps/sw/hydro_near_real_time/hydro_download.aspx?station_nbr=14088500&start_date=11/11/2026&end_date=11/13/2026&dataset=Instantaneous_Flow&format=tsv` (also `Instantaneous_Stage`, `MDF` = mean daily flow) | flow and height every 15 min, daily means, long history; tab-separated |
| OWRD | `https://apps.wrd.state.or.us/apps/sw/hydro_near_real_time/near_real_time_gage_station_kml.aspx` | every station: number, name, status, coordinates (KML, ~2.8 MB) |
| NWRFC | `https://www.nwrfc.noaa.gov/xml/xml.cgi?id=MLSO3&pe=HG&dtype=b&numdays=10` | height every 15 min, name, county, coordinates (XML); no flow for MLSO3 |

Weather isn't a problem: it comes from Open-Meteo by coordinates, and both sources give
each gauge's coordinates.

## Why it doesn't work yet

The app has no server: the phone downloads straight from each data site. A browser only
lets a page from another site read a response that carries the header
`Access-Control-Allow-Origin` (CORS). NOAA NWPS, NOAA CO-OPS, USGS and Open-Meteo send
it; **OWRD and NWRFC don't** (checked on the downloads and on the browser's preflight
request), so the browser would refuse the data.

## What's been done

Short requests went to **both OWRD and NWRFC**, asking whether
`Access-Control-Allow-Origin: *` could be added to their read-only gauge data responses,
and noting that the app only loads a gauge while someone's viewing it and caches the
readings on the phone (light traffic). Either one saying yes is enough; OWRD is the
better one (it has flow too).

## If one of them says yes

- Ship a list of the new gauges (from the OWRD KML, skipping the ones that are USGS
  gauges) with the other station lists, so search finds them by name or number.
- Download a gauge only for people who added it, with the same caching as USGS-only
  gauges (15 min for readings), and only a couple of days per request.
- They'd show like USGS-only gauges: height / flow, the chart, View History where there's
  history; no forecast and no flood stages. Weather as usual.
- Add the host to the Content-Security-Policy (`connect-src` in `index.html`).

Nothing else changes for users: they'd just find more gauges in search.

## Options looked at and turned down

- **A small relay** (e.g. a free Cloudflare Worker) that fetches a gauge on request and
  passes it on with the header: works, but adds a server and an account to keep.
- **A scheduled GitHub job** copying readings onto the site: downloads around the clock
  whether anyone's looking or not, readings up to an hour old.
- **A public CORS proxy** run by someone else: requests would go through a stranger's
  server.
