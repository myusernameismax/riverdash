// Flow Tides: the River & Tides widget's popup (main.qml) as a home-screen web app.
// One ★ place opens first; tap around for details and the rest.
// Data: data.js (NOAA etc.). Look: config.js + css/app.css.

import { LOOK, DEFAULT_PLACES } from "./config.js";
import { fetchPlaces, savedPlaces, search as searchStations, warmSearch, history, gaugeStates } from "./data.js";
import { Chart, drawSpark } from "./chart.js";
import { wxIcon, icon } from "./icons.js";
import { fmtTime, fmtDay, fmtDayLong, fmtMonthDay, sameDay } from "./fmt.js";
import { morphInto } from "./morph.js";
import { qrSvg } from "./qr.js";
import { packSetup, unpackSetup, codeFrom, shareUrl } from "./share.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ANIM = LOOK.animationMs;
const DAY_MS = 86400000;

// ── saved on the phone ──────────────────────────────────────────────
function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* private mode */ } }
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* fine */ }

// ── state (same names as the widget's root properties) ──────────────
const S = {
    places: (() => { const p = load("rt:places", null); return Array.isArray(p) ? p : DEFAULT_PLACES.map(x => ({ ...x })); })(),
    pinnedRaw: load("rt:pinned", 0),
    selected: 0,             // place shown
    results: {},             // place key -> data from data.js
    updated: 0,              // when the newest shown data really arrived
    offline: false,          // the last refresh couldn't reach anything
    error: "",
    loading: false,
    chartMode: "",           // "stage" | "flow" | "tide" | "surf", "" = automatic
    focusDay: -1,            // local midnight (ms) of a day picked in the surf/weather lists; -1 = now
    // places list page (opened from the bottom bar), its search adds places
    listing: false,
    lsearch: false,          // its search is in use (field focused or holding text)
    // add page (Customize → Stations: a gauge or tide station for the shown place)
    adding: false,
    attachTo: -1,            // -1 = new place, else add a gauge/station to this place
    attachKind: "",          // "river" | "tide" | "" (both)
    searching: false,
    searchResults: [],
    searchError: "",
    searchSeq: 0,
    slowSearch: false,
    // edit mode, toast
    editing: false,
    customizing: false,      // the "Customize" panel for the shown place
    hist: null,              // {mode, range}: the chart shows history (Flow / Water temp)
    openGroups: new Set(),   // river groups opened in the places list (lower-case names)
    newGroups: [],           // Edit → + Group: groups made but still empty (gone if left empty)
    addedKeys: [],           // places added in this search (Cancel / Back takes them out)
    swiped: -1,              // place row swiped open to show Delete
    sort: load("rt:sort", "mine"),   // places list order: "mine" (as arranged in Edit) | "az" | "views"
    sortOpen: false,         // its menu is out
    listHidden: false,       // wide screens: the list pane slid away (the list button brings it back)
    // share / import page
    moving: "",              // "share" | "import" | ""
    shareLink: "",
    incoming: null,          // {places, pinned} from a link, waiting for Add / Replace
    importError: "",
    nowOpen: false,          // feels-like / wind line under the header
    hourHover: -1,           // picked hour in the day view
    undoData: null,
    toast: { shown: false, text: "", actionText: "", action: null },
};
const pinned = () => Math.max(0, Math.min(S.pinnedRaw, S.places.length - 1));
function setPinned(i) { S.pinnedRaw = i; save("rt:pinned", i); }
S.selected = pinned();

// ── helpers ─────────────────────────────────────────────────────────
const keyOf = p => ((p && p.river) || "") + "|" + ((p && p.tide) || "");
const dataFor = i => i >= 0 && i < S.places.length ? project(S.results[keyOf(S.places[i])] || null) : null;
const placeName = i => (S.places[i] || {}).name || "?";
const has = v => v !== null && v !== undefined;
const ft = v => has(v) ? v.toFixed(1) + " ft" : "–";
const commas = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/^-/, "−");
const cfs = v => has(v) ? commas(v) + " cfs" : "–";
const cfsShort = v => {   // tidal rivers can run backwards: −19k
    if (!has(v)) return "–";
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    return s + (a >= 10000 ? Math.round(a / 1000) + "k" : a >= 1000 ? (a / 1000).toFixed(1) + "k" : Math.round(a)) + " cfs";
};
// Tile number: in full up to 9,999; bigger flows as 12.3k / 192k so they fit the tile.
const cfsTile = v => Math.abs(v) < 10000 ? commas(v) : (v < 0 ? "−" : "") + (Math.abs(v) >= 100000 ? Math.round(Math.abs(v) / 1000) : (Math.abs(v) / 1000).toFixed(1)) + "k";
const arrow = (d, eps) => !has(d) ? "" : d > eps ? "↑" : d < -eps ? "↓" : "→";
const clock = ms => fmtTime(ms, "h:mm A");
const clockShort = ms => fmtTime(ms, "h:mma").replace(/m$/, "");
const dayClock = ms => sameDay(ms, Date.now()) ? clock(ms) : fmtDay(ms) + " " + clock(ms);
function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
}
const change = (d, unit, dec) => !has(d) ? "" : (d > 0 ? "+" : d < 0 ? "−" : "±")
    + (dec === 0 ? cfsTile(Math.abs(d)) : Math.abs(d).toFixed(dec)) + unit + " in 3 h";
const tideWord = e => e.type === "H" ? "High" : "Low";
const categoryColor = c => c === "action" ? LOOK.actionColor : c === "minor" ? LOOK.minorColor
    : c === "moderate" ? LOOK.moderateColor : c === "major" ? LOOK.majorColor : "var(--text)";
const flooding = r => !!r && ["action", "minor", "moderate", "major"].includes(r.category);
// flow that's part of the gauge's own readings (so it has a chart), vs. a borrowed USGS number
const nativeFlow = r => r.flowNative ?? r.flowNote === "NOAA";
// a few USGS gauges measure flow only
const hasStage = r => has(r.stage) || r.series.some(p => p[1] !== null);
// "Deschutes River (OR) at Moody" → "Deschutes (OR)", "McKenzie River near Vida" → "McKenzie"
const tidyRiver = n => n.replace(/\s+River(?=\s*\(|\s*$)/i, "").trim();
const shortName = n => tidyRiver(n.split(/ (?:near|at|above|below|blw|abv|nr) |,| {2}/)[0]);
// "Deschutes (OR)" → ["Deschutes", "OR"]
const splitState = n => { const m = n.match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m ? [m[1].trim(), m[2].trim()] : [n.trim(), ""]; };
const dayLabel = ms => fmtDay(ms) + " " + fmtMonthDay(ms);

// ── as of now ───────────────────────────────────────────────────────
// Saved readings can be hours old (app closed a while, or offline). What they
// predict (river forecast, tide tables, wave and weather forecasts) carries them
// forward to now, so the app opens on current numbers while it downloads. Measured
// data stays solid on the charts; everything after the last measurement is dashed.
const MEASURED_FOR = 2 * 3600000;   // gauges post about hourly; an older reading is replaced by the forecast
const HOUR_MS = 3600000;
// Value at time t on a line of [ms, ...] points (column col); null outside it.
function interp(pts, t, col) {
    let a = null;
    for (const p of pts) {
        if (p[col] === null || p[col] === undefined) continue;
        if (p[0] < t) { a = p; continue; }
        if (p[0] === t) return p[col];
        return a ? a[col] + (p[col] - a[col]) * (t - a[0]) / (p[0] - a[0]) : null;
    }
    return null;
}
const FLOOD = [["major", "Major flooding"], ["moderate", "Moderate flooding"], ["minor", "Minor flooding"], ["action", "Action stage"]];
function projectRiver(r, now) {
    if (!r || !r.time || now - r.time < MEASURED_FOR) return r;
    const line = [[r.time, r.stage, nativeFlow(r) ? r.flow : null]].concat(r.forecast);
    const stage = interp(line, now, 1);
    if (stage === null) return { ...r, stale: true };          // past the forecast: last measurement, marked old
    const flow = interp(line, now, 2), known = r.series.concat(r.forecast);
    const was = col => interp(known, now - 3 * HOUR_MS, col);
    const ws = was(1), wf = was(2);
    const cat = FLOOD.find(([k]) => r.flood[k] && stage >= r.flood[k]) || ["normal", "Normal"];
    return { ...r, predicted: true, obsTime: r.time,
             stage: Math.round(stage * 100) / 100, stageTrend: ws === null ? null : Math.round((stage - ws) * 100) / 100,
             flow: flow === null ? r.flow : Math.round(flow), flowPredicted: flow !== null,
             flowTrend: flow === null || wf === null ? (flow === null ? r.flowTrend : null) : Math.round(flow - wf),
             category: cat[0], categoryLabel: cat[1] };
}
function projectTide(t, now) {
    if (!t) return t;
    const live = t.live && now - t.time < HOUR_MS;
    // the 15-minute predictions, then the whole-week curve where they run out
    const wk = t.weekCurve || [], c = t.curve || [];
    const first = c.length ? c[0][0] : Infinity, last = c.length ? c[c.length - 1][0] : -Infinity;
    const all = wk.filter(p => p[0] < first).concat(c, wk.filter(p => p[0] > last));
    const h = interp(all, now, 1), later = interp(all, now + 15 * 60000, 1);
    const ev = t.week && t.week.length ? t.week : t.events || [];
    const past = ev.filter(e => e.time <= now);
    return { ...t, live,
             height: live ? t.height : h === null ? null : Math.round(h * 100) / 100,
             time: live ? t.time : now,
             rising: h === null || later === null ? null : later > h,
             next: ev.filter(e => e.time > now).slice(0, 4), previous: past.length ? past[past.length - 1] : null,
             curve: all.filter(p => now - 12 * HOUR_MS <= p[0] && p[0] <= now + 36 * HOUR_MS),
             full: all.filter(p => p[0] >= now - 24 * HOUR_MS),          // the week view
             events: ev.filter(e => now - 12 * HOUR_MS <= e.time && e.time <= now + 36 * HOUR_MS) };
}
function projectWeather(w, now) {
    if (!w || !w.now || now - (w.now.time || now) < 90 * 60000) return w;
    const h = (w.hours || []).reduce((a, x) => !a || Math.abs(x[0] - now) < Math.abs(a[0] - now) ? x : a, null);
    if (!h || Math.abs(h[0] - now) > HOUR_MS) return { ...w, now: null };
    return { ...w, now: { ...w.now, time: h[0], temp: h[1], code: h[2], day: h[7], wind: h[5], gust: h[6], feels: null, predicted: true } };
}
const projected = new WeakMap();
function project(d) {
    if (!d) return d;
    const now = Date.now(), minute = Math.floor(now / 60000), m = projected.get(d);
    if (m && m.minute === minute) return m.out;
    const out = { ...d, river: projectRiver(d.river, now), tide: projectTide(d.tide, now), weather: projectWeather(d.weather, now) };
    projected.set(d, { minute, out });
    return out;
}

// ── per-place settings (saved with the place) ───────────────────────
// place.hide:  charts/tabs not shown, e.g. ["surf"]; "tidelist" = the Next tides section
// place.ideal: {stage: [lo, hi], flow: [lo, hi], tide: [lo, hi]}; null = no bound on that side
// place.jetty: {calm, sketchy, cautionGust, sketchyGust}; missing = the config.js default
const MODES = { stage: "Height", flow: "Flow", temp: "Water temp", tide: "Tide", surf: "Waves" };
const hidden = (p, m) => !!p && Array.isArray(p.hide) && p.hide.includes(m);
const num = v => typeof v === "number" && isFinite(v);
function jettyLim(p) {
    const j = (p && p.jetty) || {};
    return { calm: num(j.calm) ? j.calm : LOOK.jettyCalmMaxFt, sketchy: num(j.sketchy) ? j.sketchy : LOOK.jettySketchyFt,
             cautionGust: num(j.cautionGust) ? j.cautionGust : LOOK.jettyCautionGustMph,
             sketchyGust: num(j.sketchyGust) ? j.sketchyGust : LOOK.jettySketchyGustMph };
}
function idealOf(p, mode) {
    const r = p && p.ideal && p.ideal[mode];
    if (!Array.isArray(r) || !(num(r[0]) || num(r[1]))) return null;
    return { lo: num(r[0]) ? r[0] : NaN, hi: num(r[1]) ? r[1] : NaN, good: LOOK.calmColor, bad: LOOK.sketchyColor };
}
// -1 too low, 0 in shape, 1 too high; null = no ideal range set (or no reading)
function shape(p, mode, v) {
    const b = idealOf(p, mode);
    if (!b || !has(v)) return null;
    return v < b.lo ? -1 : v > b.hi ? 1 : 0;
}
const shapeColor = k => k === 0 ? LOOK.calmColor : LOOK.sketchyColor;
// The whole place: in shape only if every reading with a good range is; null = no range set.
function placeShape(p, d) {
    const r = d && d.river, t = d && d.tide;
    const ks = [["stage", r && r.stage], ["flow", r && r.flow], ["tide", t && t.height]]
        .filter(([m]) => !hidden(p, m)).map(([m, v]) => shape(p, m, v)).filter(k => k !== null);
    return !ks.length ? null : ks.find(k => k !== 0) ?? 0;
}
const shapeWord = k => k === 0 ? "in shape" : k < 0 ? "too low" : "too high";

// Short colored pieces for the list rows.
// Readings with an ideal range set are green when in shape, red when not.
function parts(d, p) {
    const out = [];
    if (!d) return [{ text: "…", color: "var(--text)" }];
    const r = d.river, t = d.tide;
    const tint = (mode, v, color) => { const k = shape(p, mode, v); return k === null ? color : shapeColor(k); };
    if (r && has(r.stage) && !hidden(p, "stage"))
        out.push({ text: ft(r.stage) + arrow(r.stageTrend, 0.05), color: flooding(r) ? categoryColor(r.category) : tint("stage", r.stage, LOOK.stageColor) });
    if (r && has(r.flow) && !hidden(p, "flow")) out.push({ text: cfsShort(r.flow), color: tint("flow", r.flow, LOOK.flowColor) });
    if (t && !hidden(p, "tide")) {
        const n = t.next && t.next[0];
        if (!r && has(t.height)) out.push({ text: ft(t.height) + (t.rising === null ? "" : t.rising ? "↑" : "↓"), color: tint("tide", t.height, LOOK.tideColor) });
        if (n) out.push({ text: n.type + " " + clockShort(n.time), color: LOOK.tideColor });
    }
    const sn = surfNow(d.surf);
    if (sn && !r && !hidden(p, "surf")) out.push({ text: "≈" + Math.round(sn[1]) + "ft", color: rateColor(rate(sn, jettyLim(p))) });
    if (!out.length) out.push({ text: d.errors && d.errors.length ? "!" : "–", color: "var(--negative)" });
    return out;
}

// Which charts each station has, remembered once seen ("r:LID" / "t:SID" → {mode: true/false}).
// Switched-off charts aren't downloaded, so this is how Customize still knows to offer them.
const AVAIL = load("rt:avail", {});
const RIVER_MODES = ["stage", "flow", "temp"];
const stationKey = (p, m) => RIVER_MODES.includes(m) ? (p.river ? "r:" + p.river.trim().toUpperCase() : "")
                                                     : (p.tide ? "t:" + p.tide.trim() : "");
// true / false once known; undefined = never looked (a station that exists is assumed to have it)
const availOf = (p, m) => { const k = stationKey(p, m); return k ? ((AVAIL[k] || {})[m] ?? undefined) : false; };
function noteAvail(p, d) {
    if (!d || !d.asked || !d.asked.length) return;
    const have = haveModes(d);
    let changed = false;
    for (const m of d.asked) {
        const k = stationKey(p, m), v = have.includes(m);
        if (!k || (AVAIL[k] || {})[m] === v) continue;
        (AVAIL[k] = AVAIL[k] || {})[m] = v; changed = true;
    }
    if (changed) save("rt:avail", AVAIL);
}
// Shown but no data yet: just switched back on and still downloading (that tile spins).
const loadingKeys = new Set();
const waiting = (p, d, m) => !hidden(p, m) && availOf(p, m) !== false && !haveModes(d).includes(m) && loadingKeys.has(keyOf(p));

// Which charts this data has (whether hidden or not).
function haveModes(d) {
    const r = d ? d.river : null, t = d ? d.tide : null;
    return Object.keys(MODES).filter(m => (m === "tide" && !!t) || (m === "stage" && !!r && hasStage(r))
        || (m === "surf" && !!d && !!d.surf && d.surf.hours.length > 1)
        || (m === "flow" && !!r && (r.series.some(p => p[2] !== null) || has(r.flow)))
        || (m === "temp" && !!r && !!r.temp && r.temp.series.length > 1));
}
// Which graph to draw (skipping the place's hidden ones).
function bestMode(d, wanted, p) {
    const ok = haveModes(d).filter(m => !hidden(p, m));
    if (wanted && ok.includes(wanted)) return wanted;
    return ["flow", "stage", "tide", "surf", "temp"].find(m => ok.includes(m)) || "";
}
const tideMarkers = evs => evs.map(e => ({ time: e.time, value: e.height, above: e.type === "H", label: e.type + " " + clockShort(e.time) }));
// Big chart: like graph(), but when a future day is picked, it opens on that day
// (and the tide chart switches to the whole-week curve).
function bigGraph(d, mode, p) {
    const g = graph(d, mode, p);
    if (S.focusDay < 0) return g;
    const a = S.focusDay, b = S.focusDay + DAY_MS, t = d ? d.tide : null;
    if (mode === "tide" && t && (t.full || t.weekCurve) && (t.full || t.weekCurve).length > 1) {
        g.series = t.full || t.weekCurve;
        g.markers = tideMarkers(t.week || []);
        g.nowValue = NaN;
    }
    const all = g.series.concat(g.forecast || []);
    g.dayCovered = all.length > 1 && all[0][0] < b && all[all.length - 1][0] > a;
    if (g.dayCovered) { g.homeT0 = a; g.homeT1 = b; }
    return g;
}
// The week view's charts show the same week ahead as the weather (through the 7th
// day), as far as the data goes; rivers also the last 2 days, tides and waves start
// at now (their past doesn't matter). Picking a day zooms to it.
function graph(d, mode, p) {
    const r = d ? d.river : null, t = d ? d.tide : null, now = Date.now(), w1 = midnight(now) + 7 * DAY_MS;
    if (mode === "tide" && t)
        return { series: t.full || t.curve, forecast: [], color: LOOK.tideColor, decimals: 1, threshold: NaN, unit: " ft", ideal: idealOf(p, "tide"),
                 homeT0: now, homeT1: w1,
                 nowValue: has(t.height) ? t.height : NaN, markers: tideMarkers(t.week || t.events) };
    if (mode === "surf" && d && d.surf) {
        const pts = d.surf.hours.map(h => [h[0], h[1]]), L = jettyLim(p);
        return { series: pts.filter(x => x[0] <= now), forecast: pts.filter(x => x[0] > now),
                 color: LOOK.surfColor, decimals: 1, unit: " ft", nowValue: NaN, markers: [],
                 threshold: L.calm, thresholdLabel: "calm limit " + L.calm + " ft",
                 homeT0: now, homeT1: w1 };
    }
    if (r && mode === "temp" && r.temp)   // measured only: NOAA doesn't forecast water temperature
        return { series: r.temp.series, forecast: [], color: LOOK.tempColor, decimals: 1, unit: " °F", nowValue: NaN,
                 markers: [], threshold: NaN, homeT0: now - 2 * DAY_MS, homeT1: w1 };
    if (r && (mode === "stage" || mode === "flow")) {
        const c = mode === "flow" ? 2 : 1;
        // flow NOAA doesn't have: USGS's own 2 days (no forecast), or nothing to draw
        const own = c === 1 || r.series.some(x => x[2] !== null);
        return { series: own ? r.series.map(x => [x[0], x[c]]) : r.flowSeries || [], forecast: own ? r.forecast.map(x => [x[0], x[c]]) : [],
                 color: c === 2 ? LOOK.flowColor : LOOK.stageColor, decimals: c === 2 ? 0 : 1, markers: [],
                 nowValue: !r.predicted ? NaN : c === 2 ? (r.flowPredicted ? r.flow : NaN) : r.stage,
                 ideal: idealOf(p, mode),
                 unit: c === 2 ? " cfs" : " ft", homeT0: now - 2 * DAY_MS, homeT1: w1,
                 threshold: c === 1 && r.flood.minor ? r.flood.minor : NaN,
                 thresholdLabel: "flood stage " + r.flood.minor + " ft" };
    }
    return { series: [], forecast: [], color: LOOK.stageColor, decimals: 1, nowValue: NaN, markers: [], threshold: NaN };
}
// Mini graph in the places list: one color that says how the place is doing.
// River: green in shape / red out of it (gray with no good range). Coastal tide
// station: the jetty / surf rating right now (green calm, yellow caution, red sketchy).
function listSparkColor(i) {
    const d = dataFor(i), p = S.places[i], mode = bestMode(d, "", p);
    if (d && (mode === "tide" || mode === "surf") && d.surf && !hidden(p, "surf")) {
        const l = rate(surfNow(d.surf), jettyLim(p));
        if (l >= 0) return rateColor(l);
    }
    const k = placeShape(p, d);
    return k === null ? LOOK.sparkPlainColor : shapeColor(k);
}
function listSpark(i) { return { ...spark(i), ideal: null, color: listSparkColor(i) }; }
// Same data, trimmed to a short window so it stays readable when tiny.
function spark(i) {
    const d = dataFor(i), p = S.places[i];
    const full = graph(d, bestMode(d, "", p), p);
    const lo = Date.now() - LOOK.sparkPastHours * 3600000, hi = Date.now() + LOOK.sparkFutureHours * 3600000;
    const win = a => a.filter(p => p[0] >= lo && p[0] <= hi);
    return { ...full, series: win(full.series), forecast: win(full.forecast) };
}

// ── swell / jetty rating (coastal tide stations) ────────────────────
// hour row: [ms, wave ft, period s, wave dir, swell ft, swell s, swell dir, wind mph, gust mph, wind dir]
const compass = deg => has(deg) ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8] : "";
function rate(h, L) {   // 0 calm, 1 caution, 2 sketchy, -1 unknown; L = jettyLim(place)
    if (!h || !has(h[1])) return -1;
    const eff = h[1] * (has(h[2]) && h[2] >= LOOK.jettyLongPeriodS ? LOOK.jettyLongPeriodFactor : 1);
    const g = has(h[8]) ? h[8] : 0;
    return eff > L.sketchy || g > L.sketchyGust ? 2
         : eff > L.calm || g > L.cautionGust ? 1 : 0;
}
const rateColor = l => l === 0 ? LOOK.calmColor : l === 1 ? LOOK.cautionColor : l === 2 ? LOOK.sketchyColor : "var(--disabled)";
const rateWord = l => l === 0 ? "Calm" : l === 1 ? "Caution" : l === 2 ? "Sketchy" : "–";
function surfNow(s) {
    if (!s || !s.hours.length) return null;
    const now = Date.now();
    return s.hours.reduce((a, h) => Math.abs(h[0] - now) < Math.abs(a[0] - now) ? h : a);
}
const isDaylight = (s, ms) => s.daylight.some(p => ms >= p[0] && ms <= p[1]);
const midnight = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
// One entry per local day from today on: ranges, worst daylight rating, and a
// rating per hour (24 slots) for the little strip.
function surfDays(s, L) {
    const rate_ = h => rate(h, L);
    if (!s) return [];
    const days = [], byDay = {}, today = midnight(Date.now());
    for (const h of s.hours) {
        const k = midnight(h[0]);
        if (k < today) continue;
        if (!byDay[k]) { byDay[k] = { start: k, hours: [] }; days.push(byDay[k]); }
        byDay[k].hours.push(h);
    }
    return days.filter(d => d.hours.length >= 6).map(d => {
        const lit = d.hours.filter(h => isDaylight(s, h[0]));
        const use = lit.length ? lit : d.hours;
        const waves = use.map(h => h[1]), gusts = use.map(h => h[8] || 0);
        const big = use.reduce((a, h) => h[1] > a[1] ? h : a);
        const slots = Array.from({ length: 24 }, () => ({ level: -1, day: false }));
        for (const h of d.hours) slots[new Date(h[0]).getHours()] = { level: rate_(h), day: isDaylight(s, h[0]) };
        const calm = lit.filter(h => rate_(h) === 0);
        return {
            start: d.start, label: d.start === today ? "Today" : fmtDay(d.start),
            lo: Math.min(...waves), hi: Math.max(...waves),
            period: big[2], dir: compass(big[3]), swell: big[4], swellPeriod: big[5], swellDir: compass(big[6]),
            gust: Math.max(...gusts), level: Math.max(...use.map(rate_)), slots,
            calm: calm.length ? clockShort(calm[0][0]) + "–" + clockShort(calm[calm.length - 1][0] + 3600000) : "",
        };
    });
}

