#!/usr/bin/env python3
"""Hourly job: download the last 2 days of flow, height and water temperature for every
gauge in data/owrd.json from the Oregon Water Resources Department and write one small
file per gauge into OUT (default ./out): <id>.json = {id, made, flow, stage, temp},
each series a list of [epoch ms, value] (temperature in °F).
A gauge that fails keeps its previous file, so one bad answer never blanks a gauge.
Exit 1 only if nothing worked."""
import csv, io, json, sys, time
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener
from zoneinfo import ZoneInfo

PAGE = "https://apps.wrd.state.or.us/apps/sw/hydro_near_real_time/display_hydro_graph.aspx"
TZ = ZoneInfo("America/Los_Angeles")
UA = "river-tides-web (github.com/myusernameismax/riverdash)"
DATASETS = {"flow": "Instantaneous_Flow", "stage": "Instantaneous_Stage", "temp": "WTEMP15"}


class Hidden(HTMLParser):
    def __init__(self):
        super().__init__(); self.v = {}
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "input" and (a.get("type") or "").lower() == "hidden" and a.get("name"):
            self.v[a["name"]] = a.get("value") or ""


def series(text, kind):
    rows = csv.reader(io.StringIO(text), delimiter="\t")
    next(rows, None)
    out = []
    for r in rows:
        if len(r) < 3:
            continue
        try:
            t = datetime.strptime(r[1].strip(), "%m-%d-%Y %H:%M").replace(tzinfo=TZ)
            v = float(r[2])
        except ValueError:
            continue
        if kind == "temp":
            v = v * 9 / 5 + 32
        out.append([int(t.timestamp() * 1000), round(v, 2 if kind == "stage" else 1)])
    return sorted(out)


def fetch_gauge(sid, kinds, start, end):
    op = build_opener(HTTPCookieProcessor(CookieJar()))
    url = f"{PAGE}?{urlencode({'station_nbr': sid})}"
    p = Hidden(); p.feed(op.open(Request(url, headers={"User-Agent": UA}), timeout=40).read().decode("utf-8-sig"))
    if not p.v.get("__VIEWSTATE"):
        raise RuntimeError("no form state")
    res = {}
    for kind in kinds:
        f = dict(p.v)
        f.update({"__EVENTTARGET": "", "__EVENTARGUMENT": "",
                  "ctl00$PageData$tb_start_date": start.strftime("%m/%d/%Y"),
                  "ctl00$PageData$tb_end_date": end.strftime("%m/%d/%Y"),
                  "ctl00$PageData$ddl_data_source": DATASETS[kind],
                  "ctl00$PageData$ddl_download_format": "tsv",
                  "ctl00$PageData$btn_download": "Download Data"})
        r = op.open(Request(url, data=urlencode(f).encode(), headers={"Referer": url, "User-Agent": UA}), timeout=40)
        if "attachment" not in r.headers.get("Content-Disposition", "").lower():
            raise RuntimeError(f"{kind}: no attachment")
        res[kind] = series(r.read().decode("utf-8-sig"), kind)
        time.sleep(0.3)
    return res


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "out"); out.mkdir(parents=True, exist_ok=True)
    rows = json.load(open(Path(__file__).resolve().parent.parent / "data" / "owrd.json"))["rows"]
    end = datetime.now(TZ).date(); start = end - timedelta(days=1)
    ok = 0
    for r in rows:
        sid, has_stage, has_temp = r[0], r[5], r[6]
        kinds = ["flow"] + (["stage"] if has_stage else []) + (["temp"] if has_temp else [])
        try:
            d = fetch_gauge(sid, kinds, start, end)
            if not d.get("flow"):
                raise RuntimeError("flow empty")
            d.update(id=sid, made=int(time.time() * 1000))
            (out / f"{sid}.json").write_text(json.dumps(d, separators=(",", ":")))
            ok += 1
        except Exception as e:  # keep the previous file
            print(f"{sid}: {e}", file=sys.stderr)
        time.sleep(0.3)
    print(f"{ok} of {len(rows)} gauges updated")
    (out / "index.json").write_text(json.dumps({"made": int(time.time() * 1000), "ok": ok, "of": len(rows)}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
