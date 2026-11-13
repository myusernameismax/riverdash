#!/usr/bin/env python3
"""Refresh the station lists shipped with the app (data/gauges.json, data/tides.json,
data/usgs.json).

Search uses these so the first search on the phone is instant. The app downloads
fresh lists from NOAA on its own once they are over 90 days (tides) / 180 days
(gauges) old, so running this is optional; it just keeps the shipped copy fresh.

    python3 -I tools/update-station-lists.py      # ~30 s, then commit + push
"""
import json, math, os, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
NWPS = "https://api.water.noaa.gov/nwps/v1"
COOPS_STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"


def get(url, params=None, timeout=90):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "riverdash-station-lists", "Accept": "application/json"})
    for wait in (0, 20, 60, 120):     # "429 Too Many Requests": wait and try again
        time.sleep(wait)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or wait == 120:
                raise


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


USGS_SITES = "https://waterservices.usgs.gov/nwis/site/"
STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
          "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR").split()
IDS_CACHE = os.path.join(HERE, "noaa-usgs-ids.json")   # {NOAA lid: USGS site or ""}; kept so reruns are quick


def noaa_usgs_ids(lids):
    """Which USGS gauge each NOAA gauge is (from each gauge's own record; the bulk list
    doesn't say). Cached in tools/noaa-usgs-ids.json, so only new gauges are looked up."""
    try:
        known = json.load(open(IDS_CACHE))
    except (OSError, ValueError):
        known = {}
    todo = [l for l in lids if l not in known]
    def one(lid):
        try:
            return lid, get(f"{NWPS}/gauges/{urllib.parse.quote(lid)}", timeout=60).get("usgsId") or ""
        except Exception:
            return lid, None          # try again next run
    with ThreadPoolExecutor(8) as pool:
        for n, (lid, sid) in enumerate(pool.map(one, todo), 1):
            if sid is not None:
                known[lid] = sid
            if n % 500 == 0:
                print(f"  NOAA gauge records: {n}/{len(todo)}")
                json.dump(known, open(IDS_CACHE, "w"), separators=(",", ":"))
    json.dump(known, open(IDS_CACHE, "w"), separators=(",", ":"))
    return known


ABBR = {"NR": "near", "NEAR": "near", "AT": "at", "AB": "above", "ABV": "above", "ABOVE": "above", "BL": "below",
        "BLW": "below", "BLO": "below", "BELOW": "below", "CR": "Creek", "CK": "Creek", "CRK": "Creek", "RV": "River",
        "FK": "Fork", "R": "River", "TRIB": "Tributary", "CNL": "Canal", "DIV": "Diversion", "RES": "Reservoir", "LK": "Lake",
        "BR": "Bridge", "MTH": "Mouth", "CONFL": "Confluence", "HWY": "Hwy", "NF": "North Fork", "SF": "South Fork",
        "MF": "Middle Fork", "EF": "East Fork", "WF": "West Fork", "STA": "Station", "SPGS": "Springs"}
SMALL = {"near", "at", "above", "below", "and", "of", "the", "to", "in", "on"}
DIRS = {"N": "North", "S": "South", "E": "East", "W": "West"}


def nice_name(name, state):
    """USGS names are upper case and abbreviated ("MCKENZIE RIVER NR VIDA, OR"); make
    them read like NOAA's ("McKenzie River near Vida") so the app's short names work."""
    words = name.replace(",", " , ").split()
    if words and words[-1] == state:
        words = words[:-1]
    while words and words[-1] == ",":
        words = words[:-1]
    out = []
    for i, w in enumerate(words):
        key = w.rstrip(".")
        nxt = words[i + 1].rstrip(".") if i + 1 < len(words) else ""
        if key in DIRS and nxt in ("FK", "FORK"):
            out.append(DIRS[key]); continue
        if key in ABBR:
            out.append(ABBR[key]); continue
        low = key.lower()
        if low in SMALL and out:
            out.append(low); continue
        if any(c.isdigit() for c in key) or key == ",":
            out.append(key); continue
        t = "-".join(p[:1].upper() + p[1:].lower() for p in key.split("-"))
        if t.startswith("Mc") and len(t) > 2:
            t = "Mc" + t[2].upper() + t[3:]
        out.append(t)
    return " ".join(out).replace(" ,", ",").strip(", ")