// ── weather (every place) ───────────────────────────────────────────
function wxWord(c) {
    return c === 0 ? "Clear" : c === 1 ? "Mostly clear" : c === 2 ? "Partly cloudy" : c === 3 ? "Overcast"
         : c === 45 || c === 48 ? "Fog"
         : c >= 51 && c <= 55 ? "Drizzle" : c === 56 || c === 57 ? "Freezing drizzle"
         : c === 61 ? "Light rain" : c === 63 ? "Rain" : c === 65 ? "Heavy rain"
         : c === 66 || c === 67 ? "Freezing rain"
         : c === 71 ? "Light snow" : c === 73 ? "Snow" : c === 75 ? "Heavy snow" : c === 77 ? "Snow grains"
         : c === 80 ? "Showers" : c === 81 ? "Rain showers" : c === 82 ? "Heavy showers"
         : c === 85 || c === 86 ? "Snow showers"
         : c === 95 ? "Thunderstorms" : c === 96 || c === 99 ? "Storms + hail" : "–";
}
// day row: [local-midnight ms, WMO code, hi °F, lo °F, rain %, rain in, wind mph, gust mph, wind dir, sunrise, sunset]
function wxDays(w) {
    if (!w || !w.days) return [];
    const today = midnight(Date.now());
    return w.days.filter(d => d[0] >= today - 3600000).map(d => ({
        start: d[0], code: d[1], hi: d[2], lo: d[3], pop: d[4], rain: d[5], wind: d[6], gust: d[7], dir: compass(d[8]),
        rise: d[9], set: d[10],
        label: Math.abs(d[0] - today) < 3 * 3600000 ? "Today" : fmtDay(d[0]),
    }));
}
// hour row: [ms, temp °F, WMO code, rain %, rain in, wind mph, gust mph, daylight]
function wxHours(w, start) {
    if (!w || !w.hours || start < 0) return [];
    return w.hours.filter(h => h[0] >= start && h[0] < start + DAY_MS).map(h => ({
        t: h[0], temp: h[1], code: h[2], pop: h[3], rain: h[4], wind: h[5], gust: h[6], day: h[7],
    }));
}

// ── editing places ──────────────────────────────────────────────────
function savePlaces(list) {
    S.places = list;
    save("rt:places", list);
    refresh();
}
function select(i, keepScroll = false) {
    if (i === S.selected) return;
    S.selected = i;
    S.chartMode = ""; S.focusDay = -1; S.hourHover = -1; S.nowOpen = false; S.customizing = false; S.hist = null;
    flash.selected = true;
    if (!keepScroll) $("#scroll").scrollTop = 0;
    setTimeout(freshenShown);
}
function pin(i) {
    setPinned(i);
    toast("★ " + placeName(i) + " opens first", "", null);
}
// Put a place in group `name` ("" = in no group). The automatic river group's own
// name = automatic again; leaving an automatic group is remembered as "".
function groupTo(p, name) {
    const auto = autoRiver(p);
    if (name && name.toLowerCase() === auto.toLowerCase()) delete p.group;
    else if (name) p.group = name;
    else if (auto) p.group = "";
    else delete p.group;
}
// Edit → a group's name field: renames it (for all its places); empty = no change.
function renameGroup(key, value) {
    const v = value.trim();
    if (!v) return;
    const ng = S.newGroups.findIndex(n => n.toLowerCase() === key);
    if (ng >= 0) { S.newGroups[ng] = v; return; }
    const list = S.places.map(p => ({ ...p }));
    list.forEach(p => { if (groupOf(p).toLowerCase() === key) groupTo(p, v); });
    S.places = list;
    save("rt:places", list);
}
// Edit → − on a group: its places stay, just out of the group.
function ungroup(key) {
    S.newGroups = S.newGroups.filter(n => n.toLowerCase() !== key);
    const list = S.places.map(p => ({ ...p }));
    list.forEach(p => { if (groupOf(p).toLowerCase() === key) groupTo(p, ""); });
    S.places = list;
    save("rt:places", list);
}
// After a drag in Edit: the places in their new order (old indexes), and the
// dragged place's new group (undefined = unchanged). Pinned / selected follow.
function reorder(order, moved, groupName) {
    if (order.length !== S.places.length) return;
    const list = order.map(i => ({ ...S.places[i] }));
    if (groupName !== undefined) {
        groupTo(list[order.indexOf(moved)], groupName);
        if (groupName) S.newGroups = S.newGroups.filter(n => n.toLowerCase() !== groupName.toLowerCase());
    }
    setPinned(order.indexOf(pinned()));
    S.selected = order.indexOf(S.selected);
    S.places = list;
    save("rt:places", list);
}
function rename(i, name) {
    name = name.trim();
    if (!name || name === placeName(i)) return;
    const list = S.places.map(p => ({ ...p }));
    list[i].name = name;
    S.places = list;
    save("rt:places", list);
}
function remove(i) {
    const list = S.places.slice();
    const gone = list.splice(i, 1)[0];
    const p = S.pinnedRaw;
    S.undoData = { place: gone, index: i, pinned: p, selected: S.selected };
    setPinned(i < p ? p - 1 : i === p ? 0 : p);
    S.selected = i < S.selected ? S.selected - 1 : i === S.selected ? pinned() : S.selected;
    S.places = list;
    save("rt:places", list);
    if (list.length < 2) S.editing = false;
    toast("Removed " + gone.name, "Undo", undoRemove);
}
function undoRemove() {
    const u = S.undoData;
    if (!u) return;
    const list = S.places.slice();
    list.splice(Math.min(u.index, list.length), 0, u.place);
    S.places = list;
    save("rt:places", list);
    setPinned(u.pinned);
    S.selected = u.selected;
    S.undoData = null;
    S.toast.shown = false;
    refresh();
}
// Change the shown place's settings (and save them).
function updatePlace(i, fn) {
    const list = S.places.map(p => JSON.parse(JSON.stringify(p)));
    if (!list[i]) return;
    fn(list[i]);
    S.places = list;
    save("rt:places", list);
}
function toggleTab(mode) {
    updatePlace(S.selected, p => {
        const h = new Set(p.hide || []);
        if (h.has(mode)) h.delete(mode); else h.add(mode);
        if (h.size) p.hide = [...h]; else delete p.hide;
    });
    // switched back on with nothing here: get it (from the phone's saved copy if it's
    // still fresh). Only its own tile waits; the rest of the page stays as it is.
    const p = S.places[S.selected], d = S.results[keyOf(p)];
    if (!p || hidden(p, mode) || !(mode in MODES) || haveModes(d).includes(mode)) return;
    const key = keyOf(p);
    loadingKeys.add(key);
    fetchSome([p], undefined).finally(() => { loadingKeys.delete(key); render(); });
}
// Take the river gauge or tide station off a place (a place keeps at least one).
function removeStation(kind, i = S.selected) {
    const p = S.places[i];
    if (!p || !p[kind] || !(p.river && p.tide)) return;
    const before = JSON.parse(JSON.stringify(p)), old = S.results[keyOf(p)];
    updatePlace(i, q => { delete q[kind]; });
    const q = S.places[i];
    moveViews(before, q);
    // show what's left right away instead of a spinner
    if (old && !S.results[keyOf(q)]) S.results[keyOf(q)] = kind === "tide" ? { ...old, key: keyOf(q), tide: null, surf: null } : { ...old, key: keyOf(q), river: null };
    toast("Removed " + (kind === "tide" ? "tide station" : "river gauge") + " from " + q.name, "Undo", () => {
        if (!S.places[i]) return;
        const list = S.places.slice();
        moveViews(list[i], before);
        list[i] = before;
        savePlaces(list);
    });
    refresh();
}
// A number typed in the Customize panel. Blank = no value.
function readNum(text) {
    const t = String(text).replace(/[, ]/g, "");
    if (t === "") return null;
    const v = parseFloat(t);
    return isFinite(v) ? v : undefined;      // undefined = not a number, ignore
}
function setIdeal(mode, side, text) {
    const v = readNum(text);
    if (v === undefined) return;
    updatePlace(S.selected, p => {
        const ideal = p.ideal || {}, r = (ideal[mode] || [null, null]).slice();
        r[side] = v;
        if (num(r[0]) && num(r[1]) && r[0] > r[1]) r.reverse();
        if (num(r[0]) || num(r[1])) ideal[mode] = r; else delete ideal[mode];
        if (Object.keys(ideal).length) p.ideal = ideal; else delete p.ideal;
    });
}
function setJetty(key, text) {
    const v = readNum(text);
    if (v === undefined) return;
    updatePlace(S.selected, p => {
        const j = { ...(p.jetty || {}) };
        if (v === null || v < 0) delete j[key]; else j[key] = v;
        // keep calm ≤ sketchy and caution ≤ sketchy gusts
        const L = jettyLim({ jetty: j });
        if (L.calm > L.sketchy) { if (key === "calm") j.sketchy = L.calm; else j.calm = L.sketchy; }
        if (L.cautionGust > L.sketchyGust) { if (key === "cautionGust") j.sketchyGust = L.cautionGust; else j.cautionGust = L.sketchyGust; }
        if (Object.keys(j).length) p.jetty = j; else delete p.jetty;
    });
}

