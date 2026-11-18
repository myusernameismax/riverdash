// Data fetcher: started as a port of the widget's contents/code/rivers.py; the web
// app is now the only one that gets new features (USGS-only gauges, skipped hidden tabs).
//
//   fetchPlaces(places) -> {places: [...], time: ms}
//   search(text)        -> {rivers: [...], tides: [...], error?}
//
// A place is {name, river: "<NWPS gauge id or USGS site number>", tide: "<CO-OPS station id>"};
// river and tide are each optional. NOAA gauge ids always have letters (VIDO3), USGS
// site numbers are all digits (14162500): gauges NOAA doesn't carry come from USGS.
// A few state-run gauges are in neither (MLSO3, the Metolius): those are listed in
// data/hads.json and come from NOAA's satellite relay (HADS), see hadsRiver().
//
// Sources (all free, no key, all allow requests straight from a browser):
//   River stage/flow/forecast/flood levels: NOAA National Water Prediction Service
//   Tides: NOAA CO-OPS (Tides & Currents)
//   Flow fallback when NOAA has none (e.g. tidal Willamette at Portland): USGS
//   Gauges NOAA doesn't carry (about half of USGS's, mostly creeks): USGS Water Data
//   State-run gauges in neither (height only): NOAA HADS, read from the Iowa Environmental Mesonet
//   State-run gauges (OWRD, data/owrd.json): the state's own readings, copied hourly by a GitHub job
//     onto the repo's "data" branch; they're new places, or fill in a flow / water temperature
//     that a NOAA, USGS or Mesonet gauge in the app doesn't have (see the OWRD section)
//   Swell + wind forecast for coastal tide stations: Open-Meteo (marine + weather)
//   7-day weather for every place: Open-Meteo (weather)
//
// Responses are cached on the phone (same ages as the widget), so a refresh
// downloads very little. If a download fails, the last copy is used instead.

const NWPS = "https://api.water.noaa.gov/nwps/v1";
const COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const COOPS_STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";
const MARINE = "https://marine-api.open-meteo.com/v1/marine";
const WEATHER = "https://api.open-meteo.com/v1/forecast";
const USGS_LATEST = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items";
const IEM_OBS = "https://mesonet.agron.iastate.edu/api/1/obhistory.json";
const OWRD_FILES = "https://raw.githubusercontent.com/myusernameismax/riverdash/data/";
const UA = "river-tides-web";
const MIN = 60, HOUR = 3600, DAY = 86400;

const CATEGORIES = {  // NWPS floodCategory -> [key, label]
    no_flooding: ["normal", "Normal"], action: ["action", "Action stage"],
    minor: ["minor", "Minor flooding"], moderate: ["moderate", "Moderate flooding"],
    major: ["major", "Major flooding"], obs_not_current: ["stale", "Reading is old"],
};

// ---------------------------------------------------------------- plumbing

// Per fetchPlaces run: downloads that worked / couldn't reach the server (offline check),
// and the newest data used (what "Updated" shows: the last time anything really arrived).
const net = { ok: 0, fail: 0, newest: 0 };
const seen = t => { if (t > net.newest) net.newest = t; };
const offlineError = e => /can't connect|timed out/.test(e && e.message);   // vs. a real "no such data"

// A busy server (HTTP 429 or 5xx, like Open-Meteo's occasional 503) gets one quiet retry.
async function get(url, params, timeout = 25) {
    try { return await getOnce(url, params, timeout); }
    catch (e) {
        if (!/^HTTP Error (429|5\d\d)$/.test(e.message) && !e.busy) throw e;
        await new Promise(r => setTimeout(r, 2500));
        return getOnce(url, params, timeout);
    }
}
async function getOnce(url, params, timeout) {
    if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout * 1000);
    let r;
    try {
        r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl.signal });
    } catch (e) {
        net.fail++;
        throw new Error(e.name === "AbortError" ? "timed out" : "can't connect");
    } finally {
        clearTimeout(timer);
    }
    net.ok++;
    let body = null;
    try { body = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) {
        const e = new Error((body && (body.message || body.reason)) || `HTTP Error ${r.status}`);
        e.busy = r.status === 429 || r.status >= 500;
        e.status = r.status;
        throw e;
    }
    if (body === null) throw new Error("bad response");
    return body;
}

// Small store: the Cache API where the page is https (the real app), else localStorage.
const STORE = "rivertides-data-v1";
let cacheBox = null;
async function box() {
    if (cacheBox === null) {
        try { cacheBox = self.caches ? await caches.open(STORE) : false; } catch (e) { cacheBox = false; }
    }
    return cacheBox;
}
async function readCache(name) {
    try {
        const c = await box();
        if (c) {
            const r = await c.match("/cache/" + name);
            return r ? await r.json() : null;
        }
        const s = localStorage.getItem("rtc:" + name);
        return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
}
async function writeCache(name, data) {
    const entry = { t: Date.now(), data };
    try {
        const c = await box();
        if (c) await c.put("/cache/" + name, new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }));
        else localStorage.setItem("rtc:" + name, JSON.stringify(entry));
    } catch (e) { /* full or blocked: just don't cache */ }
}

// Cached JSON younger than maxAge seconds, else fetch() and store it.
// If the fetch fails, an older cached copy is used rather than nothing.
// savedOnly (see savedPlaces): any saved copy however old, and no downloads.
let savedOnly = false;
async function cached(name, maxAge, fetchFn) {
    const c = await readCache(name);
    if (savedOnly) { if (c) { seen(c.t); return c.data; } throw new Error("nothing saved yet"); }
    if (c && Date.now() - c.t < maxAge * 1000) { seen(c.t); return c.data; }
    let data;
    try {
        data = await fetchFn();
    } catch (e) {
        if (c) { seen(c.t); return c.data; }
        throw e;
    }
    seen(Date.now());
    await writeCache(name, data);
    return data;
}

const ms = iso => Date.parse(iso);
const num = v => (v === null || v === undefined || v <= -900) ? null : v;
const round = (v, n = 0) => { v = v === null || v === undefined || v === "" ? NaN : Number(v); return !isFinite(v) ? null : n === 0 ? Math.round(v) : Math.round(v * 10 ** n) / 10 ** n; };
// Some stations' names come in ALL CAPS ("MID FORK WILLAMETTE R BELOW HILLS CREEK DAM
// NEAR OAKRIDGE"); they're shown like the others: "Mid Fork Willamette R below Hills
// Creek Dam near Oakridge". Names with any lowercase are left as they are.
const SMALL_WORDS = new Set(["at", "near", "nr", "below", "blw", "bl", "above", "abv", "ab", "of", "the", "and",
                             "in", "on", "to", "from", "by", "for", "with", "a", "an", "or"]);
