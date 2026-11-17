# Oregon state gauges

Status: **in the app** for the 39 gauges that report by satellite (height, and water
temperature at about half). Flow and the state's other gauges still wait on the state.

## What was missing

Some Oregon gauges aren't in NOAA's National Water Prediction Service or in USGS Water
Data, the two river sources the app uses, so search couldn't find them. Example: **MLSO3,
Metolius above Allingham** (NWPS answers "could not find gauge ID").

They're run by the **Oregon Water Resources Department (OWRD)**. NOAA's **Northwest River
Forecast Center (NWRFC)** plots some of them on its own site (with the NOAA logo), which
is why they look like NOAA gauges. MLSO3 is OWRD station **14088500**, "Metolius R at
Allingham RS nr Sisters".

## How NOAA gets them, and how the app does

About 100 OWRD gauges send their readings by GOES satellite. NOAA's **HADS**
(Hydrometeorological Automated Data System) decodes them; that's what NWRFC plots. The
**Iowa Environmental Mesonet (IEM)** at Iowa State University archives everything HADS
decodes and has a JSON service a browser is allowed to read
(`Access-Control-Allow-Origin: *`):

    https://mesonet.agron.iastate.edu/api/1/obhistory.json?station=MLSO3&network=OR_DCP&date=2026-11-16

One request is one of the station's calendar days: `HGIRGZZ` is height (ft), `TWIRGZZ`
water temperature (°F), every 15 min (10 at a few gauges).

Of the 100 gauges, NOAA's river service already has 56 (they were in the app all along,
with forecasts), 3 don't report height and 3 had been silent for days. That leaves **39**,
listed in `data/hads.json` (made by `tools/update-station-lists.py hads`, which reads
HADS's station table and keeps the OWRD-owned ones that report height, aren't in NOAA's
list, and have a reading from the last 2 days at IEM).

Checked on 2026-11-16:

- IEM's height for MLSO3 (0.87 ft) is the number on NWRFC's page, and as recent as OWRD's own.
- At USGS gauges that go through the same relay, IEM's height and temperature match
  USGS's own (so the units are right: ft and °F).
- OWRD's site shows 0.81 ft for the same moment: the state corrects the raw reading
  afterwards. The app shows the raw one, like NWRFC.
- Water temperature isn't checked by anyone. 19 of the 39 send it; one sent −13107 °F and
  one 0.5 °F (dropped: only 31 to 100 °F is shown), and a couple read warmer than seems
  likely in November (Metolius 55 °F). Shown anyway, because it's the only reading there is
  for those spots; the README says to treat it as rough.

## In the app

- Search finds them by name or id, marked **OWRD**; the Places list says "OWRD MLSO3".
- They show like USGS-only gauges: Height tile and chart (last 2 days), Water where
  there's a sensor, weather as usual. No flow, forecast, flood stages or View History.
- Downloads: today's readings again after 15 min; a finished day once more after it's
  over, then it's kept. So the first load is 3 small requests and a refresh is 1 (IEM
  also caches each answer for 10 min on its side).
- `mesonet.agron.iastate.edu` is in the Content-Security-Policy (`connect-src` in
  `index.html`). Only numbers are read from its answers; names and coordinates come from
  the shipped list.
- IEM is free "for most any legal purpose" but asks not to be put behind a heavily
  trafficked site. If the app ever gets big, ask them first (akrherz@iastate.edu).

## Still missing: flow, and OWRD's other gauges

OWRD lists about 560 gauges in near real time; about 240 are USGS gauges and 56 are in
NOAA's service, so roughly 200 more (the ones that don't report by satellite) and **flow**
for all of them exist only on OWRD's own download pages:

| Address (MLSO3 as the example) | What it has |
|---|---|
| `https://apps.wrd.state.or.us/apps/sw/hydro_near_real_time/hydro_download.aspx?station_nbr=14088500&start_date=11/11/2026&end_date=11/13/2026&dataset=Instantaneous_Flow&format=tsv` (also `Instantaneous_Stage`, `MDF` = mean daily flow) | flow and height every 15 min, daily means, long history; tab-separated |
| `https://gis.wrd.state.or.us/server/rest/services/dynamic/Gaging_Stations_Query_WGS84/FeatureServer/0` | every station: number, name, status, coordinates, which data it has |

The second one (OWRD's ArcGIS server) already sends the header browsers need; the
download pages don't (checked on the downloads and on the browser's preflight request),
so the app can't read them. A request went to OWRD asking for
`Access-Control-Allow-Origin: *` on the download pages; they offered a call. If they add
it, flow and the remaining gauges can come straight from OWRD.

## Other sources checked (2026-11-16)

IEM is the only place found that both has these gauges and lets a browser read them.

| Source | Has the gauges? | Browser can read it? |
|---|---|---|
| NOAA NWPS (`api.water.noaa.gov`) | no ("could not find gauge ID") | yes |
| NOAA `api.weather.gov` | no (404 for MLSO3) | yes |
| NOAA NWRFC (`www.nwrfc.noaa.gov`: XML, text page) | yes, height | no |
| NOAA HADS itself (`hads.ncep.noaa.gov`) | yes | no |
| NOAA MADIS public | no match | no |
| OWRD download pages (`apps.wrd.state.or.us`) | yes, with flow | no |
| OWRD ArcGIS server (`gis.wrd.state.or.us`) | station list only, no readings | yes |
| Reclamation Hydromet (`www.usbr.gov/pn-bin/instant.pl`) | some, with flow (Whychus at Sisters = SQSO: height and cfs) | no |
| Oregon open data (`data.oregon.gov`) | no readings | yes |
| Army Corps CWMS (`cwms-data.usace.army.mil`) | no | yes |
| ArcGIS Online | a consultant's Midcoast layer only | yes |

So the lasting fix is still OWRD (or Reclamation) adding the header to pages they already
have; a relay of our own is the fallback if IEM ever goes away.

## Options looked at and turned down

- **A small relay** (e.g. a free Cloudflare Worker) that fetches a gauge on request and
  passes it on with the header: works, but adds a server and an account to keep.
- **A scheduled GitHub job** copying readings onto the site: downloads around the clock
  whether anyone's looking or not, readings up to an hour old.
- **A public CORS proxy** run by someone else: requests would go through a stranger's
  server.
- **IEM's bulk download** (`cgi-bin/request/hads.py`, any date range in one request): it's
  throttled per address and slow by its own description; the JSON service above is the
  one meant for apps.
- **Working flow out from height** with OWRD's rating curve: the curve shifts and OWRD
  corrects the height first, so the number would be off.
