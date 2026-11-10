// Data fetcher: a straight port of the widget's contents/code/rivers.py.
//
//   fetchPlaces(places) -> {places: [...], time: ms}
//   search(text)        -> {rivers: [...], tides: [...], error?}
//
// A place is {name, river: "<NWPS gauge id>", tide: "<CO-OPS station id>"};
// river and tide are each optional.
//
// Sources (all free, no key, all allow requests straight from a browser):
//   River stage/flow/forecast/flood levels: NOAA National Water Prediction Service
//   Tides: NOAA CO-OPS (Tides & Currents)
//   Flow fallback when NOAA has none (e.g. tidal Willamette at Portland): USGS
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
const UA = "river-tides-web";
const MIN = 60, HOUR = 3600, DAY = 86400;

const CATEGORIES = {  // NWPS floodCategory -> [key, label]
    no_flooding: ["normal", "Normal"], action: ["action", "Action stage"],
    minor: ["minor", "Minor flooding"], moderate: ["moderate", "Moderate flooding"],
    major: ["major", "Major flooding"], obs_not_current: ["stale", "Reading is old"],
};

// ---------------------------------------------------------------- plumbing

async function get(url, params, timeout = 25) {
    if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout * 1000);
    let r;
    try {
        r = await fetch(url, { headers: { Accept: "application/json" }, signal: ctl.signal });
    } catch (e) {
        throw new Error(e.name === "AbortError" ? "timed out" : "can't connect");
    } finally {
        clearTimeout(timer);
    }
    let body = null;
    try { body = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) throw new Error((body && body.message) || `HTTP Error ${r.status}`);
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
async function cached(name, maxAge, fetchFn) {
    const c = await readCache(name);
    if (c && Date.now() - c.t < maxAge * 1000) return c.data;
    let data;
    try {
        data = await fetchFn();
    } catch (e) {
        if (c) return c.data;
        throw e;
    }
    await writeCache(name, data);
    return data;
}

const ms = iso => Date.parse(iso);
const num = v => (v === null || v === undefined || v <= -900) ? null : v;
const round = (v, n = 0) => { v = v === null || v === undefined || v === "" ? NaN : Number(v); return !isFinite(v) ? null : n === 0 ? Math.round(v) : Math.round(v * 10 ** n) / 10 ** n; };

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

// Observed (last 3 days) and forecast (next 5 days) as [ms, stage ft, flow cfs].
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
        forecast: rows("forecast", now - 6 * HOUR * 1000, now + 5 * DAY * 1000),
    };
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

async function river(lid) {
    lid = lid.trim().toUpperCase();
    const g = await cached(`gauge-${lid}.json`, 5 * MIN, () => get(`${NWPS}/gauges/${encodeURIComponent(lid)}`));
    if (!("lid" in g)) throw new Error(g.message || `No NOAA gauge ${lid}`);
    const sf = await cached(`stageflow-${lid}.json`, 3 * HOUR, () => stageflow(lid));
    const obs = (g.status || {}).observed || {};
    const k = (obs.secondaryUnit || "").toLowerCase() === "kcfs" ? 1000 : 1;
    const series = sf.observed.slice();
    let t = (obs.validTime || "0001").startsWith("2") ? ms(obs.validTime) : null;
    let stage = num(obs.primary), flow = num(obs.secondary);
    flow = flow === null ? null : Math.round(flow * k);
    if (t && (!series.length || t > series[series.length - 1][0])) series.push([t, stage, flow]);
    if (!t && series.length) [t, stage, flow] = series[series.length - 1];  // status empty but history exists

    let flowNote = "NOAA", flowTime = t;
    const hasFlowSeries = series.some(p => p[2] !== null);
    if (flow === null && g.usgsId) {
        try {
            const u = await usgsFlow(g.usgsId);
            if (u) [flow, flowTime, flowNote] = u;
        } catch (e) { /* no flow then */ }
    }

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
        id: lid, name: g.name || lid, time: t,
        lat: g.latitude, lon: g.longitude,
        stage, stageTrend: trend(1, stage),
        flow, flowTime, flowNote,
        flowTrend: hasFlowSeries ? trend(2, flow) : null,
        category: cat[0], categoryLabel: cat[1], flood,
        forecastPeak: peak ? { time: peak[0], stage: peak[1], flow: peak[2] } : null,
        series: thin(series.filter(p => p[0] >= (t || 0) - 2 * DAY * 1000)),
        forecast: thin(fc.filter(p => p[0] <= (t || 0) + 3 * DAY * 1000), 80),  // chart: next 3 days
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
    return gaugeList || (gaugeList = cached("all-gauges-v2.json", 180 * DAY, () =>
        shippedList("data/gauges.json", 180, allGaugesLive))
        .catch(e => { gaugeList = null; throw e; }));
}
// Start loading the lists before the first keystroke.
export function warmSearch() { allGauges().catch(() => {}); tideStations().catch(() => {}); }

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
        try { return await predictions("15", 48); } catch (e) { return curveFromHilo(); }
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
            await writeCache(`tide-obs-${sid}.json`, { none: true });
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
        id: sid, name: st ? st[1] : sid,
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
async function weather(lat, lon) {
    lat = round(parseFloat(lat), 2); lon = round(parseFloat(lon), 2);   // ~1 km; also the cache key
    const d = await cached(`weather2-${lat}_${lon}.json`, HOUR, () => get(WEATHER, {
        latitude: lat, longitude: lon, timezone: "auto", timeformat: "unixtime", forecast_days: 7,
        temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
        current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max," +
               "precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
        hourly: "temperature_2m,weather_code,precipitation_probability,precipitation," +
                "wind_speed_10m,wind_gusts_10m,is_day" }));
    const c = d.current, w = d.daily, h = d.hourly || {};
    return {
        now: c ? { temp: round(c.temperature_2m), feels: round(c.apparent_temperature),
                   code: round(c.weather_code), day: !!(c.is_day ?? 1),
                   wind: round(c.wind_speed_10m), gust: round(c.wind_gusts_10m), windDir: c.wind_direction_10m } : null,
        days: w.time.map((t, i) => [t * 1000, round(w.weather_code[i]), round(w.temperature_2m_max[i]), round(w.temperature_2m_min[i]),
            round(w.precipitation_probability_max[i]), round(w.precipitation_sum[i], 2), round(w.wind_speed_10m_max[i]),
            round(w.wind_gusts_10m_max[i]), round(w.wind_direction_10m_dominant[i]),
            w.sunrise[i] ? +w.sunrise[i] * 1000 : null, w.sunset[i] ? +w.sunset[i] * 1000 : null]),
        hours: (h.time || []).map((t, i) => [t * 1000, round(h.temperature_2m[i]), round(h.weather_code[i]),
            round(h.precipitation_probability[i]), round(h.precipitation[i], 2), round(h.wind_speed_10m[i]),
            round(h.wind_gusts_10m[i]), !!h.is_day[i]]),
    };
}