function openAdd(target, kind) {
    S.attachTo = target; S.attachKind = kind;
    S.searchResults = []; S.searchError = ""; S.searching = false; S.searchSeq++;
    S.editing = false;
    S.adding = true;
    S.addedKeys = [];
    const p = S.places[target];
    const q = $("#q");
    q.value = p ? p.name : "";       // attaching: start with the place's name
    render();
    q.focus({ preventScroll: true }); // inside the tap, so the keyboard comes up (the page slides in by itself)
    if (q.value) runSearch(q.value);
    warmSearch();
}
// Results tapped on the Add page are added (and start loading) straight away. The
// floating "Add 2 Rivers To List" button keeps them and shows the first one; Back
// (or the back swipe / Esc) takes them out again.
function closeAdd(keep = false) {
    S.adding = false;
    $("#q").blur();
    if (!keep) unAdd(S.addedKeys);
    const i = S.places.findIndex(p => S.addedKeys.includes(keyOf(p)));
    S.addedKeys = [];
    if (i >= 0) { select(i); flash.selected = true; }
}
// Quietly take out places added during this visit (no Undo: they were never kept).
function unAdd(keys) {
    if (!keys.length) return;
    const shownKey = keyOf(S.places[S.selected]), pinKey = keyOf(S.places[S.pinnedRaw]);
    const list = S.places.filter(p => !keys.includes(keyOf(p)));
    if (list.length === S.places.length) return;
    S.places = list;
    save("rt:places", list);
    S.addedKeys = S.addedKeys.filter(k => !keys.includes(k));
    const pin = list.findIndex(p => keyOf(p) === pinKey);
    setPinned(pin >= 0 ? pin : 0);
    const sel = list.findIndex(p => keyOf(p) === shownKey);
    S.selected = sel >= 0 ? sel : pinned();
}
// The places list. Typing in its search shows results instead of the list; tapping a
// result adds it right away (✓, starts loading), several can go in, and the floating
// "Add 2 Rivers To List" button keeps them and goes back to the list, scrolled to them. Cancel / Back takes
// them out again.
function openList(search = false) {
    S.listing = !wide();
    if (wide() && S.listHidden) toggleListPane(true);
    S.editing = false; S.newGroups = []; S.swiped = -1;
    S.attachTo = -1; S.attachKind = "";
    render();
    if (search) { startSearch(); $("#lq").focus({ preventScroll: true }); }   // inside the tap, so the keyboard comes up
}
function startSearch() {
    if (S.lsearch) return;
    S.lsearch = true; S.editing = false; S.newGroups = []; S.swiped = -1;
    S.attachTo = -1; S.attachKind = "";
    S.addedKeys = [];
    S.searchResults = []; S.searchError = ""; S.searching = false; S.searchSeq++;
    render();
    warmSearch();
}
function endSearch(keep = false) {
    const lq = $("#lq");
    lq.value = ""; lq.blur();
    S.lsearch = false;
    S.searchResults = []; S.searchError = ""; S.searching = false; S.searchSeq++;
    if (!keep) unAdd(S.addedKeys);
    S.addedKeys = [];
}
// ── wide windows (a computer): the places list stays on the left, the place on the right ──
// No list button and no zoom there; the place on screen is tinted in the list. The
// desktop panel widget's popup is narrow, so it keeps the phone layout.
const wideMQ = matchMedia("(min-width: 760px)");
const wide = () => wideMQ.matches && !document.documentElement.dataset.embed;
const listShown = () => S.listing || (wide() && !S.listHidden);   // the places list is on screen
function applyWide() {
    document.documentElement.classList.toggle("wide", wide());
    document.body.classList.toggle("list-hidden", wide() && S.listHidden);
    if (wide()) S.listing = false;   // the list is a pane there, not a page
}
// The list button on a wide screen: slide the list pane away or back. The place gets
// the room; its chart is redrawn at the new width once the slide is done.
function toggleListPane(show = S.listHidden) {
    S.listHidden = !show;
    if (!show) { S.sortOpen = false; if (S.lsearch) endSearch(); }
    render();
    setTimeout(() => paint(), ANIM + 40);
}
wideMQ.addEventListener("change", () => render());
// ── zoom between the list and a place (Apple Weather) ──
// Tapping a row: the place's page opens out of the row, its top edge racing up and its
// bottom edge down so both reach the screen's edges together. The list button: the page
// shrinks back into its row (its group's row while that's closed). The page is clipped
// to the row's rectangle (clip-path), so it's laid out once at full size.
const ZOOM_MS = Math.round(ANIM * 2.4);
const ZOOM_EASE = "cubic-bezier(.45,0,.15,1)";        // eases out of the row, glides, settles softly
let zoomAnims = [];
const canZoom = () => !wide() && ANIM > 0 && !!document.body.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches;
function rowFor(i) {
    const row = document.querySelector(`#placesList .prow[data-i="${i}"]`);
    if (row) return row;
    const g = S.places[i] ? groupOf(S.places[i]).toLowerCase() : "";
    return g ? [...document.querySelectorAll("#placesList .prow.grp")].find(x => x.dataset.g === g) || null : null;
}
function insetOf(el) {
    const a = $("#app").getBoundingClientRect(), r = el.getBoundingClientRect();
    const px = v => Math.round(v) + "px";
    return `inset(${px(r.top - a.top)} ${px(a.right - r.right)} ${px(a.bottom - r.bottom)} ${px(r.left - a.left)} round 12px)`;
}
// The hand-off at the end is instant: with transitions on, the list (above the place in
// the page order) would fade out over the place for a moment, a flicker (Safari).
function stopZoom() {
    const b = document.body;
    if (b.classList.contains("zooming")) {
        b.classList.add("zoom-settle");
        b.classList.remove("zooming");
        void b.offsetWidth;                                   // the switch happens now, untransitioned
        zoomAnims.forEach(a => a.cancel());
        requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove("zoom-settle")));
    } else zoomAnims.forEach(a => a.cancel());
    zoomAnims = [];
}
function runZoom(from, opening) {
    const det = $("#details"), list = $("#listPage"), full = "inset(0px 0px 0px 0px round 0px)";
    document.body.classList.add("zooming");
    // the page starts (or ends) in the row's own tint, so the whole growing card shows
    const color = v => { det.style.backgroundColor = v; const c = getComputedStyle(det).backgroundColor; det.style.backgroundColor = ""; return c; };
    const card = color("var(--card)"), bg = color("var(--bg)");
    const page = det.animate(opening
        ? [{ clipPath: from, opacity: 0, backgroundColor: card }, { opacity: 1, offset: 0.15 }, { backgroundColor: card, offset: 0.3 }, { clipPath: full, opacity: 1, backgroundColor: bg }]
        : [{ clipPath: full, opacity: 1, backgroundColor: bg }, { backgroundColor: card, offset: 0.7 }, { opacity: 1, offset: 0.8 }, { clipPath: from, opacity: 0, backgroundColor: card }],
        { duration: ZOOM_MS, easing: ZOOM_EASE, fill: "forwards" });
    // the list behind sinks back a little as a place opens, and settles with a small bounce as it comes back
    const back = list.animate(opening
        ? [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.96)", opacity: 0.4 }]
        : [{ transform: "scale(.96)", opacity: 0.4 }, { transform: "scale(1)", opacity: 1 }],
        { duration: ZOOM_MS, easing: opening ? ZOOM_EASE : "cubic-bezier(.34,1.5,.64,1)", fill: "forwards" });
    zoomAnims = [page, back];
    page.onfinish = () => { if (zoomAnims[0] === page) stopZoom(); };
}
// list → a place: `change` switches the state over (which place, list closed)
function zoomInto(row, change) {
    stopZoom();
    const from = row && canZoom() ? insetOf(row) : null;
    change();
    if (from) { flash.selected = false; document.body.classList.add("zooming"); }
    render();
    if (from) runZoom(from, true);
}
// a place → the list
function zoomToList() {
    stopZoom();
    const zoom = canZoom() && S.places.length;
    if (zoom) document.body.classList.add("zooming");
    openList();
    const row = zoom ? rowFor(S.selected) : null;
    if (!row) { stopZoom(); return; }
    // a row off screen: scroll the list so it's in view, the page shrinks into it there
    const sc = $("#listScroll"), sr = sc.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < sr.top || r.bottom > sr.bottom) sc.scrollTop += r.top - sr.top - (sr.height - r.height) / 2;
    runZoom(insetOf(row), false);
}
// Leaving the list for the river view (a place was tapped, or Back)
function closeList() {
    S.sortOpen = false;
    if (S.lsearch) endSearch();
    S.listing = false; S.editing = false; S.newGroups = []; S.swiped = -1;
}
const alreadyHave = item => S.places.some(p => p[item.kind] === item.id);
const addedNow = item => S.places.some(p => p[item.kind] === item.id && S.addedKeys.includes(keyOf(p)));
// "Add 1 River To List", "Add 2 Tide Stations To List", mixed: "Add 3 Places To List"
function addLabel() {
    const added = S.places.filter(p => S.addedKeys.includes(keyOf(p))), n = added.length;
    const rivers = added.filter(p => p.river).length;
    const word = rivers && rivers < n ? "Place" : rivers ? "River" : "Tide Station";
    return `Add ${n} ${word}${n === 1 ? "" : "s"} To List`;
}
// From the places list's search: back to the list, scrolled to the new places (their
// groups opened), which light up for a moment.
function keepAdded() {
    const keys = [...S.addedKeys], n = keys.length, first = S.places.find(p => keys.includes(keyOf(p)));
    if (first) toast("Added " + (n === 1 ? placeLabel(S.places.indexOf(first)) : n + " places"), "", null);
    if (S.adding) { closeAdd(true); return; }
    endSearch(true);
    for (const p of S.places) if (keys.includes(keyOf(p)) && groupOf(p)) S.openGroups.add(groupOf(p).toLowerCase());
    render();
    const rows = [...document.querySelectorAll("#placesList .prow[data-i]")].filter(r => keys.includes(r.dataset.key));
    if (!rows.length) return;
    // after the title slides back and the search's padding goes (they change the list's height)
    setTimeout(() => reveal(rows[0], rows[rows.length - 1], $("#listScroll")), ANIM + 40);
    const tint = getComputedStyle(document.documentElement).getPropertyValue("--link").trim() || "#2b8fe0";
    rows.forEach(r => r.animate([{ backgroundColor: `color-mix(in srgb, ${tint} 22%, transparent)` }, { backgroundColor: "transparent" }],
        { duration: 1600, delay: ANIM + 200, easing: "ease-in", fill: "backwards" }));
}
function addResult(item) {
    const list = S.places.map(p => ({ ...p }));
    let i;
    if (S.attachTo >= 0 && S.attachTo < list.length) {
        i = S.attachTo;
        const was = { ...list[i] };
        list[i][item.kind] = item.id;
        if (item.kind === "river") { list[i].rv = shortName(item.name); if (item.state) list[i].st = item.state; }
        // tides added to a river place: waves / jetty rating start hidden (Customize → Show
        // turns them on); a tide station on its own shows them
        if (item.kind === "tide" && list[i].river) list[i].hide = [...new Set([...(list[i].hide || []), "surf"])];
        moveViews(was, list[i]);
    } else {
        // a new place, added (and loading) right away; the Add page stays open so several
        // can go in (e.g. every gauge on a river). Back takes them out again.
        const p = { name: shortName(item.name) };
        p[item.kind] = item.id;
        if (item.kind === "river") { p.rv = shortName(item.name); if (item.state) p.st = item.state; }
        list.push(p);
        savePlaces(list);
        S.addedKeys.push(keyOf(p));
        return;
    }
    savePlaces(list);
    select(i);
    flash.selected = true;
    closeAdd(true);
    toast("Added " + (item.kind === "tide" ? "tides" : "river gauge") + " to " + list[i].name, "", null);
}

// ── share / import ──────────────────────────────────────────────────
// Share: a link (and its QR code) holding the places and their settings.
// Import: open such a link, scan its QR code, or paste it. Data downloads fresh.
const sameStation = (a, b) => (a.river && a.river === b.river) || (a.tide && a.tide === b.tide);
function openShare() {
    S.moving = "share"; S.editing = false; S.shareLink = "";
    render();
    packSetup(S.places, pinned()).then(code => { S.shareLink = shareUrl(code); render(); });
}
// With no places yet (someone new opening a shared or demo link), the link's
// places load straight away and the app opens on its ★ place: no import screen.
function openImport(text) {
    const fresh = !!text && !S.places.length;
    S.editing = false; S.importError = "";
    if (!fresh) S.moving = "import";
    if (!text) { S.incoming = null; render(); return; }
    const code = codeFrom(text);
    if (!code) { S.moving = "import"; S.incoming = null; S.importError = "Not a Flow Tides link"; render(); return; }
    unpackSetup(code).then(r => {
        S.incoming = r; S.importError = "";
        if (fresh && !S.places.length) { applyImport(false, true); save("rt:link", code); }
        else S.moving = "import";
    }).catch(e => { S.moving = "import"; S.incoming = null; S.importError = e.message; })
      .finally(() => { waitingForLink = false; render(); });
}
function closeMove() {
    S.moving = ""; S.incoming = null; S.importError = "";
    const f = $("#importText");
    if (f) { f.value = ""; f.blur(); }
}
function mergePlaces(mine, inc) {
    const list = mine.map(p => ({ ...p }));
    for (const p of inc) {
        const i = list.findIndex(q => sameStation(q, p));
        if (i >= 0) list[i] = { ...list[i], ...p }; else list.push({ ...p });
    }
    return list;
}
function applyImport(replace, quiet = false) {
    const inc = S.incoming;
    if (!inc) return;
    const before = { places: S.places.map(p => ({ ...p })), pinned: S.pinnedRaw };
    const list = replace || !S.places.length ? inc.places.map(p => ({ ...p })) : mergePlaces(S.places, inc.places);
    if (replace || !S.places.length) setPinned(inc.pinned);
    closeMove();
    savePlaces(list);
    S.selected = -1; select(pinned());
    const n = inc.places.length;
    if (quiet) return;
    toast((replace ? "Replaced with " : "Imported ") + n + (n === 1 ? " place" : " places"), "Undo", () => {
        setPinned(before.pinned);
        savePlaces(before.places);
        S.selected = -1; select(pinned());
    });
}
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback below */ }
    const f = document.createElement("textarea");
    f.value = text; f.setAttribute("readonly", ""); f.style.position = "fixed"; f.style.opacity = "0";
    document.body.appendChild(f); f.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* no */ }
    f.remove();
    return ok;
}
// A link opened in Safari on an iPhone lands in Safari, not in the home-screen app
// (they keep separate storage), so it offers to copy the link for the app instead.
const inSafariTab = () => navigator.standalone === false;
const standalone = () => navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

function renderMove() {
    $("#moveTitle").textContent = S.moving === "share" ? "Share places" : "Import places";
    let html = "";
    if (S.moving === "share") {
        const n = S.places.length;
        html = `<div class="mv-card">${S.shareLink ? qrSvg(S.shareLink, 232) : `<span class="spinner big"></span>`}</div>
            <div class="mv-sub">${n} ${n === 1 ? "place" : "places"}  ·  ★ ${esc(placeName(pinned()))}</div>
            <div class="mv-btns">
                <button class="ph-btn" data-act="copyLink"${S.shareLink ? "" : " disabled"}>${icon("copy", 16)}Copy link</button>
                ${navigator.share ? `<button class="ph-btn" data-act="shareSheet"${S.shareLink ? "" : " disabled"}>${icon("share", 16)}Share…</button>` : ""}
            </div>
            <div class="mv-btns"><button class="ph-btn quiet" data-act="importOpen">${icon("receive", 16)}Import</button></div>`;
    } else if (S.moving === "import") {
        const inc = S.incoming;
        if (!inc) {
            html = `<div class="search-wrap mv-paste">${icon("receive", 17)}
                    <input id="importText" type="url" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Paste a Flow Tides link"></div>
                ${S.importError ? `<div class="mv-err">${esc(S.importError)}</div>` : ""}
                <div class="mv-btns">${navigator.clipboard && navigator.clipboard.readText ? `<button class="ph-btn" data-act="paste">${icon("copy", 16)}Paste</button>` : ""}</div>`;
        } else {
            const rows = inc.places.map((p, i) => {
                const have = S.places.find(q => sameStation(q, p));
                const tag = !have ? "new" : JSON.stringify(cleanForCompare(have)) === JSON.stringify(cleanForCompare({ ...have, ...p })) ? "same" : "update";
                return `<div class="mv-row"><span class="mv-name">${i === inc.pinned ? "★ " : ""}${esc(p.name)}</span>
                    <span class="mv-tag ${tag}">${S.places.length ? tag : ""}</span></div>`;
            }).join("");
            const n = inc.places.length;
            html = `${section({ title: n + (n === 1 ? " place" : " places"), pad: 0, gap: 0, body: rows })}
                <div class="mv-btns">
                ${inSafariTab() ? `<button class="ph-btn primary" data-act="copyForApp">${icon("copy", 16)}Copy for the home-screen app</button>` : ""}
                ${S.places.length
                    ? `<button class="ph-btn${inSafariTab() ? "" : " primary"}" data-act="importMerge">Add to mine</button>
                       <button class="ph-btn" data-act="importReplace">Replace mine</button>`
                    : `<button class="ph-btn${inSafariTab() ? "" : " primary"}" data-act="importMerge">Add ${n === 1 ? "it" : "them"}</button>`}
                </div>`;
        }
    }
    const body = $("#moveBody");
    const keep = document.activeElement && document.activeElement.id === "importText" ? document.activeElement.value : null;
    morphInto(body, html);
    if (keep !== null && $("#importText")) { $("#importText").value = keep; }
}
const cleanForCompare = p => ({ name: p.name, river: p.river || "", tide: p.tide || "", hide: p.hide || [], ideal: p.ideal || {}, jetty: p.jetty || {} });

let toastTimer = 0;
const toastMs = () => S.toast.actionText === "Undo" ? LOOK.undoToastMs : LOOK.toastMs;
function toast(text, actionText, action) {
    S.toast = { shown: true, text, actionText, action };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, toastMs());
}
function hideToast() { S.toast.shown = false; S.undoData = null; render(); }

// Back gesture / Esc: leave the add page, edit mode or a picked day. false = nothing to go back from
// One step at a time, innermost first: a page or panel on top (on the places list: its
// search, then Edit, then the list itself), then a picked day (back to the week), then
// another place (back to the ★ place).
function goBack() {
    if (S.sortOpen) S.sortOpen = false;
    else if (S.adding) closeAdd();
    else if (S.moving) closeMove();
    else if (listShown() && S.lsearch) endSearch();
    else if (S.editing) { S.editing = false; S.newGroups = []; }
    else if (S.listing) zoomInto(rowFor(S.selected), closeList);
    else if (S.customizing) closeCustomize();
    else if (S.hist) S.hist = null;
    else if (S.focusDay >= 0) { S.focusDay = -1; S.hourHover = -1; flash.week = true; }
    else if (S.places.length && S.selected !== pinned()) select(pinned());
    else return false;
    return true;
}
// Nothing left to go back from: a desktop wrapper (Linux panel) closes its popup.
const embedded = () => !!document.documentElement.dataset.embed;
function backAtTop() { if (embedded()) console.info("flowtides:close"); }
// Picking a day shows that day. A reading bar on another day moves to the same
// time of day on the picked one (and picks that hour in the day's weather).
function pickDay(start) {
    S.hist = null;
    S.focusDay = S.focusDay === start ? -1 : start;
    S.hourHover = -1;
    const t = bigChart.hoverT;
    if (S.focusDay < 0 || isNaN(t) || (t >= start && t < start + DAY_MS)) return;
    const a = new Date(t), d = new Date(start);
    d.setHours(a.getHours(), a.getMinutes(), 0, 0);
    bigChart.hoverT = bigChart.pinT = d.getTime();
    setTimeout(() => syncWeather(bigChart.hoverT));   // after this render
}

// Everything you looked at (another place, another chart, a future day) is
// forgotten when you leave the app for a while, so it reopens on "now" for the ★ place.
function resetView() {
    if (S.moving === "share") S.moving = "";
    S.adding = false; S.editing = false; S.listing = false; S.lsearch = false; S.addedKeys = []; S.toast.shown = false; S.nowOpen = false; S.customizing = false;
    S.selected = pinned(); S.chartMode = ""; S.focusDay = -1; S.hourHover = -1; S.hist = null;
    bigChart.hoverT = bigChart.pinT = NaN;
    $("#q").blur();
    const lq = $("#lq"); lq.value = ""; lq.blur();
    $("#scroll").scrollTop = 0;
}