export function tidyName(n) {
    if (typeof n !== "string" || /[a-z]/.test(n) || !/[A-Z]{3}/.test(n)) return n;
    return n.replace(/[A-Z0-9'.]+/g, (w, at) => {
        const before = n.slice(0, at), bare = w.replace(/\./g, "");
        if (/\d/.test(w)) return w;                                         // ids, highway numbers
        if (/[,(]\s*$/.test(before) && bare.length === 2 && /^\s*($|\))/.test(n.slice(at + w.length))) return w;   // ", MD" / "(OR)": a state
        if (/^(USCG|CBBT|USGS|NOAA|USACE)$/.test(bare)) return w;
        if (before.trim() && SMALL_WORDS.has(bare.toLowerCase())) return w.toLowerCase();
        if (bare.length <= 3 && !/[AEIOUY]/.test(bare) && !/^(ST|FT|MT|DR)$/.test(bare)) return w;   // NF, SF, R
        return w.toLowerCase().replace(/(^|[-'.])([a-z])/g, (m, s1, c, i, all) =>
            s1 === "'" && all.length - i <= 2 ? m : s1 + c.toUpperCase())      // O'Brien, but Peter's
            .replace(/^Mc([a-z])/, (m, c) => "Mc" + c.toUpperCase());          // McKenzie
    });
}

function thin(pts, n = 150) {
    if (pts.length <= n) return pts;
    const step = pts.length / n, out = [];
    for (let i = 0; i < n; i++) out.push(pts[Math.floor(i * step)]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
}

// Value in column col of the series point closest to time t (ms).
function valueNear(series, t, col) {
    let best = null;
    for (const p of series) if (p[col] !== null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
    return best && Math.abs(best[0] - t) < 2 * HOUR * 1000 ? best[col] : null;
}

async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
}

// ---------------------------------------------------------------- rivers

// Observed (last 3 days) and forecast (all of it: about 7 days, up to 10 at some gauges) as [ms, stage ft, flow cfs].
// The later days are what NOAA's site calls the forecast trend; the API doesn't mark where it starts.
async function stageflow(lid) {
    const d = await get(`${NWPS}/gauges/${encodeURIComponent(lid)}/stageflow`, null, 60);
    const now = Date.now();
    function rows(part, lo, hi) {
        const p = d[part] || {};
        const k = (p.secondaryUnits || "").toLowerCase() === "kcfs" ? 1000 : 1;
        const out = [];
        for (const r of p.data || []) {
            const t = ms(r.validTime);
            if (lo <= t && t <= hi) {
                const f = num(r.secondary);
                out.push([t, num(r.primary), f === null ? null : Math.round(f * k)]);
            }
        }
        return out.sort((a, b) => a[0] - b[0]);
    }
    return {
        observed: rows("observed", now - 3 * DAY * 1000, now + HOUR * 1000),
        forecast: rows("forecast", now - 6 * HOUR * 1000, now + 10 * DAY * 1000),
    };
}

// Water temperature from the USGS gauge (00010), last 3 days as [ms, °F]. NOAA has no
// temperature forecast, so this is measured data only. null if the gauge has no sensor.
const USGS_CONT = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items";
async function usgsTemp(site) {
    const d = await cached(`usgs-temp-${site}.json`, 30 * MIN, () => get(USGS_CONT, {
        f: "json", monitoring_location_id: `USGS-${site}`, parameter_code: "00010", time: "P3D",
        skipGeometry: "true", properties: "time,value", limit: 2000 }, 40));
    const pts = (d.features || []).map(f => [ms(f.properties.time), parseFloat(f.properties.value)])
        .filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0])
        .map(p => [p[0], round(p[1] * 9 / 5 + 32, 1)]);
    if (!pts.length || Date.now() - pts[pts.length - 1][0] > DAY * 1000) return null;
    const [t, v] = pts[pts.length - 1];
    const before = valueNear(pts, t - 3 * HOUR * 1000, 1);
    return { value: v, time: t, trend: before === null ? null : round(v - before, 1), series: thin(pts) };
}

// Typical flow for each calendar day: the median of that date's daily flows over every
// year the gauge has (USGS statistics; the median, so flood years don't inflate it).
// {"11-11": cfs, ...}; refreshed monthly.
// param: 00060 flow (cfs), 00010 water temperature (°C as USGS keeps it).
async function usgsAverages(site, param = "00060") {
    return cached(param === "00060" ? `usgs-median-${site}.json` : `usgs-median-${param}-${site}.json`, 30 * DAY, async () => {
        const url = `https://waterservices.usgs.gov/nwis/stat/?format=rdb&statReportType=daily&statTypeCd=median&parameterCd=${param}&sites=` + encodeURIComponent(site);
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
        let text;
        try {
            const r = await fetch(url, { signal: ctl.signal });
            if (!r.ok) throw new Error(`HTTP Error ${r.status}`);
            text = await r.text();
        } catch (e) {
            net.fail++;
            throw new Error(e.name === "AbortError" ? "timed out" : e.message.startsWith("HTTP") ? e.message : "can't connect");
        } finally { clearTimeout(timer); }
        net.ok++;
        const out = {};
        let head = null;
        for (const line of text.split("\n")) {
            if (!line || line.startsWith("#")) continue;
            const c = line.split("\t");
            if (!head) { head = c; continue; }
            const m = +c[head.indexOf("month_nu")], dd = +c[head.indexOf("day_nu")], v = parseFloat(c[head.indexOf("p50_va")]);
            if (m && dd && isFinite(v)) out[pad2(m) + "-" + pad2(dd)] = v;
        }
        return out;
    });
}

// USGS discharge (00060) every 15 min for the last 2 days as [[ms, cfs]] ([] if none).
async function usgsFlowSeries(site) {
    const d = await cached(`usgs-q-${site}.json`, 15 * MIN, () => get(USGS_CONT, {
        f: "json", monitoring_location_id: `USGS-${site}`, parameter_code: "00060", time: "P2D",
        skipGeometry: "true", properties: "time,value", limit: 2000 }, 40));
    return (d.features || []).map(f => [ms(f.properties.time), parseFloat(f.properties.value)])
        .filter(p => isFinite(p[0]) && isFinite(p[1]) && p[1] > -999999).sort((a, b) => a[0] - b[0])
        .map(p => [p[0], Math.round(p[1])]);
}
// History (only when someone opens it): flow or water temperature at a USGS gauge over
// a range, plus the typical value for each date (the same medians as "Typical flow").
// 1w: the 15-minute readings; longer: USGS's daily averages (dated at local noon).
// -> {series: [[ms, v]], typical: [[ms, v]]}; temperature in °F.
const USGS_DAILY = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items";
const HIST_SPAN = { "1w": "P7D", "1m": "P30D", "3m": "P90D", "1y": "P1Y", "5y": "P5Y" };
export async function history(site, kind, range) {
    const param = kind === "temp" ? "00010" : "00060", iv = range === "1w";
    const d = await cached(`usgs-hist-${site}-${param}-${range}.json`, iv ? 15 * MIN : 6 * HOUR, () =>
        get(iv ? USGS_CONT : USGS_DAILY, { f: "json", monitoring_location_id: `USGS-${site}`, parameter_code: param,
            ...(iv ? {} : { statistic_id: "00003" }), time: HIST_SPAN[range], skipGeometry: "true",
            properties: "time,value", limit: iv ? 3000 : 5000 }, 60));
    const when = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? new Date(+m[1], m[2] - 1, +m[3], 12).getTime() : ms(s); };
    const conv = v => kind === "temp" ? round(v * 9 / 5 + 32, 1) : Math.round(v);
    const series = (d.features || []).map(f => [when(f.properties.time), parseFloat(f.properties.value)])
        .filter(p => isFinite(p[0]) && isFinite(p[1]) && p[1] > -999).sort((a, b) => a[0] - b[0])
        .map(p => [p[0], conv(p[1])]);
    let typical = [];
    const med = await usgsAverages(site, param).catch(() => null);
    if (med && series.length) {
        const day = new Date(series[0][0]); day.setHours(12, 0, 0, 0);
        for (; day.getTime() <= series[series.length - 1][0] + DAY * 1000; day.setDate(day.getDate() + 1)) {
            const v = med[pad2(day.getMonth() + 1) + "-" + pad2(day.getDate())];
            if (isFinite(v)) typical.push([day.getTime(), conv(v)]);
        }
    }
    return { series, typical };
}

