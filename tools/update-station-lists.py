#!/usr/bin/env python3
"""Refresh the station lists shipped with the app (data/gauges.json, data/tides.json).

Search uses these so the first search on the phone is instant. The app downloads
fresh lists from NOAA on its own once they are over 90 days (tides) / 180 days
(gauges) old, so running this is optional; it just keeps the shipped copy fresh.

    python3 -I tools/update-station-lists.py      # ~30 s, then commit + push
"""
import json, os, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
NWPS = "https://api.water.noaa.gov/nwps/v1"
COOPS_STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"


def get(url, params=None, timeout=90):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "riverdash-station-lists", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def all_gauges():
    """Every NOAA river gauge. The API times out on one huge box, so ask for 10-degree strips."""
    strips = [(x, x + 10) for x in range(-180, -60, 10)] + [(130, 180)]
    def strip(b):
        return get(f"{NWPS}/gauges", {"bbox.xmin": b[0], "bbox.ymin": -20, "bbox.xmax": b[1],
                                      "bbox.ymax": 75, "srid": "EPSG_4326"})["gauges"]
    with ThreadPoolExecutor(6) as pool:
        gauges = {g["lid"]: g for part in pool.map(strip, strips) for g in part}
    return sorted([[g["lid"], g["name"], (g.get("state") or {}).get("abbreviation", ""), g.get("latitude"), g.get("longitude")]
                   for g in gauges.values()], key=lambda r: r[1])


def tide_stations():
    return [[x["id"], x["name"], x.get("state") or "", x.get("lat"), x.get("lng")] for x in get(COOPS_STATIONS)["stations"]]


def save(name, rows):
    rows = [[i, (n or "").strip(), s or "", None if la is None else round(float(la), 4), None if lo is None else round(float(lo), 4)]
            for i, n, s, la, lo in rows]
    with open(os.path.join(HERE, "..", "data", name), "w") as f:
        json.dump({"made": int(time.time() * 1000), "rows": rows}, f, separators=(",", ":"))
    print(f"{name}: {len(rows)} stations")


if __name__ == "__main__":
    save("gauges.json", all_gauges())
    save("tides.json", tide_stations())