// ── data ────────────────────────────────────────────────────────────
// Refresh order: the place on screen first (everything), then the rest together:
// the ★ place in full, the others only what the places list shows. Weather, water
// temperature and typical flow for another place download when you open it.
let fetchSeq = 0;
const fullAt = {};                                    // place key -> last full download (ms)
function mergeResult(p) {
    const old = S.results[p.key];
    if (old && !p.river && !p.tide) return { ...old, errors: p.errors };   // a failed download never wipes readings
    if (!old || !p.light) return p;
    // the list's part only: keep what the details page had
    const out = { ...p, weather: old.weather, light: old.light };
    if (p.river && old.river) out.river = { ...p.river, temp: old.river.temp, averages: old.river.averages,
                                            flowSeries: p.river.flowSeries || old.river.flowSeries };
    return out;
}
async function fetchSome(list, fullKeys) {
    if (!list.length) return { offline: false };
    // places getting everything: tiles they might still get (e.g. Water for a just-added
    // gauge, known only once USGS answers) spin until then
    const full = list.map(keyOf).filter(k => (!fullKeys || fullKeys.has(k)) && !loadingKeys.has(k));
    full.forEach(k => loadingKeys.add(k));
    ptrSync();
    let r;
    // each place's readings show as soon as they're in, not after its weather / waves
    const onPart = part => {
        const old = S.results[part.key];
        const m = mergeResult(part);
        for (const k of ["weather", "surf"]) if (part[k] === undefined) m[k] = old ? old[k] : undefined;
        delete m.partial;
        S.results[part.key] = m;
        const pl = list.find(q => keyOf(q) === part.key);
        if (pl) noteAvail(pl, part);
        if (listShown() || keyOf(S.places[S.selected]) === part.key) render();   // on screen
    };
    try { r = await fetchPlaces(list, fullKeys, onPart); } catch (e) { return { error: "Couldn't get data: " + e.message }; }
    finally { full.forEach(k => loadingKeys.delete(k)); }
    for (const p of r.places) {
        S.results[p.key] = mergeResult(p);
        const pl = list.find(q => keyOf(q) === p.key);
        if (pl) noteAvail(pl, p);
        if (!p.light) fullAt[p.key] = Date.now();
    }
    S.updated = Math.max(S.updated || 0, r.time);
    return r;
}
// Resolves to {downloads, offline} (pull-to-refresh says "Up to date" when nothing was due).
// onShown(result) runs once the place on screen is done (before the others).
async function refresh(onShown) {
    const seq = ++fetchSeq;
    S.loading = true;
    render();
    const shown = S.places[S.selected], star = S.places[pinned()];
    const a = await fetchSome(shown ? [shown] : [], undefined);
    if (onShown) onShown(a);
    render();
    const rest = S.places.filter(p => p !== shown);
    const b = await fetchSome(rest, new Set(star && star !== shown ? [keyOf(star)] : []));
    if (seq === fetchSeq) {
        S.loading = false;
        S.error = a.error || b.error || "";
        S.offline = S.places.length > 0 && (!shown || a.offline) && (!rest.length || b.offline);   // no places: nothing to be offline about
    }
    if (!S.offline) saveSnapshot();
    rememberRivers();
    render();
    if (seq === fetchSeq && !waitingForLink) hideSplash();   // done, even if it failed: show what there is
    return { downloads: (a.downloads || 0) + (b.downloads || 0), offline: S.offline };
}
// Opening a place: if its details weren't downloaded in the last 15 minutes, get them now.
function freshenShown() {
    const p = S.places[S.selected];
    if (!p || Date.now() - (fullAt[keyOf(p)] || 0) < 15 * 60000) return;
    fullAt[keyOf(p)] = Date.now();                    // don't ask twice while it loads
    fetchSome([p], undefined).then(() => render());
    render();                                         // its maybe-coming tiles spin meanwhile
}
// Each river gauge's river name (for groups), saved with the place once known.
function rememberRivers() {
    let changed = false;
    const list = S.places.map(p => {
        if (!p.river || p.rv) return p;
        const d = S.results[keyOf(p)];
        if (!d || !d.river || !d.river.name) return p;
        changed = true;
        return { ...p, rv: shortName(d.river.name) };
    });
    if (changed) { S.places = list; save("rt:places", list); }
    fillStates();
}
// The last readings, kept where they load instantly at startup (before anything else).
function saveSnapshot() {
    try {
        const keys = new Set(S.places.map(keyOf)), results = {};
        for (const k of keys) if (S.results[k]) results[k] = S.results[k];
        const json = JSON.stringify({ t: S.updated, results });
        if (json.length < 2e6) localStorage.setItem("rt:snap", json); else localStorage.removeItem("rt:snap");
    } catch (e) { /* full or private: the slower saved copies still work */ }
}
let searchTimer = 0;
async function runSearch(text) {
    const q = text.trim(), seq = ++S.searchSeq;
    if (q.length < 2) { S.searching = false; S.searchResults = []; S.searchError = ""; render(); return; }
    S.searching = true; S.slowSearch = false;
    render();
    const slow = setTimeout(() => { if (seq === S.searchSeq) { S.slowSearch = true; render(); } }, 2500);
    const r = await searchStations(q).catch(e => ({ rivers: [], tides: [], error: e.message }));
    clearTimeout(slow);
    if (seq !== S.searchSeq) return;                  // an older search; ignore
    S.searching = false;
    S.searchResults = (r.rivers || []).concat(r.tides || []);
    S.searchError = r.error || "";
    render();
}

// ════════════ rendering ════════════
const flash = { selected: false, week: false, day: false };   // one-shot fade-ins
const bigChart = new Chart({ lineWidth: LOOK.lineWidth, fillOpacity: LOOK.fillOpacity, minSpanHours: LOOK.chartMinZoomHours,
                            onHover: t => syncWeather(t) });
let dragging = null;     // reorder in progress (render waits)
let ptrSync = () => {};  // keeps the refresh spinner in step with the place on screen (set in wire)

function section({ title = "", leading = "", trailing = "", pad = 12, gap = 6, body = "", cls = "", id = "" }) {
    const head = title || leading || trailing
        ? `<div class="sec-head">${leading ? `<div class="sec-lead">${leading}</div>` : ""}<div class="sec-title">${esc(title.toUpperCase())}</div><div class="sec-trail">${trailing}</div></div>`
        : "";
    return `<div class="sec ${cls}"${id ? ` id="${id}"` : ""}>${head}<div class="sec-box" style="padding:${pad}px;gap:${gap}px">${body}</div></div>`;
}