// Latest USGS discharge: real-time (00060) if recent, else tidally filtered daily (72137).
async function usgsFlow(site) {
    const d = await cached(`usgs-${site}.json`, 30 * MIN, () => get(USGS_LATEST, {
        f: "json", monitoring_location_id: `USGS-${site}`, skipGeometry: "true",
        properties: "parameter_code,time,value" }));
    const vals = {};
    for (const f of d.features || []) vals[f.properties.parameter_code] = f.properties;
    for (const [code, note] of [["00060", "USGS"], ["72137", "USGS, tidally filtered"]]) {
        const p = vals[code];
        if (p && p.value !== null && p.value !== "" && p.value !== undefined && Date.now() - ms(p.time) < 3 * DAY * 1000)
            return [Math.round(parseFloat(p.value)), ms(p.time), note];
    }
    return null;
}

// full = false (places list): skips the extras only the details page shows.
// need: which parts are shown ({series, flow, temp}); hidden ones aren't downloaded.
// With height and flow both off, the gauge itself (name, place for the weather) is
// only looked up now and then.
async function river(lid, full = true, need = { series: true, flow: true, temp: true }) {
    lid = lid.trim().toUpperCase();
    const g = await cached(`gauge-${lid}.json`, need.series ? 5 * MIN : 30 * DAY, () => get(`${NWPS}/gauges/${encodeURIComponent(lid)}`));
    if (!("lid" in g)) throw new Error(g.message || `No NOAA gauge ${lid}`);
    // the USGS extras start right away, alongside the history (USGS can take a while);
    // a failed temperature download is undefined (vs. null = this gauge has no sensor)
    const extras = g.usgsId && full ? Promise.all([
        need.temp ? usgsTemp(g.usgsId).catch(() => undefined) : null,
        need.flow ? usgsAverages(g.usgsId).catch(() => null) : null,
    ]) : Promise.resolve([null, null]);
    const sf = need.series ? await cached(`stageflow-${lid}.json`, 3 * HOUR, () => stageflow(lid)) : { observed: [], forecast: [] };
    const obs = (g.status || {}).observed || {};
    const k = (obs.secondaryUnit || "").toLowerCase() === "kcfs" ? 1000 : 1;
    const series = sf.observed.slice();
    let t = (obs.validTime || "0001").startsWith("2") ? ms(obs.validTime) : null;
    let stage = num(obs.primary), flow = num(obs.secondary);
    flow = flow === null ? null : Math.round(flow * k);
    if (t && (!series.length || t > series[series.length - 1][0])) series.push([t, stage, flow]);
    if (!t && series.length) [t, stage, flow] = series[series.length - 1];  // status empty but history exists

    let flowNote = "NOAA", flowTime = t, flowSeries = null, usgsTrend = null;
    const hasFlowSeries = series.some(p => p[2] !== null);
    // No flow from NOAA (e.g. tidal Willamette at Portland): USGS's last 2 days if it has
    // them (the details page; the list only needs the latest), else its latest number.
    if (flow === null && g.usgsId && need.flow) {
        try {
            const s = full ? await usgsFlowSeries(g.usgsId) : [];
            if (s.length > 1) {
                [flowTime, flow] = s[s.length - 1];
                flowNote = "USGS"; flowSeries = thin(s);
                const b = valueNear(s, flowTime - 3 * HOUR * 1000, 1);
                usgsTrend = b === null ? null : flow - b;
            } else {
                const u = await usgsFlow(g.usgsId);
                if (u) [flow, flowTime, flowNote] = u;
            }
        } catch (e) { /* no flow then */ }
    }
    // extras from the USGS gauge; a failure just leaves them out
    let [temp, averages] = await extras;
    const tempTried = temp !== undefined;
    temp = temp || null;
    if (flow === null) averages = null;

    const trend = (col, nowVal) => {
        if (nowVal === null || !t) return null;
        const before = valueNear(series, t - 3 * HOUR * 1000, col);
        return before === null ? null : round(nowVal - before, 2);
    };

    const flood = {};
    for (const [name, c] of Object.entries((g.flood || {}).categories || {}))
        if (num(c.stage) !== null && c.stage > 0) flood[name] = c.stage;
    const cat = CATEGORIES[obs.floodCategory] || ["", ""];
    const fc = sf.forecast.filter(p => p[1] !== null && p[0] > (t || 0));
    const peak = fc.length ? fc.reduce((a, p) => p[1] > a[1] ? p : a) : null;
    return {
        id: lid, name: tidyName(g.name) || lid, time: t,
        lat: g.latitude, lon: g.longitude,
        stage, stageTrend: trend(1, stage),
        flow, flowTime, flowNote, flowNative: flowNote === "NOAA",   // native: flow is part of the gauge's own series (it has a chart)
        flowTrend: hasFlowSeries ? trend(2, flow) : usgsTrend, usgs: g.usgsId || "",
        flowSeries,                // [[ms, cfs]] from USGS when NOAA has no flow, or null
        category: cat[0], categoryLabel: cat[1], flood,
        forecastPeak: peak ? { time: peak[0], stage: peak[1], flow: peak[2] } : null,
        series: thin(series.filter(p => p[0] >= (t || 0) - 2 * DAY * 1000)),
        forecast: thin(fc, 160),   // whole forecast (the chart opens on the first 3 days)
        temp,                      // {value °F, time, trend (3 h), series} or null
        tempTried,                 // false: the temperature download failed (try again later)
        averages,                  // {"MM-DD": typical (median) cfs for that calendar date} or null
    };
}

// A USGS-only gauge, in the same shape as river(): height and flow every 15 min for
// 2 days, water temperature and typical flow like NOAA gauges get. USGS publishes no
// forecast or flood stages, so those parts are empty (the app leaves them out).
export const isUsgs = id => /^\d{8,15}$/.test(String(id || "").trim());
async function usgsRiver(site, full = true, need = { series: true, flow: true, temp: true }) {
    site = site.trim();
    const row = (await usgsGauges().catch(() => [])).find(r => r[0] === site);
    let pts = [];
    if (need.series) {
        const d = await cached(`usgs-iv-${site}.json`, 15 * MIN, () => get(USGS_CONT, {
            f: "json", monitoring_location_id: `USGS-${site}`, parameter_code: "00060,00065", time: "P2D",
            skipGeometry: "true", properties: "time,value,parameter_code", limit: 3000 }, 40));
        const byTime = new Map();
        for (const f of d.features || []) {
            const p = f.properties, t = ms(p.time), v = parseFloat(p.value);
            if (!isFinite(t) || !isFinite(v) || v <= -999) continue;
            const r = byTime.get(t) || [t, null, null];
            if (p.parameter_code === "00065") r[1] = round(v, 2); else if (p.parameter_code === "00060") r[2] = Math.round(v);
            byTime.set(t, r);
        }
        pts = [...byTime.values()].sort((a, b) => a[0] - b[0]);
    }
    if (!row && need.series && !pts.length) throw new Error(`No USGS gauge ${site}`);
    const last = col => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i][col] !== null) return pts[i]; return null; };
    const ls = last(1), lf = last(2), t = pts.length ? pts[pts.length - 1][0] : null;
    const flow = lf ? lf[2] : null;
    const trend = (col, p) => {
        if (!p) return null;
        const b = valueNear(pts, p[0] - 3 * HOUR * 1000, col);
        return b === null ? null : round(p[col] - b, 2);
    };
    let temp = null, averages = null;
    if (full) [temp, averages] = await Promise.all([
        need.temp ? usgsTemp(site).catch(() => undefined) : null,
        flow !== null && need.flow ? usgsAverages(site).catch(() => null) : null,
    ]);
    const tempTried = temp !== undefined;
    temp = temp || null;
    return {
        id: site, name: row ? tidyName(row[1]) : "USGS " + site, time: t,
        lat: row ? row[3] : null, lon: row ? row[4] : null,
        stage: ls ? ls[1] : null, stageTrend: trend(1, ls),
        flow, flowTime: lf ? lf[0] : t, flowNote: "USGS", flowNative: true, flowTrend: trend(2, lf),
        category: "", categoryLabel: "", flood: {}, forecastPeak: null,
        series: thin(pts), forecast: [], temp, tempTried, averages, usgs: site,
    };
}