def usgs_gauges(ids):
    """Every active USGS stream gauge reporting flow or height in real time that NOAA's
    list doesn't already have (those are searchable as the NOAA gauge, with its forecast)."""
    have = {v for v in ids.values() if v}
    def state(st):
        url = USGS_SITES + "?" + urllib.parse.urlencode({"format": "rdb", "stateCd": st, "siteStatus": "active",
              "hasDataTypeCd": "iv", "parameterCd": "00060,00065", "siteType": "ST"})
        req = urllib.request.Request(url, headers={"User-Agent": "riverdash-station-lists"})
        for wait in (0, 20, 60, 120):     # USGS answers "429 Too Many Requests" when hurried
            time.sleep(wait)
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    text = r.read().decode()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return []             # no such gauges in that state
                if e.code != 429 or wait == 120:
                    raise
        rows, head = [], None
        for line in text.splitlines():
            if not line or line.startswith("#"):
                continue
            c = line.split("\t")
            if head is None:
                head = c; continue
            if c[0].endswith("s") and c[0][:-1].isdigit():
                continue              # the column-width row under the header
            d = dict(zip(head, c))
            if d.get("site_no") and d["site_no"] not in have:
                rows.append([d["site_no"], nice_name(d["station_nm"], st), st, d.get("dec_lat_va"), d.get("dec_long_va")])
        return rows
    with ThreadPoolExecutor(2) as pool:
        rows = [r for part in pool.map(state, STATES) for r in part]
    return sorted({r[0]: r for r in rows}.values(), key=lambda r: r[1])


def same_spot(noaa_rows, ids, usgs_rows):
    """Some NOAA gauges are USGS gauges whose record just doesn't say so (no usgsId).
    A USGS gauge within 300 m of such a NOAA gauge, on the same river (same first word),
    is that gauge: it's left out of the USGS list and its number goes to the NOAA gauge
    (so searching the number finds it). Different gauges at one spot, like the upper and
    lower pool at a lock, have their own numbers in NOAA's records and stay."""
    grid = {}
    for r in noaa_rows:
        if r[3] is not None and not ids.get(r[0]):
            grid.setdefault((round(r[3], 2), round(r[4], 2)), []).append(r)
    first = lambda n: (n.split() or [""])[0].lower()
    keep, found = [], {}
    for u in usgs_rows:
        la, lo = float(u[3]), float(u[4])
        near = [r for dy in (-0.01, 0, 0.01) for dx in (-0.01, 0, 0.01)
                for r in grid.get((round(la + dy, 2), round(lo + dx, 2)), [])]
        hit = next((r for r in near if r[0] not in found and first(r[1]) == first(u[1])
                    and math.dist((la, lo * math.cos(math.radians(la))), (r[3], r[4] * math.cos(math.radians(la)))) * 111 < 0.3), None)
        if hit:
            found[hit[0]] = u[0]
        else:
            keep.append(u)
    return keep, found


def save(name, rows):
    # [id, name, state, lat, lon] (+ the USGS number for NOAA gauges that are USGS gauges, so it's searchable)
    rows = [[r[0], (r[1] or "").strip(), r[2] or "", None if r[3] in (None, "") else round(float(r[3]), 4),
             None if r[4] in (None, "") else round(float(r[4]), 4)] + [x for x in r[5:6] if x] for r in rows]
    with open(os.path.join(HERE, "..", "data", name), "w") as f:
        json.dump({"made": int(time.time() * 1000), "rows": rows}, f, separators=(",", ":"))
    print(f"{name}: {len(rows)} stations")


if __name__ == "__main__":
    gauges = all_gauges()
    ids = noaa_usgs_ids([r[0] for r in gauges])
    usgs, found = same_spot(gauges, ids, usgs_gauges(ids))
    print(f"USGS gauges matched to NOAA gauges by place: {len(found)}")
    save("gauges.json", [r + [ids.get(r[0]) or found.get(r[0]) or ""] for r in gauges])
    save("tides.json", tide_stations())
    save("usgs.json", usgs)