// Under the flow chart: the typical (median) flow on this calendar date over every year
// the USGS gauge has. Follows the reading bar's day, else the picked day, else today.
function avgText(r, t) {
    const d = new Date(isNaN(t) ? (S.focusDay >= 0 ? S.focusDay : Date.now()) : t);
    const v = r && r.averages && r.averages[String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")];
    return num(v) ? "Typical flow on " + fmtMonthDay(d.getTime()) + ": " + cfs(v) : "";
}
function tile({ title, num, unit, detail, mode, active, accent, shape: k = null, wait = false }) {
    const long = String(num).length >= 5 ? " long" : "";   // e.g. 1,920 or −19.2k: a bit smaller, so number + unit fit
    if (wait) return `<div class="tile still wait" style="--accent:${accent}"><div class="t-title">${title}</div><span class="spinner"></span></div>`;
    return `<button class="tile${active ? " active" : ""}${mode ? "" : " still"}" ${mode ? `data-act="mode" data-mode="${mode}"` : ""} style="--accent:${accent}">
        <div class="t-title">${title}${k === null ? "" : `<span class="t-shape" style="color:${shapeColor(k)}">${shapeWord(k)}</span>`}</div>
        <div class="t-val${long}"><b>${esc(num)}</b><span class="u">${esc(unit)}</span></div>
        ${detail ? `<div class="t-det">${esc(detail)}</div>` : ""}
    </button>`;
}

function renderHeader(cur) {
    const hdr = $("#hdr");
    const place = S.places[S.selected];
    if (!place) { morphInto(hdr, ""); return; }
    const d = cur.d, r = cur.r, t = cur.t;
    // a station whose charts are all switched off (Customize → Show) isn't named
    const off = ms => ms.every(m => hidden(place, m));
    // each station's name opens a map at the exact spot of the gauge / tide station
    // (↗ in front, so a long name cut off at the edge still shows it opens something)
    const pin = (label, s) => isFinite(parseFloat(s.lat)) && isFinite(parseFloat(s.lon))
        ? `<a class="hmap" href="https://www.google.com/maps/search/?api=1&query=${parseFloat(s.lat)},${parseFloat(s.lon)}" target="_blank" rel="noopener"><span class="hmap-arrow lead">↗</span>${esc(label)}</a>`
        : esc(label);
    const sub = [r && !off(["stage", "flow", "temp"]) ? pin(r.name, r) : "", t && !off(["tide", "surf"]) ? pin("Tides: " + t.name, t) : ""]
        .filter(s => s).join("  ·  ");
    const n = d && d.weather ? d.weather.now : null;
    const wx = LOOK.showWeather && n && has(n.temp)
        ? `<button class="hwx" data-act="nowToggle">${wxIcon(n.code, n.day, 34)}<span class="hwx-t"><span class="hwx-temp">${n.temp}°</span><span class="hwx-word">${esc(wxWord(n.code))}</span></span></button>`
        : "";
    const isPin = S.selected === pinned(), k = placeShape(place, d);
    morphInto(hdr, `<div class="hrow">
        ${d ? `<button class="hcz${S.customizing ? " on" : ""}" data-act="customize" aria-label="Customize">${icon("sliders", 20)}</button>` : ""}
        <div class="hname">
            <div class="htitle"><h1>${esc(place.name)}</h1>${k === null ? "" : `<span class="hshape" style="color:${shapeColor(k)}">${shapeWord(k)}</span>`}</div>
            ${sub ? `<div class="hsub">${sub}</div>` : ""}
        </div>
        ${wx}
        <button class="hstar${isPin ? " on" : ""}" data-act="pin" data-i="${S.selected}">${icon("star", 24)}</button>
    </div>
    ${S.nowOpen && n ? `<div class="hnow">${has(n.feels) ? `Feels like ${n.feels}° · ` : ""}Wind ${n.wind} mph ${compass(n.windDir)}, gusts ${n.gust} mph</div>` : ""}`);
}

// past the last measurement: say the number is from the forecast, or how old it is
const riverDetail = (r, normal) => r.predicted ? "Forecast · measured " + ago(r.obsTime) : r.stale ? "Measured " + ago(r.time) : normal;
function renderTiles(cur) {
    const { d, r, t, mode, place: p } = cur;
    if (!d) return "";
    const T = {};   // by tab, so a tile that's still downloading keeps its place
    if (r && hasStage(r) && !hidden(p, "stage")) T.stage = tile({ title: "HEIGHT", accent: LOOK.stageColor, mode: "stage", active: mode === "stage",
        num: has(r.stage) ? r.stage.toFixed(1) : "–", unit: " ft " + arrow(r.stageTrend, 0.05), detail: riverDetail(r, change(r.stageTrend, " ft", 2)) });
    if (r && has(r.flow) && !hidden(p, "flow")) T.flow = tile({ title: "FLOW", accent: LOOK.flowColor, mode: "flow", active: mode === "flow",
        num: cfsTile(r.flow), unit: " cfs " + arrow(r.flowTrend, Math.abs(r.flow) * 0.02),
        detail: nativeFlow(r) ? riverDetail(r, change(r.flowTrend, " cfs", 0))
              : r.flowSeries ? (Date.now() - r.flowTime > MEASURED_FOR ? "Measured " + ago(r.flowTime) : change(r.flowTrend, " cfs", 0))
              : r.flowNote + ", " + ago(r.flowTime) });
    if (r && r.temp && !hidden(p, "temp")) T.temp = tile({ title: "WATER", accent: LOOK.tempColor, mode: "temp", active: mode === "temp",
        num: Math.round(r.temp.value).toString(), unit: " °F " + arrow(r.temp.trend, 0.3),
        detail: Date.now() - r.temp.time > MEASURED_FOR ? "Measured " + ago(r.temp.time) : change(r.temp.trend, " °F", 1) });
    if (t && !hidden(p, "tide")) T.tide = tile({ title: "TIDE", accent: LOOK.tideColor, mode: "tide", active: mode === "tide",
        num: has(t.height) ? t.height.toFixed(1) : "–", unit: " ft " + (t.rising === null ? "" : t.rising ? "↑" : "↓"),
        detail: (t.rising ? "Rising" : "Falling") + (t.live ? "" : " (predicted)") });
    const h = surfNow(d.surf);
    if (h && !hidden(p, "surf")) T.surf = tile({ title: "WAVES", accent: LOOK.surfColor, mode: "surf", active: mode === "surf",
        num: has(h[1]) ? h[1].toFixed(1) : "–", unit: " ft", detail: Math.round(h[2]) + " s " + compass(h[3]) + " · " + rateWord(rate(h, jettyLim(p))) });
    const TITLES = { stage: ["HEIGHT", LOOK.stageColor], flow: ["FLOW", LOOK.flowColor], temp: ["WATER", LOOK.tempColor],
                     tide: ["TIDE", LOOK.tideColor], surf: ["WAVES", LOOK.surfColor] };
    const out = Object.keys(TITLES).map(m => T[m] || (waiting(p, d, m) ? tile({ title: TITLES[m][0], accent: TITLES[m][1], wait: true }) : "")).filter(x => x);
    if (!out.length) return "";
    return `<div class="tiles n${out.length}">${out.join("")}</div>`;
}

// ── history (Flow / Water temp at a USGS gauge) ────────────────────
// "History" under the chart turns it into a longer view: range chips (1 wk … 5 yr),
// the river's line (good range colors kept) and a faint dashed typical line for each
// date. Done, the back swipe, another tab or place go back. Only downloaded when opened.
const HIST_RANGES = [["1w", "1 wk"], ["1m", "1 mo"], ["3m", "3 mo"], ["1y", "1 yr"], ["5y", "5 yr"]];
const histData = {};   // "site|mode|range" -> {loading} | {data} | {error}
function histSite(cur) {
    const r = cur.r;
    if (!r || !r.usgs || cur.mode === "stage") return "";
    return cur.mode === "temp" ? (r.temp ? r.usgs : "") : cur.mode === "flow" && has(r.flow) ? r.usgs : "";
}
const clearHistErrors = () => { for (const k in histData) if (histData[k].error) delete histData[k]; };
function loadHistory(key, site, mode, range) {
    histData[key] = { loading: true };
    history(site, mode, range).then(data => { histData[key] = { data }; }, () => { histData[key] = { error: true }; }).then(render);
}
function renderHistory(cur) {
    const { r, mode, place: p } = cur, site = r.usgs, range = S.hist.range, key = site + "|" + mode + "|" + range;
    if (!histData[key]) loadHistory(key, site, mode, range);
    const h = histData[key];
    const temp = mode === "temp", color = temp ? LOOK.tempColor : LOOK.flowColor;
    const chips = HIST_RANGES.map(([k, l]) => `<button class="hist-chip${k === range ? " on" : ""}" data-act="histRange" data-r="${k}">${l}</button>`).join("");
    let body;
    if (h.data && h.data.series.length > 1) {
        cur.g = { series: h.data.series, forecast: [], typical: h.data.typical, color, decimals: temp ? 1 : 0,
                  unit: temp ? " °F" : " cfs", ideal: temp ? null : idealOf(p, "flow"), markers: [], threshold: NaN,
                  nowValue: NaN, dates: range !== "1w", noNow: range !== "1w", history: true };
        // a legend here (unlike the other charts): two lines that are easy to mix up
        body = `<canvas id="bigChart" class="big-chart" style="height:${LOOK.chartHeight}px"></canvas>
            <div class="hist-legend" style="--accent:${color}"><span class="lg-solid"></span>${temp ? "Recorded Temp" : "Recorded Flow"}${h.data.typical.length > 1
                ? `<span class="lg-dash"></span>${temp ? "Average Temp" : "Average Flow"}` : ""}</div>`;
    } else {
        cur.g = null;
        body = `<div class="chart-empty" style="height:${LOOK.chartHeight}px">${h.loading ? `<span class="spinner"></span>`
            : h.error ? "Couldn't get the history" : "No history for this range"}</div>`;
    }
    const what = (temp ? "Water temperature · °F" : "Flow · cfs") + (range === "1w" ? "" : " · daily averages") + " · USGS";
    return section({ pad: 9, body: `<div class="hist-chips" style="--accent:${color}">${chips}</div>${body}
        <div class="hist-foot"><span class="chart-label">${esc(what)}</span><button class="edit-btn on" data-act="historyDone">Done</button></div>` });
}

function renderChart(cur) {
    const { d, r, mode } = cur;
    if (d && S.hist && S.hist.mode === mode && S.focusDay < 0 && histSite(cur)) return renderHistory(cur);
    const g = bigGraph(d, mode, cur.place);
    cur.g = g;
    if (!d) return "";
    // a gauge with only its latest flow (no history to draw): say so where the chart goes
    if (g.series.length <= 1 && mode === "flow" && r && has(r.flow))
        return section({ pad: 9, body: `<div class="chart-empty">No flow history at this gauge</div>
            <div class="chart-label">${esc("Latest " + commas(r.flow) + " cfs · " + r.flowNote + " · " + ago(r.flowTime))}</div>` });
    if (g.series.length <= 1) return "";
    const b = g.ideal, rng = !b ? "" : " · good " + (isNaN(b.lo) ? "below " + b.hi : isNaN(b.hi) ? "above " + b.lo : b.lo + "–" + b.hi);
    const what = (mode === "surf" ? "Waves (swell + wind waves) · ft" : mode === "tide" ? "Tide · ft" : mode === "flow" ? "Flow · cfs"
        : mode === "temp" ? "Water temperature · °F · USGS, measured" : "Height · ft") + rng;
    const day = S.focusDay < 0 ? "" : g.dayCovered ? " · " + dayLabel(S.focusDay) : " · no data for " + dayLabel(S.focusDay);
    const avg = r && mode === "flow" ? avgText(r, bigChart.hoverT) : "";
    const hist = S.focusDay < 0 && histSite(cur);
    const under = hist ? `<div class="hist-row">${avg ? `<span class="chart-peak" id="chartAvg">${esc(avg)}</span>` : ""}<button class="edit-btn" data-act="history" style="color:${mode === "temp" ? LOOK.tempColor : LOOK.flowColor}">View History</button></div>`
        : avg ? `<div class="chart-peak" id="chartAvg">${esc(avg)}</div>` : "";
    return section({ pad: 9, body: `
        <canvas id="bigChart" class="big-chart" style="height:${LOOK.chartHeight}px"></canvas>
        <div class="chart-label">${esc(what + day)}</div>
        ${under}` });
}

function renderTides(cur) {
    const t = cur.t;
    if (!t || hidden(cur.place, "tide") || hidden(cur.place, "tidelist")) return "";
    const list = S.focusDay < 0 ? t.next : (t.week || []).filter(e => e.time >= S.focusDay && e.time < S.focusDay + DAY_MS);
    if (!list.length) return "";
    const today = new Date().getDate();
    const cols = list.map(e => `<div class="tcol">
        <div class="tword"><span class="tri${e.type === "H" ? "" : " lo"}">${e.type === "H" ? "▲" : "▼"}</span>${esc(tideWord(e) +
            // a tide after midnight gets its day name, so "Low 5:29a" can't be mistaken for today
            (S.focusDay < 0 && new Date(e.time).getDate() !== today ? " · " + fmtDay(e.time) : ""))}</div>
        <div class="ttime">${clockShort(e.time)}</div>
        <div class="tft">${ft(e.height)}</div>
    </div>`).join("");
    return section({ title: S.focusDay >= 0 ? "Tides · " + dayLabel(S.focusDay) : "Next tides", body: `<div class="tides">${cols}</div>` });
}

// hourly graph geometry (px): the time + icon strip on top, rain chance (the big
// graph), then a small temperature line. Without rain the rain graph shrinks.
const HR = { padX: 16, topH: 46 };
function hourGeom(hrs) {
    const temps = hrs.map(h => h.temp).filter(has);
    const tmin = temps.length ? Math.min(...temps) : 0, tmax = temps.length ? Math.max(...temps) : 1;
    const span = Math.max(6, tmax - tmin);
    const rainy = hrs.some(h => (h.pop || 0) >= LOOK.rainDimBelow);
    // each graph: a caption row (14 px), room for its peak labels, then the graph
    const rcap = HR.topH + 4, rb0 = rcap + 14 + (rainy ? 18 : 6), rb1 = rb0 + (rainy ? 50 : 14);   // rain bars: 100% … 0%
    const tcap = rb1 + 10, t0 = tcap + 14 + 18, t1 = t0 + 22;                                     // temperature band
    return { tmin, tmax, span, rainy, rcap, rb0, rb1, tcap, t0, t1, H: t1 + 20,
             yAt: v => t1 - ((v - (tmin + tmax - span) / 2) / span) * (t1 - t0),
             rainY: p => rb1 - Math.max(0, Math.min(100, p)) / 100 * (rb1 - rb0) };
}
// The turning points of a series (zigzag): {i, hi} at each high and low that's at
// least `min` away from the one before. The ends count when they're a high or low.
function turns(vals, min) {
    const out = [];
    let dir = 0, hiI = -1, loI = -1;
    vals.forEach((v, i) => {
        if (!has(v)) return;
        if (hiI < 0) { hiI = loI = i; return; }
        if (dir >= 0 && v > vals[hiI]) hiI = i;
        if (dir <= 0 && v < vals[loI]) loI = i;
        if (dir >= 0 && vals[hiI] - v >= min) { out.push({ i: hiI, hi: true }); dir = -1; loI = i; }
        else if (dir <= 0 && v - vals[loI] >= min) { out.push({ i: loI, hi: false }); dir = 1; hiI = i; }
    });
    if (dir > 0) out.push({ i: hiI, hi: true });
    if (dir < 0) out.push({ i: loI, hi: false });
    if (!out.length && hiI >= 0) out.push({ i: hiI, hi: true });   // flat: just the top
    return out;
}
// …without two labels on the same side closer than `gap` hours (the bigger one stays)
function spaced(list, vals, gap) {
    const out = [];
    for (const x of list) {
        const k = out.findIndex(y => y.hi === x.hi && Math.abs(y.i - x.i) < gap);
        if (k < 0) out.push(x);
        else if (x.hi ? vals[x.i] > vals[out[k].i] : vals[x.i] < vals[out[k].i]) out[k] = x;
    }
    return out;
}

function renderWeather(cur) {
    const d = cur.d;
    const days = wxDays(d ? d.weather : null);
    if (!LOOK.showWeather || !days.length) return "";
    const lo = Math.min(...days.map(x => x.lo)), hi = Math.max(...days.map(x => x.hi));
    const dayIdx = days.findIndex(x => x.start === S.focusDay);
    const day = dayIdx >= 0 ? days[dayIdx] : null;
    const hours = day ? wxHours(d.weather, day.start) : [];
    const dayMode = !!day && hours.length > 1;
    cur.hours = dayMode ? hours : [];
    const title = !dayMode ? "7-day weather"
        : (day.label === "Today" ? "Today" : fmtDayLong(day.start)) + " · " + fmtMonthDay(day.start);
    const leading = dayMode ? `<button class="week-pill" data-act="week">${icon("back", 11)}Week</button>` : "";
    const trailing = dayMode ? [-1, 1].map(k => {
        const to = dayIdx + k, ok = to >= 0 && to < days.length;
        return `<button class="step" data-act="day" data-start="${ok ? days[to].start : ""}"${ok ? "" : " disabled"}>${icon(k < 0 ? "back" : "next", 14)}</button>`;
    }).join("") : "";

    let body;
    if (!dayMode) {
        const span = Math.max(1, hi - lo);
        body = `<div class="wx-week${flash.week ? " fadein" : ""}">${days.map(x => `
            <button class="wx-day" data-act="day" data-start="${x.start}">
                <div class="wd-label${x.label === "Today" ? " today" : ""}">${x.label}</div>
                ${wxIcon(x.code, true, 24)}
                <div class="wd-pop">${(x.pop || 0) >= LOOK.rainDimBelow ? x.pop + "%" : "&nbsp;"}</div>
                <div class="wd-hi">${has(x.hi) ? x.hi + "°" : "–"}</div>
                <div class="wd-bar"><div style="top:${(28 * (hi - x.hi) / span).toFixed(1)}px;height:${Math.max(3, 28 * (x.hi - x.lo) / span).toFixed(1)}px"></div></div>
                <div class="wd-lo">${has(x.lo) ? x.lo + "°" : "–"}</div>
            </button>`).join("")}</div>`;
    } else {
        const x = day, n = hours.length, G = hourGeom(hours);
        const pos = i => `left:calc(${HR.padX}px + (100% - ${2 * HR.padX}px) * ${(i / (n - 1)).toFixed(4)})`;
        const past = h => h.t + 3600000 <= Date.now() ? " past" : "";
        const temps = hours.map(h => h.temp), pops = hours.map(h => h.pop || 0);
        // times + icons every 3 h; numbers only at the highs and lows
        const labels = `<div class="hr-cap" style="top:${G.rcap}px">Rain chance · %</div>`
            + `<div class="hr-cap" style="top:${G.tcap}px">Temperature · °F</div>`
            + hours.map((h, i) => i).filter(i => new Date(hours[i].t).getHours() % 3 === 0).map(i => {
            const h = hours[i];
            return `<div class="hr-col${past(h)}" style="${pos(i)}">
                    <div class="hr-time">${clockShort(h.t).replace(":00", "")}</div>${wxIcon(h.code, h.day, 20)}</div>`;
        }).join("")
        + spaced(turns(temps, 4), temps, 4).filter(x => has(temps[x.i])).map(({ i, hi }) =>
            `<div class="hr-temp${past(hours[i])}" style="${pos(i)};top:${(G.yAt(temps[i]) + (hi ? -16 : 3)).toFixed(1)}px">${temps[i]}°</div>`).join("")
        + (G.rainy ? spaced(turns(pops, 15).filter(x => x.hi && pops[x.i] >= LOOK.rainDimBelow), pops, 3).map(({ i }) =>
            `<div class="hr-pop${past(hours[i])}" style="${pos(i)};top:${(G.rainY(pops[i]) - 15).toFixed(1)}px">${pops[i]}%</div>`).join("") : "");
        const hv = S.hourHover >= 0 ? hours[S.hourHover] : null;
        body = `<div class="wx-dayview${flash.day ? " fadein" : ""}">
            <div class="wd-sum">
                ${wxIcon(x.code, true, 36)}
                <div class="wd-sum-l"><b>${esc(wxWord(x.code))}</b><div><span style="color:${LOOK.warmColor}">H ${x.hi}°</span> <span style="color:${LOOK.coolColor}">L ${x.lo}°</span></div></div>
                <div class="wd-sum-r">
                    <div style="${(x.pop || 0) >= LOOK.rainDimBelow ? `color:${LOOK.rainColor}` : "opacity:.6"}">Rain ${x.pop || 0}%${x.rain > 0 ? " · " + x.rain.toFixed(2) + " in" : ""}</div>
                    <div class="dim">Wind ${x.wind} · gusts ${x.gust} mph${x.dir ? " " + x.dir : ""}</div>
                    ${x.rise && x.set ? `<div class="dim">Sun ${clockShort(x.rise)} – ${clockShort(x.set)}</div>` : ""}
                </div>
            </div>
            <div class="hourly" style="height:${G.H}px"><canvas id="hourCanvas"></canvas>${labels}</div>
            <div id="hourLine" class="hour-line${hv ? " on" : ""}">${hv ? esc(hourText(hv)) : "&nbsp;"}</div>
        </div>`;
    }
    return section({ title, leading, trailing, pad: 6, body, id: "wxSec" });
}
const hourText = h => clockShort(h.t) + " · " + h.temp + "° " + wxWord(h.code)
    + " · rain " + (h.pop || 0) + "%" + (h.rain > 0 ? " " + h.rain.toFixed(2) + " in" : "")
    + " · wind " + h.wind + ", gusts " + h.gust + " mph";

function renderSurf(cur) {
    const d = cur.d, t = cur.t;
    const days = hidden(cur.place, "surf") ? [] : surfDays(d ? d.surf : null, jettyLim(cur.place));
    if (!days.length) return "";
    const legend = [0, 1, 2].map(l => `<span class="legend"><i style="background:${rateColor(l)}"></i>${rateWord(l)}</span>`).join("");
    const rows = days.map(x => {
        const tides = t && t.week ? t.week.filter(e => e.time >= x.start && e.time < x.start + DAY_MS) : [];
        const on = S.focusDay === x.start;
        const waves = Math.round(x.lo) === Math.round(x.hi) ? Math.round(x.hi) + " ft" : Math.round(x.lo) + "–" + Math.round(x.hi) + " ft";
        const cells = x.slots.map(s => `<i style="background:${rateColor(s.level)};opacity:${s.level < 0 ? 0.15 : s.day ? 0.95 : 0.3}"></i>`).join("");
        return `<button class="srow${on ? " on" : ""}" data-act="surfDay" data-start="${x.start}">
            <div class="sline">
                <span class="pill" style="background:${rateColor(x.level)}">${x.label}</span>
                <span class="swave">${waves}</span>
                <span class="sper">${Math.round(x.period)}s ${x.dir} · ${Math.round(x.gust)} mph</span>
                <span class="strip">${cells}</span>
            </div>
            ${tides.length ? `<div class="stides">${tides.map(e => `<span class="${e.type === "H" ? "" : "lo"}">${e.type} ${clockShort(e.time)}</span>`).join("")}</div>` : ""}
            ${on ? `<div class="smore">Biggest swell ${ft(x.swell)} @ ${Math.round(x.swellPeriod)} s ${x.swellDir} · ${x.calm ? "Calm " + x.calm : "No calm daylight hours"}</div>` : ""}
        </button>`;
    }).join("");
    return section({ title: "Jetty / surf · 7 days", trailing: legend, pad: 4, gap: 0, body: rows });
}

// "Customize" panel: tabs shown, good ranges, jetty limits, stations.
function numField(attrs, value, unit, mode = "decimal") {
    const v = num(value) ? String(value) : "";
    // data-key holds the saved value, so a reset or a cleaned-up value replaces the field
    return `<span class="cz-num"><input class="cz-in" type="text" inputmode="${mode}" enterkeyhint="done" autocomplete="off"
        placeholder="–" value="${esc(v)}" data-key="${esc(v)}" ${attrs}>${unit ? `<span class="cz-u">${unit}</span>` : ""}</span>`;
}
// Customize opens at the top of the place, between the name and the tiles: it
// unfolds downward (and folds back up) instead of the page jumping to it.
let czEntering = false, czLeaving = false;
function openCustomize() {
    czEntering = true; czLeaving = false; S.customizing = true;
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => { czEntering = false; render(); }));
}
function closeCustomize() {
    if (!S.customizing) return;
    S.customizing = false; czLeaving = true;
    setTimeout(() => { czLeaving = false; render(); }, Math.max(1, ANIM * 1.4) + 40);
}
function renderCustomize(cur) {
    const html = customizePanel(cur);
    return html ? `<div class="czwrap${S.customizing && !czEntering ? " open" : ""}"><div>${html}</div></div>` : "";
}
function customizePanel(cur) {
    const p = cur.place, d = cur.d;
    if (!(S.customizing || czLeaving) || !p || !d) return "";
    // what the data has, plus switched-off ones the station has (or might: never checked)
    const got = haveModes(d);
    const have = Object.keys(MODES).filter(m => got.includes(m) || (availOf(p, m) !== false && (hidden(p, m) || waiting(p, d, m))));
    const chips = have.map(m => {
        const on = !hidden(p, m);
        return `<button class="cz-chip${on ? " on" : ""}" data-act="toggleTab" data-mode="${m}" style="--accent:${{ stage: LOOK.stageColor, flow: LOOK.flowColor, temp: LOOK.tempColor, tide: LOOK.tideColor, surf: LOOK.surfColor }[m]}">${MODES[m]}</button>`;
    }).join("") + (have.includes("tide") && !hidden(p, "tide")
        ? `<button class="cz-chip${hidden(p, "tidelist") ? "" : " on"}" data-act="toggleTab" data-mode="tidelist" style="--accent:${LOOK.tideColor}">Next tides</button>` : "");
    const unit = { stage: "ft", flow: "cfs", tide: "ft" };
    const ranges = have.filter(m => unit[m] && !hidden(p, m)).map(m => {   // only tabs that are shown
        const r = (p.ideal && p.ideal[m]) || [null, null], int = m === "flow" ? "numeric" : "decimal";
        return `<div class="cz-row"><span class="cz-label">${MODES[m]}</span>
            ${numField(`data-set="ideal" data-mode="${m}" data-side="0"`, r[0], "", int)}<span class="cz-to">to</span>
            ${numField(`data-set="ideal" data-mode="${m}" data-side="1"`, r[1], unit[m], int)}</div>`;
    }).join("");
    const L = jettyLim(p), custom = !!p.jetty;
    const jetty = have.includes("surf") && !hidden(p, "surf") ? `
        <div class="cz-head">Jetty / surf rating${custom ? `<button class="cz-link" data-act="resetJetty">Reset</button>` : ""}</div>
        <div class="cz-row"><span class="cz-label" style="color:${LOOK.calmColor}">Calm</span><span class="cz-to">waves up to</span>${numField(`data-set="jetty" data-k="calm"`, L.calm, "ft")}</div>
        <div class="cz-row"><span class="cz-label" style="color:${LOOK.sketchyColor}">Sketchy</span><span class="cz-to">waves above</span>${numField(`data-set="jetty" data-k="sketchy"`, L.sketchy, "ft")}</div>
        <div class="cz-row"><span class="cz-label">Gusts</span><span class="cz-to" style="color:${LOOK.cautionColor}">caution</span>${numField(`data-set="jetty" data-k="cautionGust"`, L.cautionGust, "", "numeric")}<span class="cz-to" style="color:${LOOK.sketchyColor}">sketchy</span>${numField(`data-set="jetty" data-k="sketchyGust"`, L.sketchyGust, "mph", "numeric")}</div>
        <div class="cz-note">In between is caution. “Waves” is the total wave height (swell + wind waves) from Open-Meteo’s forecast model, not a buoy; tap a day in Jetty / surf for the swell alone.</div>` : "";
    const both = !!(p.river && p.tide);
    const station = (kind, label, name) => p[kind] ? `<div class="cz-row"><span class="cz-label">${label}</span>
        <span class="cz-stn">${esc(name || p[kind])}</span>
        ${both ? `<button class="cz-rm" data-act="removeStation" data-kind="${kind}">Remove</button>` : ""}</div>`
        : `<div class="cz-row"><span class="cz-label">${label}</span><button class="cz-add" data-act="attach" data-kind="${kind}">${icon("plus", 12)}Add ${kind === "tide" ? "tide station" : "river gauge"}</button></div>`;
    const body = `
        <div class="cz-head">Name</div>
        <input class="cz-name" type="text" enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false"
            data-set="name" value="${esc(p.name)}" data-key="${esc(p.name)}">
        <div class="cz-head">Show</div>
        <div class="cz-chips">${chips}</div>
        ${ranges ? `<div class="cz-head">Good range</div>${ranges}
        <div class="cz-note">The line turns green inside the range and red outside. Leave a side blank for no limit.</div>` : ""}
        ${jetty}
        <div class="cz-head">Stations</div>
        ${station("river", "River", cur.r && cur.r.name + (cur.r.usgs ? " · USGS " + cur.r.usgs : ""))}
        ${station("tide", "Tides", cur.t && cur.t.name)}
        ${both ? "" : `<div class="cz-note">To remove the last station, remove the place under Edit.</div>`}`;
    return section({ id: "czSec", title: "Customize · " + p.name, pad: 10, gap: 6,
        trailing: `<button class="edit-btn on" data-act="customize">Done</button>`, body });
}