// A state-run gauge that's in neither NOAA's river service nor USGS's (data/hads.json;
// Oregon Water Resources Department's for now), in the same shape as river(). It sends
// its readings by satellite; NOAA's HADS decodes them and the Iowa Environmental Mesonet
// (IEM) hands them on in a form a browser may read. The same numbers as on NOAA's
// Northwest River Forecast Center pages: height every 15 min, and water temperature
// where the gauge has a sensor. No flow, forecast or flood stages. These are the gauge's
// raw numbers, before the state's own corrections; a temperature water can't have
// (a broken sensor sends −13107 °F, say) is dropped.
let hadsP = null, hads = { by: "", network: "", tz: "", ids: new Map() };
function hadsGauges() {
    return hadsP || (hadsP = fetch("data/hads.json").then(r => { if (!r.ok) throw new Error(`HTTP Error ${r.status}`); return r.json(); })
        .then(j => { hads = { by: String(j.by), network: String(j.network), tz: String(j.tz), ids: new Map(j.rows.map(r => [r[0], r])) }; return j.rows; })
        .catch(e => { hadsP = null; throw e; }));
}
const isHads = id => hadsGauges().then(() => hads.ids.has(id.trim().toUpperCase()), () => false);
// Who runs a river gauge ("NOAA", "USGS", "OWRD"), for the line under a place's stations.
// Where a gauge's own readings are downloaded from ("NOAA", "USGS", "Iowa Mesonet", "OWRD"), for the status lines.
export const sourceOf = id => isOwrd(id) ? "OWRD" : isUsgs(id) ? "USGS" : hads.ids.has(String(id || "").trim().toUpperCase()) ? "Iowa Mesonet" : "NOAA";
export const runBy = id => isOwrd(id) ? "OWRD" : isUsgs(id) ? "USGS" : hads.ids.has(String(id || "").trim().toUpperCase()) ? hads.by : "NOAA";

// ---------------------------------------------------------------- OWRD (the state's own readings)
// data/owrd.json lists the Oregon Water Resources Department gauges worth having. An hourly
// GitHub job (.github/workflows/owrd.yml) downloads each one's last 2 days of flow, height
// and water temperature and publishes one small file per gauge (<station>.json on the repo's
// "data" branch), because OWRD's own pages can't be read from a browser. Rows:
// [station, name, state, lat, lon, has height, has temperature, link, adds]
//   link ""    a place of its own, id "OWRD-<station>" (OWRD station numbers are all digits,
//              like USGS site numbers, so the prefix keeps the two apart)
//   link <id>  the same river spot as a NOAA / USGS / state-run gauge already in the app;
//              `adds` (flow, temp) are the parts that gauge doesn't have: OWRD's are used for
//              those only, so the gauge keeps its own (fresher) height
// A part is looked for on every refresh until it's found, like USGS temperature, and a
// download that fails leaves the gauge as it was. Failures of a place of its own end in a code:
//   OWRD-NET / OWRD-TIMEOUT   couldn't reach GitHub / no answer in 30 s
//   OWRD-HTTP-404             the gauge has no file yet (the job hasn't run since it was added)
//   OWRD-FORMAT               the file isn't in the expected shape
//   OWRD-EMPTY                the file has no readings (the gauge is silent)
//   OWRD-STALE                the readings are over 4 hours old (the hourly job is failing)
export const isOwrd = id => /^OWRD-\d+$/i.test(String(id || "").trim());
let owrdP = null, owrd = { ids: new Map(), links: new Map() };
function owrdGauges() {
    return owrdP || (owrdP = fetch("data/owrd.json").then(r => { if (!r.ok) throw new Error(`HTTP Error ${r.status}`); return r.json(); })
        .then(j => {
            owrd = { ids: new Map(j.rows.filter(r => !r[7]).map(r => ["OWRD-" + r[0], r])),
                     links: new Map(j.rows.filter(r => r[7] && r[8].length).map(r => [r[7].toUpperCase(), r])) };
            return [...owrd.ids].map(([id, r]) => [id, r[1], r[2], r[3], r[4]]);
        }).catch(e => { owrdP = null; throw e; }));
}
function owrdError(e) {
    const m = e && e.message;
    if (navigator.onLine === false && (m === "timed out" || m === "can't connect")) return m;
    return m === "timed out" ? "OWRD's readings didn't arrive in 30 s · OWRD-TIMEOUT"
         : m === "can't connect" ? "couldn't reach OWRD's readings on GitHub · OWRD-NET"
         : e && e.status ? `OWRD's readings answered HTTP ${e.status} · OWRD-HTTP-${e.status}`
         : "OWRD's readings weren't readable · OWRD-FORMAT";
}
// One gauge's file: {made, flow, stage, temp}, each [[ms, value]] (temperature in °F).
function owrdFile(station) {
    return cached(`owrd-${station}.json`, 20 * MIN, async () => {
        const d = await get(OWRD_FILES + station + ".json", null, 30);
        if (!d || !Array.isArray(d.flow)) throw new Error("bad response");
        return d;
    });
}
const owrdPts = a => (Array.isArray(a) ? a : []).filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]));
const owrdTemp = d => {   // like usgsTemp(): nothing if the sensor has been quiet for a day or reads what water can't
    const tw = owrdPts(d.temp).filter(p => p[1] >= 31 && p[1] <= 100);
    if (!tw.length || Date.now() - tw[tw.length - 1][0] > DAY * 1000) return null;
    const [t, v] = tw[tw.length - 1], was = valueNear(tw, t - 3 * HOUR * 1000, 1);
    return { value: round(v, 1), time: t, trend: was === null ? null : round(v - was, 1), series: thin(tw) };
};

// Started alongside a gauge's own download: OWRD's file for a gauge that has parts to add
// (-> {row, d}), or null. Never fails; the gauge just stays as it is.
async function owrdCompanion(id, need) {
    try {
        await owrdGauges();
        const row = owrd.links.get(String(id || "").trim().toUpperCase());
        if (!row || !((need.flow && row[8].includes("flow")) || (need.temp && row[8].includes("temp")))) return null;
        return { row, d: await owrdFile(row[0]) };
    } catch (e) { return null; }
}
function owrdApply(c, r, need) {
    if (!c || !r) return;
    const { row, d } = c;
    if (need.flow && r.flow === null && row[8].includes("flow")) {
        const pts = owrdPts(d.flow);
        if (pts.length && Date.now() - pts[pts.length - 1][0] < DAY * 1000) {
            const [t, v] = pts[pts.length - 1], b = valueNear(pts, t - 3 * HOUR * 1000, 1);
            r.flow = Math.round(v); r.flowTime = t; r.flowNote = "OWRD"; r.flowNative = false;
            r.flowSeries = thin(pts.filter(p => p[0] >= t - 2 * DAY * 1000).map(p => [p[0], Math.round(p[1])]));
            r.flowTrend = b === null ? null : Math.round(v - b);
        }
    }
    if (need.temp && r.temp === null && row[8].includes("temp")) {
        const t = owrdTemp(d);
        if (t) { r.temp = t; r.tempTried = true; r.tempNote = "OWRD"; }
    }
}