// ---------------------------------------------------------------- commands

const title = s => s[0].toUpperCase() + s.slice(1);

async function place(p) {
    const out = { key: (p.river || "") + "|" + (p.tide || ""), river: null, tide: null, errors: [] };
    await Promise.all([["river", river], ["tide", tide]].map(async ([kind, fn]) => {
        if (!p[kind]) return;
        try { out[kind] = await fn(p[kind]); } catch (e) { out.errors.push(`${title(kind)} ${p[kind]}: ${e.message}`); }
    }));
    if (p.tide) {
        try { out.surf = await surf(p.tide); } catch (e) { out.surf = null; out.errors.push(`Swell forecast: ${e.message}`); }
    }
    // weather at the river gauge, else at the tide station
    out.weather = null;
    try {
        const r = out.river;
        if (r && r.lat !== null && r.lat !== undefined) out.weather = await weather(r.lat, r.lon);
        else if (p.tide) {
            const s = await surfSpot(p.tide.trim());
            out.weather = await weather(s.lat, s.lon);
        }
    } catch (e) { out.errors.push(`Weather: ${e.message}`); }
    return out;
}

export async function fetchPlaces(places) {
    const out = await pool(places, 6, place);
    return { places: out, time: Date.now() };
}

// Search index: lower-cased words of "id name state", built once per list.
const indexes = new WeakMap();
function indexOf(rows) {
    let ix = indexes.get(rows);
    if (!ix) {
        ix = rows.map(r => (`${r[0]} ${r[1]} ${r[2]}`.toLowerCase().match(/[a-z0-9]+/g) || []));
        indexes.set(rows, ix);
    }
    return ix;
}

export async function search(text) {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    if (!words.length) return { rivers: [], tides: [] };
    const hits = (rows, kind) => {
        const ix = indexOf(rows), out = [];
        // every search word starts some word of "id name state"
        rows.forEach((r, i) => {
            if (words.every(w => ix[i].some(h => h.startsWith(w))))
                out.push({ kind, id: r[0], name: r[1].trim(), state: r[2], lat: r[3], lon: r[4] });
        });
        // names that start with the first word (or exact ids) first
        const k = r => [r.id.toLowerCase() !== words[0] ? 1 : 0, r.name.toLowerCase().startsWith(words[0]) ? 0 : 1];
        out.sort((a, b) => { const ka = k(a), kb = k(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
        return out.slice(0, 20);
    };
    const out = {};
    for (const [key, kind, rows] of [["rivers", "river", allGauges], ["tides", "tide", tideStations]]) {
        try { out[key] = hits(await rows(), kind); }
        catch (e) { out[key] = []; out.error = `${title(kind)} search failed: ${e.message}`; }
    }
    return out;
}