// ── river groups ────────────────────────────────────────────────────
// Places on the same river ("McKenzie River near Vida", "… at Coburg") group
// automatically in the places list (2+ places). Edit → + Group makes your own group
// (e.g. "Coast"), and dragging places in and out of it is how they join or leave;
// your own groups show even with one place. place.rv remembers the river's name;
// place.group is the override ("" = kept out of its river's group).
// Rivers with the same name in different states stay apart: NOAA marks some ("Deschutes
// River (OR)"), and place.st (the gauge's state, from the station list) marks the rest
// when another place's river shares the name: "Deschutes (OR)" and "Deschutes (WA)".
function riverOf(p) {   // [name, state] or null
    if (!p || !p.river) return null;
    const d = S.results[keyOf(p)];
    const raw = p.rv || (d && d.river && d.river.name ? shortName(d.river.name) : "");
    if (!raw) return null;
    const [name, st] = splitState(tidyRiver(raw));
    return [name, st || p.st || "", !!st];
}
function autoRiver(p) {
    const r = riverOf(p);
    if (!r) return "";
    const [name, st, marked] = r, k = name.toLowerCase();
    const clash = !!st && S.places.some(q => { const o = q !== p && riverOf(q); return o && o[0].toLowerCase() === k && o[1] && o[1] !== st; });
    return marked || clash ? `${name} (${st})` : name;
}
const sameRiverName = (a, b) => splitState(tidyRiver(a))[0].toLowerCase() === splitState(tidyRiver(b))[0].toLowerCase();
// A place on its own named just like its river shows the river's full name ("Deschutes (WA)").
function placeLabel(i) {
    const p = S.places[i], r = autoRiver(p);
    return r && r !== p.name && sameRiverName(p.name, r) ? r : p.name;
}
// Places added before the state was kept get it from the station list.
let statesAsked = false;
function fillStates() {
    const need = S.places.filter(p => p.river && !p.st).map(p => p.river);
    if (!need.length || statesAsked) return;
    statesAsked = true;
    gaugeStates(need).then(st => {
        if (!Object.keys(st).length) return;
        S.places = S.places.map(p => p.river && !p.st && st[p.river] ? { ...p, st: st[p.river] } : p);
        save("rt:places", S.places);
        render();
    }).catch(() => {}).finally(() => { statesAsked = false; });
}
const groupOf = p => (p.group !== undefined ? p.group : autoRiver(p)).trim();
// The list in order: single places, and groups (river groups with 2+ places, your own
// with any) where their first place is.
function listItems() {
    const count = {}, own = {};
    S.places.forEach(p => {
        const g = groupOf(p).toLowerCase();
        if (g) { count[g] = (count[g] || 0) + 1; if (p.group) own[g] = true; }
    });
    const out = [], seen = {};
    S.places.forEach((p, i) => {
        const g = groupOf(p), k = g.toLowerCase();
        if (!k || (count[k] < 2 && !own[k])) { out.push({ i }); return; }
        if (!seen[k]) { seen[k] = { key: k, name: g, members: [] }; out.push(seen[k]); }
        seen[k].members.push(i);
    });
    return out;
}
// Inside a group, a place named just like the group shows where it is instead ("Vida").
function memberLabel(i, groupName) {
    const p = S.places[i];
    if (!sameRiverName(p.name, groupName)) return p.name;
    const d = S.results[keyOf(p)], n = d && d.river ? d.river.name : "";
    const m = n.match(/ (?:near|nr|at) (.+)$/) || n.match(/ ((?:above|below|abv|blw) .+)$/);
    const loc = m ? m[1].replace(/,.*$/, "").trim() : "";
    return loc ? loc[0].toUpperCase() + loc.slice(1) : p.name;
}
// ── sorting the places list ──
// How often each place was opened from the list, kept on the phone only (a number per
// place, by its first station so adding the other one keeps the count).
const viewKey = p => p && p.river ? "r:" + p.river : p && p.tide ? "t:" + p.tide : "";
const VIEWS = load("rt:views", {});
const viewsOf = i => VIEWS[viewKey(S.places[i])] || 0;
function noteView(i) {
    const k = viewKey(S.places[i]);
    if (!k) return;
    VIEWS[k] = (VIEWS[k] || 0) + 1;
    save("rt:views", VIEWS);
}
function moveViews(before, after) {
    const a = viewKey(before), b = viewKey(after);
    if (!a || !b || a === b || !VIEWS[a]) return;
    VIEWS[b] = (VIEWS[b] || 0) + VIEWS[a];
    delete VIEWS[a];
    save("rt:views", VIEWS);
}
const SORTS = [["mine", "Custom order"], ["az", "A–Z"], ["views", "Most viewed"]];
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
// The list's items in the picked order. Groups stay together: A–Z by the group's (or
// place's) name, then A–Z inside; Most viewed by the group's total, then inside. Ties
// keep your own order.
function sortedItems() {
    const items = listItems();
    if (S.sort !== "az" && S.sort !== "views") return items;
    const az = S.sort === "az";
    const name = it => it.members ? it.name : placeLabel(it.i);
    const score = it => it.members ? it.members.reduce((t, i) => t + viewsOf(i), 0) : viewsOf(it.i);
    const out = items.map((it, k) => ({ ...it, k }));
    out.sort((a, b) => (az ? byName(name(a), name(b)) : score(b) - score(a)) || a.k - b.k);
    for (const it of out) {
        if (!it.members) continue;
        const m = it.members.map((i, k) => ({ i, k }));
        m.sort((x, y) => (az ? byName(memberLabel(x.i, it.name), memberLabel(y.i, it.name)) : viewsOf(y.i) - viewsOf(x.i)) || x.k - y.k);
        it.members = m.map(x => x.i);
    }
    return out;
}
// Changing the order: rows glide from where they were to their new spots.
function glideRows(change) {
    const rows = () => [...document.querySelectorAll("#placesList .prow")].map(r => [r.dataset.key || "g:" + r.dataset.g, r]);
    const before = new Map(rows().map(([k, r]) => [k, r.getBoundingClientRect().top]));
    change();
    render();
    if (!ANIM) return;
    for (const [k, r] of rows()) {
        const t = before.get(k), dy = t === undefined ? 0 : t - r.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: ANIM * 1.6, easing: "cubic-bezier(.33,1,.68,1)" });
    }
}
// One "Sort: A–Z" button over the list; tapping it pops out the choices (the picked one
// tinted). Picking one, tapping anywhere else or Back closes it.
function sortChips() {
    const cur = (SORTS.find(([k]) => k === S.sort) || SORTS[0])[1];
    // Edit (+ Group and Done while editing) at the row's right end
    return `<div class="sort-row">
        <div class="sort-wrap${S.editing ? " off" : ""}">
            <button class="sort-btn${S.sortOpen ? " open" : ""}" data-act="sortMenu">Sort: <b>${cur}</b><span class="sort-chev">${icon("next", 11)}</span></button>
            <div class="sort-menu${S.sortOpen ? " on" : ""}">${SORTS.map(([k, l]) =>
                `<button class="sort-opt${k === S.sort ? " on" : ""}" data-act="sort" data-s="${k}">${l}</button>`).join("")}</div>
        </div>
        ${S.editing ? `<button class="top-btn" data-act="newGroup">${icon("plus", 14)}Group</button>` : ""}
        <button class="top-btn${S.editing ? " strong" : ""}" data-act="edit">${S.editing ? "Done" : "Edit"}</button>
    </div>`;
}
// The second line in the places list: the station names, like under the name at the top
// of a place (a station whose charts are all switched off isn't named; ids until the
// first download).
function stationLine(i) {
    const p = S.places[i], d = S.results[keyOf(p)] || {};
    const off = ms => ms.every(m => hidden(p, m));
    return [p.river && !off(["stage", "flow", "temp"]) ? (d.river && d.river.name) || p.river : "",
            p.tide && !off(["tide", "surf"]) ? "Tides: " + ((d.tide && d.tide.name) || p.tide) : ""].filter(x => x).join("  ·  ");
}
function placeRow(i, o) {
    const p = S.places[i], isPin = i === pinned();
    const parts_ = S.editing ? "" : parts(dataFor(i), p).map(x => `<span class="ppart" style="color:${x.color}">${esc(x.text)}</span>`).join("");
    return `<div class="prow${o.hidden ? " hide" : ""}${o.first ? " first" : ""}${o.member ? " member" : ""}${listShown() && wide() && !S.editing && i === S.selected ? " shown" : ""}${!S.editing && i === S.swiped ? " swiped" : ""}"${!S.editing && i === S.swiped ? ` style="--sx:-84px"` : ""}
                 data-key="${esc(keyOf(p))}" ${S.editing ? `data-gm="${esc(o.gm || "")}"` : `data-act="select"`} data-i="${i}">
        ${S.editing ? `<button class="bubble neg" data-act="remove" data-i="${i}">−</button>` : `<canvas class="spark" data-spark="${i}"></canvas>`}
        <div class="pmain"><div class="pname">${esc(o.label || placeLabel(i))}</div></div>
        ${parts_ ? `<div class="pparts">${parts_}</div>` : ""}
        ${S.editing ? "" : `<button class="pstar${isPin ? " on" : ""}" data-act="pin" data-i="${i}">${icon("star", 18)}</button>`}
        ${S.editing ? `<div class="handle" data-i="${i}">${icon("handle", 20)}</div>` : `<button class="pdel" data-act="remove" data-i="${i}">Delete</button>`}
        <div class="psub full">${esc(stationLine(i))}</div>
    </div>`;
}

function renderPlaces() {
    if (!S.places.length) return "";
    // The place on screen stays in the list (lightly highlighted), so places compare easily.
    if (!S.editing) {   // grouped, folders open/close; Edit mode below shows every place
        let rows = "", first = true;
        for (const it of sortedItems()) {
            if (it.members === undefined) {
                rows += placeRow(it.i, { first });
                first = false;
                continue;
            }
            const open = S.openGroups.has(it.key);
            const holdsShown = wide() && !open && it.members.includes(S.selected);   // the place on the right is inside, folded away
            rows += `<div class="prow grp${first ? " first" : ""}${open ? " open" : ""}${holdsShown ? " shown" : ""}" data-act="toggleGroup" data-g="${esc(it.key)}">
                <div class="ghead"><span class="gchev">${icon("next", 14)}</span></div>
                <div class="pmain"><div class="pname">${esc(it.name)}<span class="gcount">${it.members.length}</span></div></div>
                <div class="gsparks">${it.members.slice(0, 4).map(i => `<canvas class="spark gs" data-spark="${i}"></canvas>`).join("")}</div>
            </div>`;
            first = false;
            if (open) for (const i of it.members) rows += placeRow(i, { member: true, label: memberLabel(i, it.name) });
        }
        return section({ id: "placesSec", pad: 0, gap: 0, body: `<div id="placesList">${rows}</div>` });
    }
    // Edit mode: every place with its ≡ handle; each group is a tinted box (always
    // open) with its name field, − (ungroup) and its own ≡. Drag places into and
    // out of the boxes (see startDrag).
    // Places with the same name (e.g. three "McKenzie") also show where they are.
    const named = {};
    S.places.forEach(p => { const k = p.name.toLowerCase(); named[k] = (named[k] || 0) + 1; });
    const label = i => {
        const p = S.places[i], loc = named[p.name.toLowerCase()] > 1 ? memberLabel(i, p.name) : "";
        return loc && loc !== p.name ? p.name + " · " + loc : placeLabel(i);
    };
    const head = (name, n, first) => `<div class="prow grp gedit${first ? " first" : ""}" data-key="g:${esc(name.toLowerCase())}" data-g="${esc(name.toLowerCase())}" data-name="${esc(name)}">
        <button class="bubble neg" data-act="ungroup" data-g="${esc(name.toLowerCase())}">−</button>
        <input class="gname" type="text" enterkeyhint="done" autocomplete="off" autocorrect="off" spellcheck="false"
            data-g="${esc(name.toLowerCase())}" value="${esc(name)}">
        <span class="gcount">${n || ""}</span>
        <div class="handle" data-g="${esc(name.toLowerCase())}">${icon("handle", 20)}</div>
    </div>`;
    const box = (name, inner) => `<div class="gbox" data-key="gb:${esc(name.toLowerCase())}" data-g="${esc(name.toLowerCase())}" data-name="${esc(name)}">${inner}</div>`;
    let rows = "", first = true;
    for (const name of S.newGroups) { rows += box(name, head(name, 0, true)); first = false; }
    for (const it of sortedItems()) {   // in the order on screen, so nothing moves going into Edit
        if (it.members === undefined) { rows += placeRow(it.i, { first, label: label(it.i) }); first = false; continue; }
        rows += box(it.name, head(it.name, it.members.length, true) +
            it.members.map(i => placeRow(i, { member: true, gm: it.key, label: memberLabel(i, it.name) })).join(""));
        first = false;
    }
    return section({ id: "placesSec", pad: 0, gap: 0, body: `<div id="placesList">${rows}</div>` });
}