// A place of its own, in the same shape as river(): height and flow every 15 min for 2 days,
// and water temperature where the gauge has a sensor. No forecast, flood stages or typical flow.
async function owrdRiver(id, full = true, need = { series: true, flow: true, temp: true }) {
    id = id.trim().toUpperCase();
    await owrdGauges();
    const row = owrd.ids.get(id);
    if (!row) throw new Error(`No OWRD gauge ${id}`);
    let d;
    try { d = await owrdFile(row[0]); } catch (e) { throw new Error(owrdError(e)); }
    const byTime = new Map();
    for (const [col, a] of [[1, d.stage], [2, d.flow]]) for (const p of owrdPts(a)) {
        const r = byTime.get(p[0]) || [p[0], null, null];
        r[col] = col === 1 ? round(p[1], 2) : Math.round(p[1]);
        byTime.set(p[0], r);
    }
    let pts = [...byTime.values()].sort((a, b) => a[0] - b[0]);
    if (!pts.length) throw new Error(`no readings from OWRD gauge ${row[0]} · OWRD-EMPTY`);
    const t = pts[pts.length - 1][0];
    pts = pts.filter(p => p[0] >= t - 2 * DAY * 1000);
    const last = col => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i][col] !== null) return pts[i]; return null; };
    const ls = last(1), lf = last(2);
    const trend = (col, p) => {
        if (!p) return null;
        const b = valueNear(pts, p[0] - 3 * HOUR * 1000, col);
        return b === null ? null : round(p[col] - b, 2);
    };
    const old = Date.now() - (d.made || t);
    return {
        id, name: row[1], time: t, lat: row[3], lon: row[4],
        stage: ls ? ls[1] : null, stageTrend: trend(1, ls),
        flow: lf ? lf[2] : null, flowTime: lf ? lf[0] : t, flowNote: "OWRD", flowNative: true, flowTrend: trend(2, lf),
        category: "", categoryLabel: "", flood: {}, forecastPeak: null,
        series: thin(pts), forecast: [], temp: need.temp ? owrdTemp(d) : null, tempTried: true, averages: null, usgs: "",
        warn: old > 4 * HOUR * 1000 ? `OWRD's readings are ${Math.round(old / HOUR / 1000)} hours old; showing the last ones · OWRD-STALE` : "",
    };
}

// IEM gives one of the station's own calendar days per request: today and the two
// before it ("yyyy-mm-dd", oldest first), and the hour there now.
function stationDays(tz) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric" })
        .formatToParts(new Date())) p[x.type] = +x.value;
    return { hour: p.hour, dates: [2, 1, 0].map(n => new Date(Date.UTC(p.year, p.month - 1, p.day - n)).toISOString().slice(0, 10)) };
}
// Height and water temperature for the last 3 calendar days as [[ms, ft, °F]] (either
// can be null), kept on the phone per day:
// today is downloaded again after 15 min, a finished day once more after it's over
// (the last readings of a day arrive up to an hour or so late), then never again.
// So a refresh is one small request. If a download fails, what's saved is used, and
// the failure is passed along as `warn` so the place still says what went wrong.
// -> {pts, warn}
//
// Every failure on this route ends in a code, so a screenshot is enough to tell what broke:
//   IEM-NET       couldn't reach the Mesonet at all (it's down, or blocked on this network)
//   IEM-TIMEOUT   it didn't answer in 30 s
//   IEM-HTTP-503  it answered with that HTTP status (429 = too many requests, 5xx = trouble on its side,
//                 404 / 422 = the address or its parameters changed)
//   IEM-FORMAT    it answered, but not in the shape expected (the service changed)
//   IEM-EMPTY     it works, but has no height from this gauge for 3 days (the gauge is silent,
//                 was renamed, or was dropped: rerun tools/update-station-lists.py hads)
function iemError(e) {
    const m = e && e.message;
    // (worded so the app's "the phone is offline, don't list every failed download" rule
    // only hides these when the phone itself says it has no connection)
    if (navigator.onLine === false && (m === "timed out" || m === "can't connect")) return m;
    return m === "timed out" ? "the Iowa Mesonet didn't answer in 30 s · IEM-TIMEOUT"
         : m === "can't connect" ? "couldn't reach the Iowa Mesonet · IEM-NET"
         : e && e.status ? `the Iowa Mesonet answered HTTP ${e.status} · IEM-HTTP-${e.status}`
         : "the Iowa Mesonet's answer wasn't readable · IEM-FORMAT";
}
async function hadsSeries(id) {
    const name = `hads-${id}.json`, c = await readCache(name), days = (c && c.data) || {};
    const all = warn => ({ pts: Object.keys(days).sort().flatMap(d => days[d].pts), warn });
    if (savedOnly) { if (!c) throw new Error("nothing saved yet"); seen(c.t); return all(); }
    const { hour, dates } = stationDays(hads.tz), today = dates[2];
    for (const d of Object.keys(days)) if (!dates.includes(d)) delete days[d];
    const todo = dates.filter(d => !days[d] || !(days[d].done || Date.now() - days[d].t < 15 * MIN * 1000));
    let failed = null, got = 0;
    await Promise.all(todo.map(async d => {
        try {
            const j = await get(IEM_OBS, { station: id, network: hads.network, date: d }, 30);
            if (!Array.isArray(j.data)) throw new Error("bad response");
            const pts = [];
            for (const r of j.data) {
                // "2026-11-16T08:00Z"; HGIRGZZ = height (HG), TWIRGZZ = water temperature (TW, °F):
                // instantaneous (I), from the gauge's own sensor by satellite (RG)
                const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(r && r.utc_valid);
                const ok = (v, lo, hi) => typeof v === "number" && isFinite(v) && v > lo && v < hi;
                const h = m && ok(r.HGIRGZZ, -900, 10000) ? round(r.HGIRGZZ, 2) : null;
                const w = m && ok(r.TWIRGZZ, 31, 100) ? round(r.TWIRGZZ, 1) : null;     // liquid water only
                if (h !== null || w !== null) pts.push([Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]), h, w]);
            }
            days[d] = { t: Date.now(), done: d < today && (d < dates[1] || hour >= 2), pts: pts.sort((a, b) => a[0] - b[0]) };
            got++;
        } catch (e) { failed = e; }
    }));
    if (failed && !Object.keys(days).length) throw new Error(iemError(failed));
    if (got) await writeCache(name, days);
    seen(failed ? (c ? c.t : 0) : days[today] ? days[today].t : Date.now());
    return all(failed ? iemError(failed) : "");
}
async function hadsRiver(id, full = true, need = { series: true, temp: true }) {
    id = id.trim().toUpperCase();
    const row = hads.ids.get(id);
    const { pts: all, warn } = need.series || need.temp ? await hadsSeries(id) : { pts: [], warn: "" };
    let pts = need.series ? all.filter(p => p[1] !== null).map(p => [p[0], p[1], null]) : [];
    if (need.series && !pts.length) throw new Error(warn || `no height from ${hads.by} gauge ${id} in 3 days · IEM-EMPTY`);
    const last = pts.length ? pts[pts.length - 1] : null, t = last ? last[0] : null;
    pts = pts.filter(p => p[0] >= t - 2 * DAY * 1000);
    const before = last ? valueNear(pts, t - 3 * HOUR * 1000, 1) : null;
    // like usgsTemp(): nothing if the sensor has been quiet for a day
    let temp = null;
    const tw = need.temp ? all.filter(p => p[2] !== null).map(p => [p[0], p[2]]) : [];
    if (tw.length && Date.now() - tw[tw.length - 1][0] < DAY * 1000) {
        const [wt, wv] = tw[tw.length - 1], was = valueNear(tw, wt - 3 * HOUR * 1000, 1);
        temp = { value: wv, time: wt, trend: was === null ? null : round(wv - was, 1), series: thin(tw) };
    }
    return {
        id, name: tidyName(row[1]) || id, time: t, lat: row[3], lon: row[4],
        stage: last ? last[1] : null, stageTrend: before === null ? null : round(last[1] - before, 2),
        flow: null, flowTime: t, flowNote: hads.by, flowNative: true, flowTrend: null,
        category: "", categoryLabel: "", flood: {}, forecastPeak: null,
        series: thin(pts), forecast: [], temp, tempTried: true, averages: null, usgs: "",
        warn,                      // "" or why the latest download failed (the saved readings are shown)
    };
}

// ---------------------------------------------------------------- station lists (for search)

// Shipped with the app (data/*.json, made by tools/update-station-lists.py) so the
// first search is instant. If the shipped copy is over `fresh` days old, a new
// one is downloaded from NOAA instead (falls back to the shipped copy).
async function shippedList(file, fresh, fetchLive) {
    const r = await fetch(file, { cache: "no-cache" }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (r && Date.now() - r.made < fresh * DAY * 1000) return r.rows;
    try { return await fetchLive(); } catch (e) { if (r) return r.rows; throw e; }
}

let tideList = null;
function tideStations() {
    return tideList || (tideList = cached("tide-stations-v2.json", 90 * DAY, () =>
        shippedList("data/tides.json", 90, async () =>
            (await get(COOPS_STATIONS, null, 60)).stations.map(x => [x.id, x.name, x.state || "", x.lat, x.lng])))
        .catch(e => { tideList = null; throw e; }));
}

// Every NOAA river gauge as [lid, name, state, lat, lon]. The API times out on one huge
// box, so ask for 10-degree longitude strips in parallel.
async function allGaugesLive() {
    const strips = [];
    for (let x = -180; x < -60; x += 10) strips.push([x, x + 10]);
    strips.push([130, 180]);
    const parts = await pool(strips, 6, b => get(`${NWPS}/gauges`, {
        "bbox.xmin": b[0], "bbox.ymin": -20, "bbox.xmax": b[1], "bbox.ymax": 75, srid: "EPSG_4326" }, 90).then(d => d.gauges));
    const byId = {};
    for (const part of parts) for (const g of part) byId[g.lid] = g;
    return Object.values(byId)
        .map(g => [g.lid, g.name, (g.state || {}).abbreviation || "", g.latitude, g.longitude])
        .sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
}
let gaugeList = null;
function allGauges() {
    return gaugeList || (gaugeList = cached("all-gauges-v3.json", 180 * DAY, () =>
        shippedList("data/gauges.json", 180, allGaugesLive))
        .catch(e => { gaugeList = null; throw e; }));
}
// USGS gauges NOAA doesn't carry, as [site, name, state, lat, lon]: shipped only
// (data/usgs.json, from tools/update-station-lists.py), saved offline with the app.
let usgsRowsP = null;
function usgsGauges() {
    return usgsRowsP || (usgsRowsP = fetch("data/usgs.json").then(r => { if (!r.ok) throw new Error(`HTTP Error ${r.status}`); return r.json(); })
        .then(j => j.rows).catch(e => { usgsRowsP = null; throw e; }));
}
// Start loading the lists before the first keystroke.
export function warmSearch() { allGauges().catch(() => {}); tideStations().catch(() => {}); usgsGauges().catch(() => {}); hadsGauges().catch(() => {}); owrdGauges().catch(() => {}); }

// ---------------------------------------------------------------- tides

async function coops(sid, params) {
    const d = await get(COOPS, { station: sid, datum: "MLLW", units: "english", time_zone: "gmt",
                                 format: "json", application: UA, ...params });
    if (d.error) throw new Error(d.error.message || "CO-OPS error");
    return d;
}

const pad2 = n => String(n).padStart(2, "0");
function gmtStamp(d) {  // "yyyymmdd HH:MM" in GMT
    return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
function gmtMs(s) {  // "2026-11-09 21:00" (GMT)
    const [d, t] = s.split(" "), [y, mo, da] = d.split("-").map(Number), [h, mi] = t.split(":").map(Number);
    return Date.UTC(y, mo - 1, da, h, mi);
}

async function tide(sid) {
    sid = sid.trim();
    const begin = gmtStamp(new Date(Date.now() - 12 * HOUR * 1000));

    const predictions = async (interval, hours) => {
        const d = await coops(sid, { product: "predictions", interval, begin_date: begin, range: hours });
        return d.predictions.map(p => [gmtMs(p.t), round(parseFloat(p.v), 2), p.type === "H" || p.type === "L" ? p.type : ""]);
    };

    const hilo = await cached(`tide-hilo8d-${sid}.json`, 6 * HOUR, () => predictions("hilo", 8 * 24));  // 8 days: week list

    // Subordinate stations (e.g. 9435385 Yaquina USCG) only publish high/low times,
    // not a 15-min series, so draw the curve between them with cosine interpolation
    // (the method NOAA uses for these stations).
    const curveFromHilo = () => {
        const out = [], step = 15 * MIN * 1000;
        for (let i = 0; i + 1 < hilo.length; i++) {
            const [t0, v0] = hilo[i], [t1, v1] = hilo[i + 1];
            let t = t0 - (t0 % step) + (t0 % step ? step : 0);
            while (t < t1) {
                const f = (1 - Math.cos(Math.PI * (t - t0) / (t1 - t0))) / 2;
                out.push([t, round(v0 + (v1 - v0) * f, 2), ""]);
                t += step;
            }
        }
        return out;
    };

    const curve = await cached(`tide-curve-${sid}.json`, 6 * HOUR, async () => {
        try { return await predictions("15", 48); } catch (e) { if (offlineError(e)) throw e; return curveFromHilo(); }
    });

    // Live water level, if the station has a sensor. Many (e.g. Portland) are prediction-only;
    // remember that for 12 hours so we don't keep asking.
    let obs = null;
    const wl = await readCache(`tide-obs-${sid}.json`);
    if (wl && wl.data && wl.data.none && Date.now() - wl.t < 12 * HOUR * 1000) obs = false;
    if (obs === null) {
        try {
            const d = await cached(`tide-obs-${sid}.json`, 6 * MIN, () => coops(sid, { product: "water_level", date: "latest" }));
            if (d.none) obs = false;
            else {
                const p = d.data[d.data.length - 1];
                obs = [gmtMs(p.t), round(parseFloat(p.v), 2)];
            }
        } catch (e) {
            obs = false;
            if (!savedOnly && !offlineError(e)) await writeCache(`tide-obs-${sid}.json`, { none: true });
        }
    }

    const now = Date.now();
    const predicted = t => {
        for (let i = 0; i + 1 < curve.length; i++) {
            const a = curve[i], b = curve[i + 1];
            if (a[0] <= t && t <= b[0]) return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
        }
        return null;
    };
    const predNow = predicted(now), later = predicted(now + 15 * MIN * 1000);
    const live = !!obs && now - obs[0] < HOUR * 1000;
    const events = hilo.map(([t, v, ty]) => ({ time: t, height: v, type: ty }));
    const st = (await tideStations().catch(() => [])).find(s => s[0] === sid);
    const past = events.filter(e => e.time <= now);
    return {
        id: sid, name: st ? tidyName(st[1]) : sid, lat: st ? st[3] : null, lon: st ? st[4] : null,
        height: live ? obs[1] : (predNow !== null ? round(predNow, 2) : null),
        live, time: live ? obs[0] : now,
        rising: predNow === null || later === null ? null : later > predNow,
        next: events.filter(e => e.time > now).slice(0, 4),
        previous: past.length ? past[past.length - 1] : null,
        // chart opens on -6 h..+24 h; the extra lets you zoom out (data is already fetched)
        curve: curve.filter(p => now - 12 * HOUR * 1000 <= p[0] && p[0] <= now + 36 * HOUR * 1000).map(p => [p[0], p[1]]),
        events: events.filter(e => now - 12 * HOUR * 1000 <= e.time && e.time <= now + 36 * HOUR * 1000),
        week: events.filter(e => now - 24 * HOUR * 1000 <= e.time && e.time <= now + 7 * DAY * 1000),
        // whole week as a curve (cosine between the highs/lows), for looking at a future day
        weekCurve: thin(curveFromHilo().filter((p, i) => i % 2 === 0)
            .filter(p => now - 24 * HOUR * 1000 <= p[0] && p[0] <= now + 7 * DAY * 1000).map(p => [p[0], p[1]]), 400),
    };
}

// ---------------------------------------------------------------- swell (coastal tide stations)

function km(lat1, lon1, lat2, lon2) {
    const r = x => x * Math.PI / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

// Is this tide station on the open coast? A station counts as coastal when
// Open-Meteo's wave model has data within 30 km (Portland and other inland
// tidal rivers get nothing). Checked once, then remembered for 90 days.
function surfSpot(sid) {
    return cached(`surf-spot-${sid}.json`, 90 * DAY, async () => {
        const st = (await get(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${encodeURIComponent(sid)}.json`)).stations[0];
        const lat = parseFloat(st.lat), lon = parseFloat(st.lng);
        const m = await get(MARINE, { latitude: lat, longitude: lon, hourly: "wave_height", forecast_days: 1, cell_selection: "sea" });
        const ok = m.hourly.wave_height.some(v => v !== null) && km(lat, lon, m.latitude, m.longitude) < 30;
        return { lat, lon, coastal: ok };
    });
}

// Hourly swell + wind, 12 h back to 7 days ahead, for a coastal tide station; null inland.
// hours: [ms, wave ft, period s, wave dir, swell ft, swell period s, swell dir, wind mph, gust mph, wind dir]
async function surf(sid) {
    sid = sid.trim();
    const spot = await surfSpot(sid);
    if (!spot.coastal) return null;
    const d = await cached(`surf-${sid}.json`, 3 * HOUR, async () => {
        const common = { latitude: spot.lat, longitude: spot.lon, timeformat: "unixtime",
                         past_days: 1, forecast_days: 7, timezone: "GMT" };
        const [m, w] = await Promise.all([
            get(MARINE, { ...common, cell_selection: "sea", length_unit: "imperial",
                          hourly: "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction" }),
            get(WEATHER, { ...common, wind_speed_unit: "mph", daily: "sunrise,sunset",
                           hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m" }),
        ]);
        return { marine: m.hourly, wind: w.hourly, daily: w.daily };
    });
    const m = d.marine, w = d.wind;
    const wind = {};
    w.time.forEach((t, i) => { wind[t] = [w.wind_speed_10m[i], w.wind_gusts_10m[i], w.wind_direction_10m[i]]; });
    const now = Date.now() / 1000;
    const hours = [];
    m.time.forEach((t, i) => {
        if (!(now - 12 * HOUR <= t && t <= now + 7 * DAY) || m.wave_height[i] === null) return;
        const [ws, wg, wd] = wind[t] || [null, null, null];
        hours.push([t * 1000, round(m.wave_height[i], 1), round(m.wave_period[i], 1), m.wave_direction[i],
                    round(m.swell_wave_height[i], 1), round(m.swell_wave_period[i], 1), m.swell_wave_direction[i],
                    round(ws), round(wg), wd]);
    });
    return { hours, daylight: d.daily.sunrise.map((a, i) => [a * 1000, d.daily.sunset[i] * 1000]) };
}

// ---------------------------------------------------------------- weather (every place)

// Current conditions + 7 days for a point (°F, mph, inches, WMO weather codes).
// now:   {temp, feels, code, day (bool), wind, gust, windDir}
// days:  [local-midnight ms, code, hi °F, lo °F, rain chance %, rain in, wind mph, gust mph, wind dir°, sunrise ms, sunset ms]
// hours: [ms, temp °F, code, rain chance %, rain in, wind mph, gust mph, daylight (bool)]
// Places close together share one download: a saved forecast for a point within 10 km
// (under an hour old) is used as is. If the download fails, the nearest saved one
// within 30 km stands in. Saved points are listed in WX_INDEX.
const WX_INDEX = "rt:wx-points";
const wxPoints = () => { try { return JSON.parse(localStorage.getItem(WX_INDEX) || "[]"); } catch (e) { return []; } };
function nearestWx(lat, lon, maxKm, maxAgeMs) {
    let best = null;
    for (const [la, lo, t] of wxPoints()) {
        const d = km(lat, lon, la, lo);
        if (d <= maxKm && Date.now() - t < maxAgeMs && (!best || d < best.d)) best = { d, key: `weather2-${la}_${lo}.json` };
    }
    return best;
}
function rememberWx(lat, lon) {
    try {
        const pts = wxPoints().filter(p => !(p[0] === lat && p[1] === lon) && Date.now() - p[2] < 30 * DAY * 1000);
        pts.push([lat, lon, Date.now()]);
        localStorage.setItem(WX_INDEX, JSON.stringify(pts.slice(-100)));
    } catch (e) { /* fine */ }
}
const fetchWeather = (lat, lon) => get(WEATHER, {
    latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime", forecast_days: 7,
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max," +
           "precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
    hourly: "temperature_2m,weather_code,precipitation_probability,precipitation," +
            "wind_speed_10m,wind_gusts_10m,is_day" });
async function weatherData(lat, lon) {
    const key = `weather2-${lat}_${lon}.json`;
    if (savedOnly) return cached(key, HOUR, null);
    const own = await readCache(key);
    if (own && Date.now() - own.t < HOUR * 1000) { seen(own.t); return own.data; }
    const near = nearestWx(lat, lon, 10, HOUR * 1000), nc = near && await readCache(near.key);
    if (nc && Date.now() - nc.t < HOUR * 1000) { seen(nc.t); return nc.data; }
    try {
        const d = await fetchWeather(lat, lon);
        seen(Date.now()); await writeCache(key, d); rememberWx(lat, lon);
        return d;
    } catch (e) {
        if (own) { seen(own.t); return own.data; }
        const far = nearestWx(lat, lon, 30, 30 * DAY * 1000), fc = far && await readCache(far.key);
        if (fc) { seen(fc.t); return fc.data; }
        throw e;
    }
}
// Models now and then call an hour snow at 40 °F+ (HRRR/GFS, a heavy downpour), and the
// day takes its worst hour, so a 46 °F rainy day read "Heavy snow". Too warm to snow
// at the place: the rain of the same strength.
const SNOW_AS_RAIN = { 71: 61, 73: 63, 75: 65, 77: 61, 85: 80, 86: 81 };
const wxCode = (code, tempF) => round(tempF >= 40 && SNOW_AS_RAIN[round(code)] || code);
async function weather(lat, lon) {
    lat = round(parseFloat(lat), 2); lon = round(parseFloat(lon), 2);   // ~1 km; also the cache key
    const d = await weatherData(lat, lon);
    const c = d.current, w = d.daily, h = d.hourly || {};
    return {
        now: c ? { time: c.time ? c.time * 1000 : Date.now(), temp: round(c.temperature_2m), feels: round(c.apparent_temperature),
                   code: wxCode(c.weather_code, c.temperature_2m), day: !!(c.is_day ?? 1),
                   wind: round(c.wind_speed_10m), gust: round(c.wind_gusts_10m), windDir: c.wind_direction_10m } : null,
        days: w.time.map((t, i) => [t * 1000, wxCode(w.weather_code[i], w.temperature_2m_min[i]), round(w.temperature_2m_max[i]), round(w.temperature_2m_min[i]),
            round(w.precipitation_probability_max[i]), round(w.precipitation_sum[i], 2), round(w.wind_speed_10m_max[i]),
            round(w.wind_gusts_10m_max[i]), round(w.wind_direction_10m_dominant[i]),
            w.sunrise[i] ? +w.sunrise[i] * 1000 : null, w.sunset[i] ? +w.sunset[i] * 1000 : null]),
        hours: (h.time || []).map((t, i) => [t * 1000, round(h.temperature_2m[i]), wxCode(h.weather_code[i], h.temperature_2m[i]),
            round(h.precipitation_probability[i]), round(h.precipitation[i], 2), round(h.wind_speed_10m[i]),
            round(h.wind_gusts_10m[i]), !!h.is_day[i]]),
    };
}

// ---------------------------------------------------------------- commands

const title = s => s[0].toUpperCase() + s.slice(1);

// full = false: what the places list needs (readings, mini graph, jetty color) without
// weather, water temperature or typical flow. light marks such a result.
//
// Parts switched off in Customize (p.hide) aren't downloaded; whatever was saved
// stays saved, so switching one back on soon after shows it right away.
// asked: the parts that were really looked for (so the app can tell "this station
// has no water temperature" from "not downloaded").
// onPart(snapshot) runs as parts arrive (river / tide, then waves), so a slow weather or
// wave download doesn't keep the readings off the screen; parts not there yet are
// left out of the snapshot (undefined), not null.
async function place(p, full = true, onPart) {
    const out = { key: (p.river || "") + "|" + (p.tide || ""), river: null, tide: null, errors: [], light: !full, asked: [] };
    const off = m => Array.isArray(p.hide) && p.hide.includes(m);
    const need = { series: !off("stage") || !off("flow"), flow: !off("flow"), temp: !off("temp") && full };
    const tasks = [];
    const riverFn = async id => isOwrd(id) ? owrdRiver : isUsgs(id) ? usgsRiver : await isHads(id) ? hadsRiver : river;
    // OWRD's file for a gauge that has parts to add starts downloading along with the gauge itself
    const comp = p.river && !isOwrd(p.river) ? owrdCompanion(p.river, need) : null;
    if (p.river) tasks.push(riverFn(p.river).then(fn => fn(p.river, full, need)).then(async r => { owrdApply(await comp, r, need); return r; }).then(r => {
        out.river = r;
        if (r.warn) out.errors.push(`River ${p.river}: ${r.warn}`);
        if (need.series) out.asked.push("stage", "flow");
        if (need.temp && r.tempTried !== false) out.asked.push("temp");   // a failed download doesn't mean "no sensor"
    }, e => { out.errors.push(`River ${p.river}: ${e.message}`); }));
    if (p.tide && !off("tide")) tasks.push(tide(p.tide).then(t => { out.tide = t; out.asked.push("tide"); },
        e => { out.errors.push(`Tide ${p.tide}: ${e.message}`); }));
    await Promise.all(tasks);
    const part = () => { if (onPart) onPart({ ...out, errors: [...out.errors], asked: [...out.asked], partial: true }); };
    part();
    if (p.tide && !off("surf")) {
        try { out.surf = await surf(p.tide); out.asked.push("surf"); } catch (e) { out.surf = null; out.errors.push(`Swell forecast: ${e.message}`); }
        if (full) part();
    }
    // weather at the river gauge, else at the tide station
    out.weather = null;
    if (full) try {
        const r = out.river;
        if (r && r.lat !== null && r.lat !== undefined) out.weather = await weather(r.lat, r.lon);
        else if (p.tide) {
            const s = await surfSpot(p.tide.trim());
            out.weather = await weather(s.lat, s.lon);
        }
    } catch (e) { out.errors.push(`Weather: ${e.message}`); }
    return out;
}

// Same as fetchPlaces, but only from what's saved on the phone: instant, no network.
// Used at startup so the last readings show while fresh ones download.
export async function savedPlaces(places) {
    savedOnly = true;
    try { return await fetchPlaces(places); } finally { savedOnly = false; }
}

// offline: nothing could be downloaded (the saved copies were used instead).
// downloads: how many requests went out (0 = everything was still fresh in the cache).
// fullKeys: a Set of place keys that get everything (the rest get the list's part),
// or undefined = all of them. 4 places at a time: all at once would queue in the
// browser anyway, and one by one is much slower.
export async function fetchPlaces(places, fullKeys, onPart) {
    net.ok = net.fail = net.newest = 0;
    const out = await pool(places, 4, p => place(p, !fullKeys || fullKeys.has((p.river || "") + "|" + (p.tide || "")), onPart));
    const offline = navigator.onLine === false || (net.fail > 0 && net.ok === 0);
    return { places: out, time: net.newest || Date.now(), offline, downloads: net.ok + net.fail };
}

// Search index: lower-cased words of "id name state", built once per list.
const indexes = new WeakMap();
function indexOf(rows) {
    let ix = indexes.get(rows);
    if (!ix) {
        ix = rows.map(r => (`${r[0]} ${r[1]} ${r[2]} ${r[5] || ""}`.toLowerCase().match(/[a-z0-9]+/g) || []));
        indexes.set(rows, ix);
    }
    return ix;
}

// River gauges for search: NOAA's (with forecasts), the USGS ones NOAA doesn't carry
// and the state-run ones neither has, as one list (kept, so its search index is built
// once). A state-run gauge NOAA's list has picked up since is found as NOAA's only.
let riverCache = null;
async function riverRows() {
    const [a, b, c, o] = await Promise.all([allGauges(), usgsGauges().catch(() => []), hadsGauges().catch(() => []), owrdGauges().catch(() => [])]);
    if (!riverCache || riverCache.a !== a || riverCache.b !== b || riverCache.c !== c || riverCache.o !== o) {
        const noaa = new Set(a.map(r => r[0]));
        riverCache = { a, b, c, o, rows: a.concat(b, c.filter(r => !noaa.has(r[0])), o) };
    }
    return riverCache.rows;
}

// The state of each river gauge in `ids` (from the station lists), for telling apart
// rivers with the same name ("Deschutes" in Oregon and in Washington).
export async function gaugeStates(ids) {
    const want = new Set(ids), out = {};
    for (const r of await riverRows()) if (want.has(r[0]) && r[2]) out[r[0]] = r[2];
    return out;
}

export async function search(text) {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    if (!words.length) return { rivers: [], tides: [] };
    const hits = (rows, kind) => {
        const ix = indexOf(rows), out = [];
        // every search word starts some word of "id name state"
        rows.forEach((r, i) => {
            if (words.every(w => ix[i].some(h => h.startsWith(w))))
                out.push({ kind, id: r[0], name: tidyName(r[1].trim()), state: r[2], lat: r[3], lon: r[4], usgs: r[5] || (isUsgs(r[0]) ? r[0] : ""),
                           by: hads.ids.get(r[0]) === r ? hads.by : owrd.ids.has(r[0]) ? "OWRD" : "" });   // by: a state-run gauge's agency
        });
        // names that start with the first word (or exact ids) first
        const k = r => [r.id.toLowerCase() !== words[0] && r.usgs !== words[0] ? 1 : 0, r.name.toLowerCase().startsWith(words[0]) ? 0 : 1];
        out.sort((a, b) => { const ka = k(a), kb = k(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
        return out.slice(0, 20);
    };
    const out = {};
    for (const [key, kind, rows] of [["rivers", "river", riverRows], ["tides", "tide", tideStations]]) {
        try { out[key] = hits(await rows(), kind); }
        catch (e) { out[key] = []; out.error = `${title(kind)} search failed: ${e.message}`; }
    }
    return out;
}