function renderBody(cur) {
    if (dragging) { dragging.pending = true; return; }
    let html = "";
    if (!S.places.length) {
        html += `<div class="placeholder"><img class="ph-logo" src="icons/icon-192.png" alt=""><div class="ph-text">No places yet</div>
            <div class="ph-expl">Add a river gauge or a tide station.</div>
            <button class="ph-btn" data-act="add">${icon("plus", 16)}Add a place</button>
            <button class="ph-btn quiet" data-act="importOpen">${icon("receive", 16)}Import</button></div>`;
    }
    const place = cur.place;
    if (place) {
        const errs = [S.error].concat(cur.d ? cur.d.errors : []).filter(s => s && !(S.offline && /can't connect|timed out/.test(s)));
        let sel = "";
        if (errs.length) sel += `<div class="errors">${errs.map(esc).join("<br>")}</div>`;
        if (!cur.d) sel += `<div class="loading"><span class="spinner"></span>Getting the latest from NOAA…</div>`;
        if (flooding(cur.r)) sel += `<div class="flood" style="--accent:${categoryColor(cur.r.category)}">⚠ ${esc(cur.r.categoryLabel)}</div>`;
        sel += renderCustomize(cur);
        sel += renderTiles(cur);
        sel += renderChart(cur);
        sel += renderWeather(cur);
        sel += renderTides(cur);
        sel += renderSurf(cur);
        html += `<div class="selected${flash.selected ? " fadein-slow" : ""}">${sel}</div>`;
    }
    morphInto($("#body"), html);
}

function renderFooter() {
    morphInto($("#ftr"), `
        <div class="fstat">${S.loading ? "Updating…  ·  NOAA" : S.offline ? "Offline" + (S.updated ? "  ·  updated " + dayClock(S.updated) : "")
            : S.updated ? "Updated " + dayClock(S.updated) + "  ·  NOAA" : "NOAA"}</div>
        ${S.places.length ? `<button class="fbtn round" data-act="share" aria-label="Share places">${icon("share", 16)}</button>` : ""}
        <a class="fbtn" href="mailto:flowtidessupport@gmail.com?subject=Flow%20Tides">${icon("mail", 15)}Contact</a>
        <button class="fbtn round flist${wide() && !S.listHidden ? " on" : ""}" data-act="list" aria-label="Places">${icon("list", 24)}</button>
        <div class="egg">Stop looking at your phone and go fishing!</div>`);
}

// The places list page: its top row, then the list, or search results while searching.
function renderList() {
    const picks = listShown() && S.lsearch && S.addedKeys.length > 0;
    const commit = $("#listCommit");
    commit.classList.toggle("on", picks);
    if (picks) commit.textContent = addLabel();
    const page = $("#listPage");
    page.classList.toggle("picking", picks);
    page.classList.toggle("searching", S.lsearch);
    page.classList.toggle("editing", S.editing);
    $("#lqCancel").classList.toggle("on", S.lsearch);
    morphInto($("#listTop"), `<h1 class="ltitle">Places</h1>`);
    // Sort and Edit stay under the search bar while the list scrolls
    morphInto($("#listTools"), S.places.length ? sortChips() : "");
    const results = S.lsearch && ($("#lq").value.trim() || !S.places.length);
    morphInto($("#listBody"), results || !S.places.length ? hitsHtml(true, true, $("#lq").value.trim().length) : renderPlaces());
}

function renderAdd() {
    const rivers = S.attachKind !== "tide", tides = S.attachKind !== "river";
    const commit = $("#addCommit"), picks = S.adding && S.attachTo < 0 && S.addedKeys.length > 0;
    commit.classList.toggle("on", picks);
    if (picks) commit.textContent = addLabel();
    $("#addPage").classList.toggle("picking", picks);
    $("#addTitle").textContent = S.attachTo < 0 ? "Add a place"
        : (S.attachKind === "tide" ? "Tides for " : "River gauge for ") + placeName(S.attachTo);
    $("#q").placeholder = tides && rivers ? "River, town, bay or gauge id" : tides ? "Search tide stations" : "Search river gauges";
    if (S.adding) morphInto($("#addBody"), hitsHtml(rivers, tides, $("#q").value.trim().length));
}
// Search results (river gauges, tide stations) with ✓ / + and Map ↗, or a hint.
function hitsHtml(rivers, tides, qlen) {
    const riverHits = S.searchResults.filter(x => x.kind === "river"), tideHits = S.searchResults.filter(x => x.kind === "tide");
    const shown = (rivers ? riverHits.length : 0) + (tides ? tideHits.length : 0);
    let html = "";
    if (shown) {
        for (const g of [
            { kind: "river", title: "RIVER GAUGES", show: rivers, hits: riverHits, color: LOOK.stageColor },
            { kind: "tide", title: "TIDE STATIONS", show: tides, hits: tideHits, color: LOOK.tideColor },
        ]) {
            if (!g.show || !g.hits.length) continue;
            html += `<div class="rtitle" style="color:${g.color}">${g.title}</div>`;
            html += g.hits.map(h => {
                const picked = addedNow(h), have = !picked && alreadyHave(h);
                return `<div class="hit${have ? " have" : ""}${picked ? " picked" : ""}" style="--accent:${g.color}" data-act="${have || picked ? "unHit" : "addHit"}" data-kind="${h.kind}" data-id="${esc(h.id)}">
                    <div class="hit-main"><div class="hit-name">${esc(h.name)}</div>
                        <div class="hit-sub">${esc([h.state, h.usgs === h.id ? "" : h.id, h.usgs ? "USGS " + h.usgs : ""].filter(s => s).join("  ·  ") + (have ? "  ·  already added" : ""))}</div></div>
                    ${isFinite(parseFloat(h.lat)) && isFinite(parseFloat(h.lon)) ? `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${parseFloat(h.lat)},${parseFloat(h.lon)}" target="_blank" rel="noopener">Map<span class="hmap-arrow">↗</span></a>` : ""}
                    <span class="bubble" style="background:${have ? "var(--disabled)" : g.color}">${have || picked ? "✓" : "+"}</span>
                </div>`;
            }).join("");
        }
    } else if (S.searching) {
        html = `<div class="placeholder"><span class="spinner big"></span><div class="ph-expl">${S.slowSearch ? "Downloading NOAA's station list…<br>(first time only, ~30 s)" : "Searching…"}</div></div>`;
    } else {
        html = `<div class="placeholder">${icon(qlen < 2 ? "search" : "empty", 44, "ph-icon")}
            <div class="ph-text">${qlen < 2 ? "Find a river or tide station" : "No matches"}</div>
            <div class="ph-expl">${esc(S.searchError || (qlen < 2 ? "Try “Rogue”, “Newport OR”, “Coos Bay” or a gauge id like SNDO3." : "Try fewer words, or the town nearest the gauge."))}</div></div>`;
    }
    return html;
}

function renderToast() {
    const t = S.toast, el = $("#toast");
    el.classList.toggle("on", t.shown);
    const picks = (S.adding || listShown()) && S.attachTo < 0 && S.addedKeys.length > 0;
    el.classList.toggle("above-footer", !S.adding && !S.listing);   // above the bottom bar
    el.classList.toggle("above-commit", picks);                      // above the floating Add button
    if (t.shown) {
        $("#toastText").textContent = t.text;
        const a = $("#toastAct");
        a.textContent = t.actionText;
        a.hidden = !t.actionText;
    }
}

function render() {
    const place = S.places[S.selected] || null;
    const d = dataFor(S.selected);
    const cur = { place, d, r: d ? d.river : null, t: d ? d.tide : null, mode: bestMode(d, S.chartMode, place) };
    applyWide();
    document.body.classList.toggle("listing", S.listing);
    document.body.classList.toggle("adding", S.adding);
    document.body.classList.toggle("editing", S.editing);
    document.body.classList.toggle("moving", !!S.moving);
    renderHeader(cur);
    renderBody(cur);
    renderFooter();
    renderList();
    renderAdd();
    renderMove();
    renderToast();
    flash.selected = flash.week = flash.day = false;
    paint(cur);
    ptrSync();
    if ((!S.places.length && !waitingForLink) || d) hideSplash();
}

// ── splash (index.html): the logo until the shown place has something to show ──
let splashSlow = 0;
let waitingForLink = !S.places.length && !!codeFrom(location.hash);   // a new user's link: keep the logo up until its data
function splashText(text) { const el = $("#splashText"); if (el) el.textContent = text; }
function hideSplash() {
    const el = $("#splash");
    clearTimeout(splashSlow);
    if (!el || el.classList.contains("gone")) return;
    el.classList.add("gone");
    setTimeout(() => el.remove(), 300);
}

// ── canvases ────────────────────────────────────────────────────────
let lastCur = null;
function paint(cur = lastCur) {
    if (!cur) return;
    lastCur = cur;
    const cv = $("#bigChart");
    // the reading bar stays put across tabs and picked days; only another place clears it
    const hk = S.hist ? "|h|" + S.hist.range : "";
    if (cv && cur.g) bigChart.set(cv, cur.g, S.selected + "|" + cur.mode + "|" + S.focusDay + hk, S.hist ? "h" + S.selected + hk : String(S.selected));
    else bigChart.cv = null;
    document.querySelectorAll("canvas[data-spark]").forEach(c => drawSpark(c, listSpark(+c.dataset.spark), 1.25, LOOK.fillOpacity));
    paintHourly(cur);
    syncWeather(bigChart.hoverT);
}

// The big chart's reading bar and the weather follow each other:
//   week view: the day under the bar is highlighted (not opened)
//   day view:  the hour under the bar is picked, and picking an hour moves the bar
function syncWeather(t) {
    if (S.hist) return;   // history dates aren't this week's weather
    const ok = !isNaN(t) && !!$("#bigChart");
    const av = $("#chartAvg");
    if (av && lastCur && lastCur.r) { const s = avgText(lastCur.r, t); if (s) av.textContent = s; }
    document.querySelectorAll(".wx-day").forEach(el => {
        const a = +el.dataset.start;
        el.classList.toggle("hl", ok && t >= a && t < a + DAY_MS);
    });
    const H = lastCur && lastCur.hours;
    if (!ok || !H || H.length < 2 || t < H[0].t || t >= H[H.length - 1].t + 3600000) return;
    let i = 0;
    while (i + 1 < H.length && H[i + 1].t <= t) i++;
    if (i === S.hourHover) return;
    S.hourHover = i;
    const line = $("#hourLine");
    if (line) { line.textContent = hourText(H[i]); line.classList.add("on"); }
    paintHourly();
}

function paintHourly(cur = lastCur) {
    const cv = $("#hourCanvas");
    const H = cur && cur.hours;
    if (!cv || !H || H.length < 2) return;
    bindHourly(cv);
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, Ht = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Ht * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Ht * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Ht);
    const n = H.length, s = (W - HR.padX * 2) / (n - 1), xAt = i => HR.padX + i * s, G = hourGeom(H);
    const style = getComputedStyle(document.documentElement);
    const tc = style.getPropertyValue("--text").trim();
    const now = Date.now(), done = i => H[i].t + 3600000 <= now;
    const rr = (x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); ctx.fill(); };
    // night: shaded behind the times and icons only
    ctx.globalAlpha = 0.07; ctx.fillStyle = tc;
    for (let i = 0; i < n; i++) {
        if (H[i].day || (i > 0 && !H[i - 1].day)) continue;
        let j = i;
        while (j + 1 < n && !H[j + 1].day) j++;
        const x0 = Math.max(0, xAt(i) - s / 2), x1 = Math.min(W, xAt(j) + s / 2);
        rr(x0, 0, x1 - x0, HR.topH - 4, 8);
    }
    // rain chance: a bar per hour, on a faint 0–100% track when there's rain to read
    const bw = Math.max(2, s * 0.62), hv = S.hourHover;
    for (let i = 0; i < n; i++) {
        if (G.rainy) { ctx.fillStyle = tc; ctx.globalAlpha = 0.045; rr(xAt(i) - bw / 2, G.rb0, bw, G.rb1 - G.rb0, 2); }
        const p = H[i].pop || 0;
        if (p <= 0) continue;
        const y = G.rainY(p);
        ctx.fillStyle = LOOK.rainColor;
        ctx.globalAlpha = (p >= LOOK.rainDimBelow ? 0.85 : 0.35) * (done(i) && i !== hv ? 0.5 : 1);
        rr(xAt(i) - bw / 2, y, bw, Math.max(1.5, G.rb1 - y), 2);
    }
    ctx.globalAlpha = 1;
    // temperature: a thin line
    const pts = [];
    for (let i = 0; i < n; i++) if (has(H[i].temp)) pts.push([xAt(i), G.yAt(H[i].temp)]);
    if (pts.length > 1) {
        const grad = ctx.createLinearGradient(0, G.t0, 0, G.t1);
        grad.addColorStop(0, LOOK.warmColor); grad.addColorStop(1, LOOK.coolColor);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length - 1; k++) {
            const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
            ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.lineWidth = 1.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.strokeStyle = grad; ctx.stroke();
    }
    // now
    if (now >= H[0].t && now <= H[n - 1].t) {
        const x = HR.padX + (now - H[0].t) / 3600000 * s;
        ctx.globalAlpha = 0.45; ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, HR.topH); ctx.lineTo(x, Ht); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // picked hour
    if (hv >= 0 && hv < n) {
        const x = xAt(hv);
        ctx.globalAlpha = 0.8; ctx.strokeStyle = LOOK.weatherColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, HR.topH); ctx.lineTo(x, Ht); ctx.stroke(); ctx.globalAlpha = 1;
        if (has(H[hv].temp)) { ctx.fillStyle = LOOK.weatherColor; ctx.beginPath(); ctx.arc(x, G.yAt(H[hv].temp), 3, 0, Math.PI * 2); ctx.fill(); }
    }
}

// Drag a finger along the hourly graph (or tap it) to read one hour.
function bindHourly(cv) {
    if (cv._bound) return;
    cv._bound = true;
    let start = null, scrub = false;
    const pick = e => {
        const H = lastCur && lastCur.hours;
        if (!H || H.length < 2) return;
        const x = e.clientX - cv.getBoundingClientRect().left, s = (cv.clientWidth - HR.padX * 2) / (H.length - 1);
        const i = Math.max(0, Math.min(H.length - 1, Math.round((x - HR.padX) / s)));
        if (i === S.hourHover) return;
        S.hourHover = i;
        const line = $("#hourLine");
        line.textContent = hourText(H[i]); line.classList.add("on");
        paintHourly();
        if (lastCur && lastCur.g) bigChart.showTime(H[i].t);   // same hour on the big chart
    };
    cv.addEventListener("pointerdown", e => { start = { x: e.clientX, y: e.clientY }; scrub = e.pointerType === "mouse"; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => {
        if (e.pointerType === "mouse") { pick(e); return; }
        if (!start) return;
        if (!scrub && Math.abs(e.clientX - start.x) > 6 && Math.abs(e.clientX - start.x) > Math.abs(e.clientY - start.y)) scrub = true;
        if (scrub) { e.preventDefault(); pick(e); }
    });
    cv.addEventListener("pointerup", e => { if (start && !scrub) pick(e); start = null; scrub = false; });
    cv.addEventListener("pointercancel", () => { start = null; scrub = false; });
}

// ── drag to reorder (Edit mode, by the ≡ handle) ────────────────────
// The lifted row follows the finger; the rows it passes slide out of its way.
// Edit: drag by ≡. The row floats under the finger and a gap shows where it will
// land. A group is a tinted box; dragging a place over a box puts the gap inside it
// (the box grows around it), dragging it below the box's end takes it back out.
// A group dragged by its own ≡ moves as a whole, between the other places and groups.
function startDrag(e, handle) {
    e.preventDefault();
    const list = $("#placesList"), prow = handle.closest(".prow");
    if (!prow || dragging) return;
    const isBox = prow.classList.contains("gedit"), actual = isBox ? prow.closest(".gbox") : prow;
    const r = actual.getBoundingClientRect();
    const ph = document.createElement("div");
    ph.className = "drag-ph";
    ph.style.height = r.height + "px";
    actual.parentNode.insertBefore(ph, actual);
    Object.assign(actual.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", boxSizing: "border-box", zIndex: 50, margin: 0 });
    actual.classList.add("lifted");
    document.body.classList.add("dragging");
    dragging = { row: actual, isBox, ph, list, grab: e.clientY - r.top, y: e.clientY, pending: false };
    handle.setPointerCapture(e.pointerId);
    const scroller = $("#listScroll");
    const others = el => [...el.children].filter(x => x !== actual && x !== ph);
    const mid = x => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; };
    const nextOf = x => { let n = x.nextElementSibling; while (n === actual) n = n.nextElementSibling; return n; };
    const place = Y => {
        const top = others(list);
        let parent = list, before = null;
        const idx = top.findIndex(x => Y < x.getBoundingClientRect().bottom);
        const over = idx >= 0 && Y >= top[idx].getBoundingClientRect().top ? top[idx] : null;
        if (over && over.classList.contains("gbox") && !isBox) {
            const [head, ...mem] = others(over);
            if (Y < mid(head)) before = over;                                   // upper half of the name: just above the group
            else { parent = over; before = mem.find(x => Y < mid(x)) || null; }  // in the box
        } else if (over) before = Y < mid(over) ? over : top[idx + 1] || null;
        else before = idx >= 0 ? top[idx] : null;                               // in a gap: before what comes next
        if (ph.parentNode === parent && nextOf(ph) === before) return;
        parent.insertBefore(ph, before);
    };
    const frame = () => {
        const D = dragging;
        if (!D || D.dropping) return;
        const sr = scroller.getBoundingClientRect();
        if (D.y < sr.top + 50) scroller.scrollTop -= 6; else if (D.y > sr.bottom - 50) scroller.scrollTop += 6;
        D.row.style.top = (D.y - D.grab) + "px";
        place(D.y - D.grab + D.row.offsetHeight / 2);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const moveH = ev => { if (dragging) dragging.y = ev.clientY; };
    const up = () => {
        handle.removeEventListener("pointermove", moveH);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        const D = dragging;
        D.dropping = true;
        const to = ph.getBoundingClientRect();
        D.row.style.transition = `top ${ANIM * 0.8}ms cubic-bezier(.33,1,.68,1)`;
        D.row.style.top = to.top + "px";
        D.row.classList.remove("lifted");
        setTimeout(() => {
            document.body.classList.remove("dragging");
            ph.parentNode.insertBefore(D.row, ph);
            ph.remove();
            D.row.removeAttribute("style");
            dragging = null;
            dropInEdit(D);
            render();
        }, Math.max(1, ANIM * 0.8));
    };
    handle.addEventListener("pointermove", moveH);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
}

// After a drag in Edit, the list on screen is the new order; a dragged place's
// group is the box it ended up in (none if outside every box).
// Dragging while the list is sorted A–Z / Most viewed starts your own order from what's
// on screen: that order (with the move) becomes "Custom order".
function dropInEdit(D) {
    if (S.sort !== "mine") { S.sort = "mine"; save("rt:sort", S.sort); }
    const order = [...D.list.querySelectorAll(".prow[data-i]")].map(x => +x.dataset.i);
    if (D.isBox) { reorder(order); return; }
    const box = D.row.parentNode.closest(".gbox"), was = D.row.dataset.gm || "";
    const g = box ? box.dataset.g : "";
    if (g === was) { reorder(order); return; }
    reorder(order, +D.row.dataset.i, box ? box.dataset.name : "");
}

// ════════════ events ════════════
const ACTIONS = {
    mode: el => { S.chartMode = el.dataset.mode; S.hist = null; },
    // a failed download gets tried again when history is opened or a range picked
    history: () => { clearHistErrors(); if (lastCur) S.hist = { mode: lastCur.mode, range: "1m" }; },
    histRange: el => { clearHistErrors(); S.hist = { ...S.hist, range: el.dataset.r }; },
    historyDone: () => { S.hist = null; },
    day: el => {
        if (!el.dataset.start) return;
        const wasDay = S.focusDay >= 0;
        pickDay(+el.dataset.start);
        if (S.focusDay >= 0) flash.day = true; else if (wasDay) flash.week = true;
    },
    week: () => { S.focusDay = -1; S.hourHover = -1; flash.week = true; },
    surfDay: el => {
        const cur = bestMode(dataFor(S.selected), S.chartMode, S.places[S.selected]);
        pickDay(+el.dataset.start);
        if (cur !== "tide") S.chartMode = "surf";
    },
    // Opening scrolls down to the panel; closing glides back up to the top first and
    // only then takes the panel away (so the page doesn't jump as it gets shorter).
    // From anywhere on the page: glide up to the top first, then unfold / fold.
    customize: () => {
        glideThen(0, () => { if (S.customizing) closeCustomize(); else openCustomize(); });
        return "skip";
    },
    toggleTab: el => toggleTab(el.dataset.mode),
    removeStation: el => removeStation(el.dataset.kind),
    resetJetty: () => updatePlace(S.selected, p => { delete p.jetty; }),
    // Tapping a place in the list zooms into it (the list keeps its spot for next time).
    select: el => {
        const i = +el.dataset.i;
        noteView(i);
        zoomInto(el, () => { select(i); closeList(); });
        return "skip";
    },
    // Opening a group that runs off the bottom scrolls it into view (its name stays on screen).
    toggleGroup: el => {
        const k = el.dataset.g;
        if (S.openGroups.has(k)) { S.openGroups.delete(k); return; }
        S.openGroups.add(k);
        render();
        const head = [...document.querySelectorAll("#placesList .prow.grp")].find(x => x.dataset.g === k);
        let last = head;
        while (last && last.nextElementSibling && last.nextElementSibling.classList.contains("member")) last = last.nextElementSibling;
        if (head) setTimeout(() => reveal(head, last, $("#listScroll")), 30);
        return "skip";
    },
    pin: el => { const i = +el.dataset.i; if (i !== pinned()) pin(i); },
    share: () => { openShare(); return "skip"; },
    importOpen: () => { openImport(""); setTimeout(() => { const f = $("#importText"); if (f) f.focus({ preventScroll: true }); }, ANIM + 20); return "skip"; },
    copyLink: () => { copyText(S.shareLink).then(ok => { toast(ok ? "Link copied" : "Couldn't copy", "", null); render(); }); return "skip"; },
    shareSheet: () => { navigator.share({ title: "Flow Tides places", url: S.shareLink }).catch(() => {}); return "skip"; },
    paste: () => {
        navigator.clipboard.readText().then(t => openImport(t)).catch(() => { S.importError = "Couldn't paste"; render(); });
        return "skip";
    },
    copyForApp: () => {
        packSetup(S.incoming.places, S.incoming.pinned).then(c => copyText(shareUrl(c)))
            .then(ok => { toast(ok ? "Copied. In the app: Share → Import → Paste" : "Couldn't copy", "", null); render(); });
        return "skip";
    },
    importMerge: () => applyImport(false),
    importReplace: () => applyImport(true),
    // Edit / Done on the places list (the search bar folds away while editing)
    edit: () => {
        S.newGroups = []; S.swiped = -1; S.sortOpen = false;
        if (S.lsearch) endSearch();
        S.editing = !S.editing;
    },
    newGroup: () => {
        let name = "New group", n = 2;
        const taken = new Set(S.places.map(p => groupOf(p).toLowerCase()).concat(S.newGroups.map(g => g.toLowerCase())));
        while (taken.has(name.toLowerCase())) name = "New group " + n++;
        S.newGroups.unshift(name);
        render();
        const f = document.querySelector(`.gname[data-g="${name.toLowerCase()}"]`);
        if (f) { f.focus(); f.select(); }
        return "skip";
    },
    ungroup: el => ungroup(el.dataset.g),
    // Tapping an already-added result in search takes it back out (with Undo):
    // the station from its place if the place has another one, else the whole place.
    unHit: el => {
        const kind = el.dataset.kind, i = S.places.findIndex(p => p[kind] === el.dataset.id);
        if (i < 0) return;
        if (S.addedKeys.includes(keyOf(S.places[i]))) { unAdd([keyOf(S.places[i])]); return; }   // added this visit: just untick
        if (S.places[i].river && S.places[i].tide) removeStation(kind, i); else remove(i);
    },
    remove: el => {
        const i = +el.dataset.i, row = el.closest(".prow");
        S.swiped = -1;
        if (!row || row.classList.contains("removing")) return "skip";
        row.style.height = row.offsetHeight + "px";
        void row.offsetHeight;
        row.classList.add("removing");
        setTimeout(() => { remove(i); render(); }, Math.max(1, ANIM));
        return "skip";
    },
    nowToggle: () => { S.nowOpen = !S.nowOpen; },
    add: () => { openList(true); return "skip"; },          // "Add a place" (no places yet): the list's search
    // the list button: on a wide screen slides the list pane; on the phone opens the list
    list: () => { if (wide()) toggleListPane(); else zoomToList(); return "skip"; },
    sortMenu: () => { S.sortOpen = !S.sortOpen; },
    sort: el => {
        S.sortOpen = false;
        if (S.editing || el.dataset.s === S.sort) return;
        glideRows(() => { S.sort = el.dataset.s; save("rt:sort", S.sort); });
        return "skip";
    },
    attach: el => { openAdd(S.selected, el.dataset.kind); return "skip"; },
    refresh: () => { refresh(); return "skip"; },
    closeAdd: () => closeAdd(),
    addHit: el => {
        const item = S.searchResults.find(x => x.kind === el.dataset.kind && x.id === el.dataset.id);
        if (item && !alreadyHave(item)) addResult(item);
    },
};

// Glide the page to `top`, then run fn and re-render: a panel closes only once the
// page is back, so nothing jumps as the page gets shorter.
function glideThen(top, fn) {
    const f = $("#scroll");
    top = Math.max(0, Math.min(top, f.scrollHeight - f.clientHeight));
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        f.removeEventListener("scroll", onScroll);
        fn();
        render();
    };
    const onScroll = () => { if (Math.abs(f.scrollTop - top) <= 1) finish(); };
    if (Math.abs(f.scrollTop - top) <= 1 || !ANIM) { finish(); return; }
    f.addEventListener("scroll", onScroll, { passive: true });
    f.scrollTo({ top, behavior: "smooth" });
    setTimeout(finish, 900);   // in case the glide gets interrupted
}
// Scroll down just enough to show `last` whole, but never so far that `first` leaves
// the top of the screen (a long list: its start stays in view, the rest is a scroll away).
function reveal(first, last, f = $("#scroll")) {
    const fr = f.getBoundingClientRect();
    const need = last.getBoundingClientRect().bottom - (fr.bottom - 12);
    const room = first.getBoundingClientRect().top - (fr.top + 8);
    const by = Math.min(need, room, f.scrollHeight - f.clientHeight - f.scrollTop);
    if (by > 0) f.scrollTo({ top: f.scrollTop + by, behavior: ANIM ? "smooth" : "auto" });
}

function wire() {
    document.addEventListener("touchstart", () => {}, { passive: true });   // lets :active work on iOS

    // the sort menu is out: a tap anywhere else just closes it
    $("#app").addEventListener("click", e => {
        if (!S.sortOpen || e.target.closest(".sort-row")) return;
        e.stopPropagation(); e.preventDefault();
        S.sortOpen = false;
        render();
    }, true);
    $("#app").addEventListener("click", e => {
        if (e.target.closest("a")) return;            // map links open on their own
        const el = e.target.closest("[data-act]");
        if (!el || el.disabled) return;
        const fn = ACTIONS[el.dataset.act];
        if (!fn) return;
        if (fn(el) !== "skip") render();
    });

    // Pages slide in with CSS. Focusing a field on a page that's still sliding in made
    // the browser scroll the whole app sideways to show it (blank screen, no way back),
    // so the app frame never scrolls.
    const appEl = $("#app");
    appEl.addEventListener("scroll", () => { if (appEl.scrollLeft || appEl.scrollTop) appEl.scrollLeft = appEl.scrollTop = 0; });

    const scr = $("#scroll");

    $("#app").addEventListener("pointerdown", e => {
        const h = e.target.closest(".handle");
        if (h) startDrag(e, h);
    });

    // Swipe a place left in the Places list to delete it (same as Edit → −, with Undo):
    // a short swipe shows a Delete button, a long one deletes right away. Made hard to do
    // by accident: the swipe must be clearly sideways, the row resists once Delete is
    // fully out (UIScrollView's rubber-band curve, c = 0.55), and deleting outright
    // takes a drag of 3/4 of the row's width.
    const DEL_W = 84, rubber = (x, dim) => (x * dim * 0.55) / (dim + 0.55 * x);
    let sw = null, swallowClick = false;
    // (kept in S.swiped too, so a re-render while it's open keeps it open)
    const setSx = (row, px) => {
        row.style.setProperty("--sx", px + "px"); row.classList.toggle("swiped", px < 0);
        if (px < 0) S.swiped = +row.dataset.i; else if (S.swiped === +row.dataset.i) S.swiped = -1;
    };
    const closeSwipes = keep => document.querySelectorAll("#placesList .prow.swiped").forEach(r => { if (r !== keep) setSx(r, 0); });
    const lb = $("#listBody");
    lb.addEventListener("touchstart", e => {
        const row = e.target.closest("#placesList .prow[data-act=select]");
        if (!e.target.closest(".pdel")) closeSwipes(row);
        const t = e.touches[0];
        sw = row && !S.editing && e.touches.length === 1 && t.clientX > 24
            ? { row, x: t.clientX, y: t.clientY, base: row.classList.contains("swiped") ? -DEL_W : 0, sx: 0, raw: 0, mode: "" } : null;
    }, { passive: true });
    lb.addEventListener("touchmove", e => {
        if (!sw) return;
        const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
        if (!sw.mode) {
            if (Math.abs(dx) > 14 && Math.abs(dx) > 2 * Math.abs(dy)) sw.mode = "h";
            else if (Math.abs(dy) > 8 || Math.abs(dx) > 14) { sw = null; return; }   // scrolling, or not sideways enough
            else return;
        }
        e.preventDefault();
        sw.raw = Math.min(0, sw.base + dx);
        const over = -sw.raw - DEL_W;
        sw.sx = over > 0 ? -(DEL_W + rubber(over, sw.row.offsetWidth)) : sw.raw;
        sw.row.classList.add("dragx");
        setSx(sw.row, sw.sx);
    }, { passive: false });
    lb.addEventListener("touchend", () => {
        if (!sw || sw.mode !== "h") { sw = null; return; }
        const { row, sx, raw } = sw;
        sw = null; swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
        row.classList.remove("dragx");
        if (raw < -row.offsetWidth * 0.75) { const b = row.querySelector(".pdel"); S.swiped = -1; if (b) ACTIONS.remove(b); }
        else setSx(row, sx < -DEL_W * 0.6 ? -DEL_W : 0);
    });
    $("#app").addEventListener("click", e => { if (swallowClick && !e.target.closest(".pdel")) { e.stopPropagation(); e.preventDefault(); } }, true);

    // Pull down from the top to refresh. The page follows the finger with
    // resistance; let go past PTR_GO and it holds there with a spinning arrow
    // until the place on screen is updated (the others carry on quietly). If nothing
    // was due (still fresh in the cache) or there's no signal, it says so for a moment
    // instead of just springing back. When the app refreshes by itself (opening it,
    // coming back, every 15 min, opening a place), the arrow peeks out half as far and
    // spins while the place on screen downloads; another place that isn't loading
    // doesn't show it.
    const PTR_GO = 64, PTR_HOLD = 44, PTR_AUTO = PTR_HOLD / 2, ptr = $("#ptr");
    // the pull turns the outer part; the spin is on the inner one (iOS Safari won't
    // animate a rotation on an element whose own rotation is set by the pull)
    ptr.innerHTML = `<span class="ptr-turn"><span class="ptr-whirl">${icon("refresh", 20)}</span></span><span class="ptr-msg"></span>`;
    let pd = null, ptrBusy = false, ptrOff = 0, autoPtr = false, autoTimer = 0;
    const setPull = (px, anim) => {
        clearTimeout(ptrOff);
        scr.classList.toggle("ptr-anim", !!anim);
        if (px) scr.classList.add("ptr-on");
        else ptrOff = setTimeout(() => scr.classList.remove("ptr-on", "ptr-anim"), anim ? 320 : 0);
        scr.style.setProperty("--pull", px + "px");
        scr.style.setProperty("--pp", Math.min(1, px / PTR_GO));
    };
    const stopAuto = () => {
        clearTimeout(autoTimer); autoTimer = 0;
        if (!autoPtr) return;
        autoPtr = false;
        scr.classList.remove("ptr-spin");
        setPull(0, true);
    };
    const shownLoading = () => { const p = S.places[S.selected]; return !!p && !S.listing && loadingKeys.has(keyOf(p)); };
    ptrSync = () => {
        if (ptrBusy || (pd && pd.on)) return;
        if (!shownLoading()) { stopAuto(); return; }
        if (autoPtr || autoTimer) return;
        // only once it's taking a moment: saved data answers instantly and shouldn't blink
        autoTimer = setTimeout(() => {
            autoTimer = 0;
            if (!shownLoading() || ptrBusy || (pd && pd.on) || scr.scrollTop > 0) return;
            autoPtr = true;
            setPull(PTR_AUTO, true);
            scr.classList.add("ptr-spin");
        }, 350);
    };
    scr.addEventListener("touchstart", e => {
        if (autoPtr && e.touches.length === 1 && scr.scrollTop <= 0) stopAuto();   // a pull takes over
        pd = !ptrBusy && !dragging && e.touches.length === 1 && scr.scrollTop <= 0 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, px: 0, on: false } : null;
    }, { passive: true });
    scr.addEventListener("touchmove", e => {
        if (!pd) return;
        const dy = e.touches[0].clientY - pd.y, dx = e.touches[0].clientX - pd.x;
        if (!pd.on) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
            // a normal scroll up the page, or a sideways swipe / chart scrub
            if (dy <= Math.abs(dx) || scr.scrollTop > 0) { pd = null; return; }
            pd.on = true; pd.y += dy;
        }
        e.preventDefault();
        pd.px = Math.max(0, rubber(e.touches[0].clientY - pd.y, scr.clientHeight));
        setPull(pd.px);
        scr.classList.toggle("ptr-ready", pd.px >= PTR_GO);
    }, { passive: false });
    scr.addEventListener("touchend", () => {
        if (!pd || !pd.on) { pd = null; return; }
        const go = pd.px >= PTR_GO;
        pd = null;
        scr.classList.remove("ptr-ready");
        if (!go) { setPull(0, true); return; }
        ptrBusy = true;
        setPull(PTR_HOLD, true);
        scr.classList.add("ptr-spin");
        const t0 = Date.now();
        let held = true;
        const release = res => {
            if (!held) return;
            held = false;
            const msg = res.offline || res.error ? "No connection" : !res.downloads ? "Data up to date" : "";
            if (msg) { ptr.querySelector(".ptr-msg").textContent = msg; scr.classList.remove("ptr-spin"); scr.classList.add("ptr-said"); }
            // a spin too short to see reads as a glitch: keep it up at least briefly
            setTimeout(() => {
                ptrBusy = false;
                scr.classList.remove("ptr-spin");
                setPull(0, true);
                setTimeout(() => scr.classList.remove("ptr-said"), 320);
            }, msg ? 1100 : Math.max(0, 500 - (Date.now() - t0)));
        };
        // done when the place on screen is (or the whole refresh, with no places)
        refresh(release).catch(() => ({ offline: true })).then(release);
    });

    // Easter egg: at the end of the page, push up once more and the page lifts like
    // a rubber band, showing a note underneath; let go and it springs back.
    // A wheel turn past the end does the same for a moment.
    const det = $("#details");
    const atEnd = () => scr.scrollTop + scr.clientHeight >= scr.scrollHeight - 2;
    const setEgg = (px, anim) => {
        setPull(-px, anim);
        det.classList.toggle("egg-anim", !!anim);
        det.style.setProperty("--egg-px", px + "px");
        det.style.setProperty("--egg", Math.min(1, px / 20));
    };
    let eg = null, eggTimer = 0;
    const EGG_MAX = 40;
    scr.addEventListener("touchstart", e => {
        eg = !ptrBusy && !dragging && e.touches.length === 1 && atEnd() ? { x: e.touches[0].clientX, y: e.touches[0].clientY, on: false } : null;
    }, { passive: true });
    scr.addEventListener("touchmove", e => {
        if (!eg) return;
        const up = eg.y - e.touches[0].clientY, dx = e.touches[0].clientX - eg.x;
        if (!eg.on) {
            if (Math.max(Math.abs(dx), Math.abs(up)) < 6) return;
            if (up <= Math.abs(dx) || !atEnd()) { eg = null; return; }
            eg.on = true; eg.y -= up;
        }
        e.preventDefault();
        clearTimeout(eggTimer);
        setEgg(Math.max(0, rubber(eg.y - e.touches[0].clientY, EGG_MAX)));   // stiff: never much taller than the note
    }, { passive: false });
    scr.addEventListener("touchend", () => {
        if (eg && eg.on) setEgg(0, true);
        eg = null;
    });
    let lastWheel = 0;
    scr.addEventListener("wheel", e => {
        const fresh = e.timeStamp - lastWheel > 300;
        lastWheel = e.timeStamp;
        if (!fresh || e.deltaY <= 0 || !atEnd() || ptrBusy) return;
        setEgg(28, true);
        clearTimeout(eggTimer);
        eggTimer = setTimeout(() => setEgg(0, true), 1500);
    }, { passive: true });

    // Customize panel number fields: saved when you leave the field or press Done
    $("#body").addEventListener("change", e => {
        const el = e.target;
        if (!el.matches || !el.matches(".cz-in, .cz-name")) return;
        if (el.dataset.set === "name") rename(S.selected, el.value);
        else if (el.dataset.set === "ideal") setIdeal(el.dataset.mode, +el.dataset.side, el.value);
        else if (el.dataset.set === "jetty") setJetty(el.dataset.k, el.value);
        render();
    });
    $("#body").addEventListener("keydown", e => {
        if (e.key === "Enter" && e.target.matches && e.target.matches(".cz-in, .cz-name")) { e.preventDefault(); e.target.blur(); }
    });
    // Edit: group names are saved when you leave the field or press Done
    lb.addEventListener("change", e => {
        if (e.target.matches && e.target.matches(".gname")) { renameGroup(e.target.dataset.g, e.target.value); render(); }
    });
    lb.addEventListener("keydown", e => {
        if (e.key === "Enter" && e.target.matches && e.target.matches(".gname")) { e.preventDefault(); e.target.blur(); }
    });

    // the places list's search
    const lq = $("#lq");
    lq.addEventListener("focus", () => startSearch());
    // leaving an empty search (nothing added) puts the list back, like Cancel
    lq.addEventListener("blur", () => setTimeout(() => {
        if (S.lsearch && document.activeElement !== lq && !lq.value.trim() && !S.addedKeys.length) { S.lsearch = false; render(); }
    }, 150));
    lq.addEventListener("input", () => { clearTimeout(searchTimer); render(); searchTimer = setTimeout(() => runSearch(lq.value), 250); });
    lq.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); runSearch(lq.value); lq.blur(); }
        if (e.key === "Escape") { endSearch(); render(); }
    });
    $("#lqCancel").addEventListener("click", () => { endSearch(); render(); });
    $("#listCommit").addEventListener("click", () => keepAdded());

    // search
    const q = $("#q");
    q.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(q.value), 250); });
    q.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); runSearch(q.value); q.blur(); }
        if (e.key === "Escape") { closeAdd(); render(); }
    });
    $("#addBack").addEventListener("click", () => { closeAdd(); render(); });
    $("#addCommit").addEventListener("click", () => { keepAdded(); render(); });
    // The keyboard covers the bottom of the Add page (iOS doesn't shrink the page for
    // it), so the floating Add buttons ride on top of it: --kb = the covered height.
    const vv = window.visualViewport;
    if (vv) {
        const app = $("#app");
        const lift = () => {
            const covered = app.getBoundingClientRect().bottom - (vv.offsetTop + vv.height);
            app.style.setProperty("--kb", Math.max(0, Math.round(covered)) + "px");
        };
        vv.addEventListener("resize", lift);
        vv.addEventListener("scroll", lift);
    }
    $("#moveBack").addEventListener("click", () => { closeMove(); render(); });
    $("#moveBody").addEventListener("input", e => {
        if (e.target.id === "importText" && codeFrom(e.target.value)) openImport(e.target.value);
    });
    $("#moveBody").addEventListener("keydown", e => {
        if (e.target.id === "importText" && e.key === "Enter") { e.preventDefault(); openImport(e.target.value); }
    });
    // a share link opened (or scanned) while the app is already open
    window.addEventListener("hashchange", takeImportHash);

    // toast: holding a finger on it keeps it up
    const t = $("#toast");
    t.addEventListener("pointerdown", () => clearTimeout(toastTimer));
    t.addEventListener("pointerup", () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, toastMs()); });
    $("#toastAct").addEventListener("click", () => {
        const a = S.toast.action;
        S.toast.shown = false;
        clearTimeout(toastTimer);
        if (a) a();
        render();
    });

    // swipe in from the left edge = back (like the widget's Esc / mouse back button)
    let edge = null;
    document.addEventListener("touchstart", e => {
        const p = e.touches[0];
        edge = e.touches.length === 1 && p.clientX < 24 ? { x: p.clientX, y: p.clientY } : null;
    }, { passive: true });
    document.addEventListener("touchend", e => {
        if (!edge) return;
        const p = e.changedTouches[0];
        if (p.clientX - edge.x > 70 && Math.abs(p.clientY - edge.y) < 60 && goBack()) render();
        edge = null;
    }, { passive: true });
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape" || document.activeElement === q || document.activeElement === lq) return;
        if (goBack()) render(); else backAtTop();
    });

    // mouse back button (button 3): same as Esc. Handled steps don't leave the page.
    document.addEventListener("mouseup", e => {
        if (e.button !== 3) return;
        if (goBack()) { e.preventDefault(); render(); }
        else if (embedded()) { e.preventDefault(); backAtTop(); }
    });

    window.addEventListener("resize", () => paint());

    // leaving and coming back
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (hiddenAt && Date.now() - hiddenAt > LOOK.resetAfterAwaySec * 1000) {
            // away a while: a new version saved earlier is loaded now (places are kept)
            if (updateReady) { reloadForUpdate(); return; }
            resetView();
            checkForUpdate();         // background; used next time
        }
        refresh();
    });
    setInterval(() => { if (!document.hidden) refresh(); }, Math.max(5, LOOK.refreshMinutes) * 60000);
    // keep "now" lines and ages current
    setInterval(() => { if (!document.hidden && !dragging) render(); }, 60000);
}

// ── updates ─────────────────────────────────────────────────────────
// The app opens from the copy saved on the phone (instant, works with no signal).
// The service worker (sw.js) checks GitHub for a new version in the background with
// a few tiny requests, saves it, and then the app reloads into it: right away if you
// haven't touched anything yet, else the next time you come back to it. Places, the ★
// and downloaded data live in the phone's storage, so a reload keeps them.
let touched = false, updateReady = false;
function checkForUpdate() {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw || navigator.onLine === false) return Promise.resolve(false);
    return new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = e => resolve(!!(e.data && e.data.updated));
        sw.postMessage({ type: "check" }, [ch.port2]);
        setTimeout(() => resolve(false), 60000);
    }).then(u => { if (u) updateReady = true; return updateReady; });
}
function reloadForUpdate() {
    try { sessionStorage.setItem("rt:updated", "1"); } catch (e) { /* fine */ }
    location.reload();
}

document.documentElement.style.setProperty("--anim", ANIM + "ms");
splashText(navigator.onLine === false ? "No signal · waiting for data…" : "Getting the latest from NOAA…");
splashSlow = setTimeout(() => splashText("Slow connection · still loading…"), 8000);
setTimeout(hideSplash, 30000);                        // never stuck behind it
if (navigator.standalone === true) {
    document.documentElement.classList.add("ios-app");
    // #app is the full screen tall (100vh), but iOS only draws the page down to
    // innerHeight (a status bar's height short, upright): measure the strip it leaves
    // out (--cut) so the bottom bars keep their buttons above it.
    const cut = () => document.documentElement.style.setProperty("--cut",
        Math.max(0, Math.round($("#app").getBoundingClientRect().height - window.innerHeight)) + "px");
    cut();
    window.addEventListener("resize", cut);
    window.addEventListener("orientationchange", () => setTimeout(cut, 300));
}
wire();
render();
// Show the last saved readings straight away (no waiting on a weak signal), then update.
// Instant: the snapshot from the last refresh, carried forward to now (see "as of now").
try {
    const snap = JSON.parse(localStorage.getItem("rt:snap") || "null");
    if (snap && snap.results) { Object.assign(S.results, snap.results); S.updated = snap.t || 0; render(); }
} catch (e) { /* none yet */ }
savedPlaces(S.places).then(r => {
    for (const p of r.places) if (!S.results[p.key] && (p.river || p.tide)) S.results[p.key] = p;
    if (!S.updated) S.updated = r.time;
    render();
}).catch(() => {}).finally(refresh);

if ("serviceWorker" in navigator && location.protocol === "https:")
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
document.addEventListener("pointerdown", () => { touched = true; }, { capture: true, once: true });
// just opened: if there's a new version and you haven't touched anything yet, switch now
setTimeout(() => checkForUpdate().then(u => { if (u && !touched && !document.hidden) reloadForUpdate(); }), 1500);
try {
    if (sessionStorage.getItem("rt:updated")) { sessionStorage.removeItem("rt:updated"); toast("Updated to the latest version", "", null); render(); }
} catch (e) { /* fine */ }

// Opened from a share link: show what's in it, then drop it from the address bar.
// Someone new: the link stays in the address bar, so Add to Home Screen installs
// the app with its places (on iPhone, Safari and the home-screen app don't share
// storage; with no start_url in the manifest, the icon opens the address it was
// added from). That app loads them on its first launch and ignores the link after.
function takeImportHash() {
    const code = codeFrom(location.hash);
    if (!code) return;
    if (S.places.length) {
        // the link this app already loaded (reopened tab, home-screen icon): nothing to ask
        if (code === load("rt:link", "") || standalone()) return;
        try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* fine */ }
    }
    openImport("#import=" + code);
}
takeImportHash();

// For the desktop taskbar wrappers (Linux panel widget, Windows tray app):
// a short reading of the ★ place for the taskbar, and a refresh they can trigger
// while the popup is closed (a hidden page doesn't refresh itself).
window.flowTides = {
    version: 1,
    summary() {
        const i = pinned(), p = S.places[i], d = dataFor(i);
        if (!p) return { name: "", parts: [], spark: null, flood: "" };
        const color = c => c && !String(c).startsWith("var(") ? c : "";
        const g = d ? spark(i) : null, thin = a => a.filter((x, k) => k % Math.ceil(a.length / 80 || 1) === 0 || k === a.length - 1);
        return {
            name: p.name,
            parts: parts(d, p).map(x => ({ text: x.text, color: color(x.color) })),
            flood: d && flooding(d.river) ? categoryColor(d.river.category) : "",
            spark: g && g.series.length > 1 ? { series: thin(g.series), forecast: thin(g.forecast || []), color: g.color } : null,
            updated: S.updated,
        };
    },
    refresh: () => refresh(),
    openImport: text => { openImport(text); },
};

// for testing from a computer (tools/shot.py)
window.__rt = { S, render, refresh, ACTIONS, select, pickDay, goBack, bigChart };
