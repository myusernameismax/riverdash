// River & Tides for the phone: the widget's popup (main.qml) as a home-screen web app.
// One ★ place opens first; tap around for details and the rest.
// Data: data.js (NOAA etc.). Look: config.js + css/app.css.

import { LOOK, DEFAULT_PLACES } from "./config.js";
import { fetchPlaces, search as searchStations, warmSearch } from "./data.js";
import { Chart, drawSpark } from "./chart.js";
import { wxIcon, icon } from "./icons.js";
import { fmtTime, fmtDay, fmtDayLong, fmtMonthDay, sameDay } from "./fmt.js";
import { morphInto } from "./morph.js";

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
    updated: 0,
    error: "",
    loading: false,
    chartMode: "",           // "stage" | "flow" | "tide" | "surf", "" = automatic
    focusDay: -1,            // local midnight (ms) of a day picked in the surf/weather lists; -1 = now
    // add page
    adding: false,
    attachTo: -1,            // -1 = new place, else add a gauge/station to this place
    attachKind: "",          // "river" | "tide" | "" (both)
    searching: false,
    searchResults: [],
    searchError: "",
    searchSeq: 0,
    slowSearch: false,
    // edit mode, rename, toast
    editing: false,
    renaming: false,
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
const dataFor = i => i >= 0 && i < S.places.length ? (S.results[keyOf(S.places[i])] || null) : null;
const placeName = i => (S.places[i] || {}).name || "?";
const has = v => v !== null && v !== undefined;
const ft = v => has(v) ? v.toFixed(1) + " ft" : "–";
const commas = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const cfs = v => has(v) ? commas(v) + " cfs" : "–";
const cfsShort = v => !has(v) ? "–" : (v >= 10000 ? Math.round(v / 1000) + "k" : v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v)) + " cfs";
const arrow = (d, eps) => !has(d) ? "" : d > eps ? "↑" : d < -eps ? "↓" : "→";
const clock = ms => fmtTime(ms, "h:mm A");
const clockShort = ms => fmtTime(ms, "h:mma").replace(/m$/, "");
const dayClock = ms => sameDay(ms, Date.now()) ? clock(ms) : fmtDay(ms) + " " + clock(ms);
function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
}
const change = (d, unit, dec) => !has(d) ? "" : (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(dec) + unit + " in 3 h";
const tideWord = e => e.type === "H" ? "High" : "Low";
const categoryColor = c => c === "action" ? LOOK.actionColor : c === "minor" ? LOOK.minorColor
    : c === "moderate" ? LOOK.moderateColor : c === "major" ? LOOK.majorColor : "var(--text)";
const flooding = r => !!r && ["action", "minor", "moderate", "major"].includes(r.category);
const shortName = n => n.split(/ (?:near|at|above|below|blw|abv|nr) |,| {2}/)[0].replace(/ River$/, "").trim();
const dayLabel = ms => fmtDay(ms) + " " + fmtMonthDay(ms);

// Short colored pieces for the list rows.
function parts(d) {
    const out = [];
    if (!d) return [{ text: "…", color: "var(--text)" }];
    const r = d.river, t = d.tide;
    if (r && has(r.stage)) out.push({ text: ft(r.stage) + arrow(r.stageTrend, 0.05), color: flooding(r) ? categoryColor(r.category) : LOOK.stageColor });
    if (r && has(r.flow)) out.push({ text: cfsShort(r.flow), color: LOOK.flowColor });
    if (t) {
        const n = t.next && t.next[0];
        if (!r && has(t.height)) out.push({ text: ft(t.height) + (t.rising === null ? "" : t.rising ? "↑" : "↓"), color: LOOK.tideColor });
        if (n) out.push({ text: n.type + " " + clockShort(n.time), color: LOOK.tideColor });
    }
    const sn = surfNow(d.surf);
    if (sn && !r) out.push({ text: "≈" + Math.round(sn[1]) + "ft", color: rateColor(rate(sn)) });
    if (!out.length) out.push({ text: d.errors && d.errors.length ? "!" : "–", color: "var(--negative)" });
    return out;
}

// Which graph to draw, and its data.
function bestMode(d, wanted) {
    const r = d ? d.river : null, t = d ? d.tide : null;
    const ok = m => (m === "tide" && !!t) || (m === "stage" && !!r)
        || (m === "surf" && !!d && !!d.surf && d.surf.hours.length > 1)
        || (m === "flow" && !!r && r.series.some(p => p[2] !== null));
    if (wanted && ok(wanted)) return wanted;
    return ok("flow") ? "flow" : r ? "stage" : t ? "tide" : "";
}
const tideMarkers = evs => evs.map(e => ({ time: e.time, value: e.height, above: e.type === "H", label: e.type + " " + clockShort(e.time) }));
// Big chart: like graph(), but when a future day is picked, it opens on that day
// (and the tide chart switches to the whole-week curve).
function bigGraph(d, mode) {
    const g = graph(d, mode);
    if (S.focusDay < 0) return g;
    const a = S.focusDay, b = S.focusDay + DAY_MS, t = d ? d.tide : null;
    if (mode === "tide" && t && t.weekCurve && t.weekCurve.length > 1) {
        g.series = t.weekCurve;
        g.markers = tideMarkers(t.week || []);
        g.nowValue = NaN;
    }
    const all = g.series.concat(g.forecast || []);
    g.dayCovered = all.length > 1 && all[0][0] < b && all[all.length - 1][0] > a;
    if (g.dayCovered) { g.homeT0 = a; g.homeT1 = b; }
    return g;
}
function graph(d, mode) {
    const r = d ? d.river : null, t = d ? d.tide : null;
    if (mode === "tide" && t)
        return { series: t.curve, forecast: [], color: LOOK.tideColor, decimals: 1, threshold: NaN, unit: " ft",
                 homeT0: Date.now() - 6 * 3600000, homeT1: Date.now() + 24 * 3600000,
                 nowValue: has(t.height) ? t.height : NaN, markers: tideMarkers(t.events) };
    if (mode === "surf" && d && d.surf) {
        const now = Date.now(), pts = d.surf.hours.map(h => [h[0], h[1]]);
        return { series: pts.filter(p => p[0] <= now), forecast: pts.filter(p => p[0] > now),
                 color: LOOK.surfColor, decimals: 1, unit: " ft", nowValue: NaN, markers: [],
                 threshold: LOOK.jettyCalmMaxFt, thresholdLabel: "calm limit " + LOOK.jettyCalmMaxFt + " ft",
                 homeT0: now - 6 * 3600000, homeT1: NaN };
    }
    if (r && (mode === "stage" || mode === "flow")) {
        const c = mode === "flow" ? 2 : 1;
        return { series: r.series.map(p => [p[0], p[c]]), forecast: r.forecast.map(p => [p[0], p[c]]),
                 color: c === 2 ? LOOK.flowColor : LOOK.stageColor, decimals: c === 2 ? 0 : 1, nowValue: NaN, markers: [],
                 unit: c === 2 ? " cfs" : " ft", homeT0: NaN, homeT1: NaN,
                 threshold: c === 1 && r.flood.minor ? r.flood.minor : NaN,
                 thresholdLabel: "flood stage " + r.flood.minor + " ft" };
    }
    return { series: [], forecast: [], color: LOOK.stageColor, decimals: 1, nowValue: NaN, markers: [], threshold: NaN };
}
// Same data, trimmed to a short window so it stays readable when tiny.
function spark(d) {
    const full = graph(d, bestMode(d, ""));
    const lo = Date.now() - LOOK.sparkPastHours * 3600000, hi = Date.now() + LOOK.sparkFutureHours * 3600000;
    const win = a => a.filter(p => p[0] >= lo && p[0] <= hi);
    return { ...full, series: win(full.series), forecast: win(full.forecast) };
}

// ── swell / jetty rating (coastal tide stations) ────────────────────
// hour row: [ms, wave ft, period s, wave dir, swell ft, swell s, swell dir, wind mph, gust mph, wind dir]
const compass = deg => has(deg) ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8] : "";
function rate(h) {   // 0 calm, 1 caution, 2 sketchy, -1 unknown
    if (!h || !has(h[1])) return -1;
    const eff = h[1] * (has(h[2]) && h[2] >= LOOK.jettyLongPeriodS ? LOOK.jettyLongPeriodFactor : 1);
    const g = has(h[8]) ? h[8] : 0;
    return eff > LOOK.jettySketchyFt || g > LOOK.jettySketchyGustMph ? 2
         : eff > LOOK.jettyCalmMaxFt || g > LOOK.jettyCautionGustMph ? 1 : 0;
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
function surfDays(s) {
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
        for (const h of d.hours) slots[new Date(h[0]).getHours()] = { level: rate(h), day: isDaylight(s, h[0]) };
        const calm = lit.filter(h => rate(h) === 0);
        return {
            start: d.start, label: d.start === today ? "Today" : fmtDay(d.start),
            lo: Math.min(...waves), hi: Math.max(...waves),
            period: big[2], dir: compass(big[3]), swell: big[4], swellPeriod: big[5], swellDir: compass(big[6]),
            gust: Math.max(...gusts), level: Math.max(...use.map(rate)), slots,
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
function select(i) {
    if (i === S.selected) return;
    S.selected = i;
    S.chartMode = ""; S.focusDay = -1; S.renaming = false; S.hourHover = -1; S.nowOpen = false;
    flash.selected = true;
    $("#scroll").scrollTop = 0;
}
function pin(i) {
    setPinned(i);
    toast("★ " + placeName(i) + " opens first", "", null);
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
// Move a place to a new spot in the list; the pinned and selected places follow it.
function move(from, to) {
    if (from === to) return;
    const list = S.places.slice();
    list.splice(to, 0, list.splice(from, 1)[0]);
    const f = k => k === from ? to : from < k && k <= to ? k - 1 : to <= k && k < from ? k + 1 : k;
    setPinned(f(pinned()));
    S.selected = f(S.selected);
    S.places = list;
    save("rt:places", list);
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
function openAdd(target, kind) {
    S.attachTo = target; S.attachKind = kind;
    S.searchResults = []; S.searchError = ""; S.searching = false; S.searchSeq++;
    S.editing = false;
    S.adding = true;
    const p = S.places[target];
    const q = $("#q");
    q.value = p ? p.name : "";       // attaching: start with the place's name
    render();
    q.focus();                        // inside the tap, so the keyboard comes up
    if (q.value) runSearch(q.value);
    warmSearch();
}
function closeAdd() { S.adding = false; $("#q").blur(); }
const alreadyHave = item => S.places.some(p => p[item.kind] === item.id);
function addResult(item) {
    const list = S.places.map(p => ({ ...p }));
    let i;
    if (S.attachTo >= 0 && S.attachTo < list.length) {
        i = S.attachTo;
        list[i][item.kind] = item.id;
    } else {
        const p = { name: shortName(item.name) };
        p[item.kind] = item.id;
        list.push(p);
        i = list.length - 1;
    }
    savePlaces(list);
    select(i);
    flash.selected = true;
    closeAdd();
    if (S.attachTo >= 0) toast("Added " + (item.kind === "tide" ? "tides" : "river gauge") + " to " + list[i].name, "", null);
    else if (i !== pinned()) toast("Added " + list[i].name, "Open first", () => pin(i));
    else toast("Added " + list[i].name, "", null);
}

let toastTimer = 0;
function toast(text, actionText, action) {
    S.toast = { shown: true, text, actionText, action };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, LOOK.toastMs);
}
function hideToast() { S.toast.shown = false; S.undoData = null; render(); }

// Back gesture / Esc: leave the add page, edit mode or a picked day. false = nothing to go back from
function goBack() {
    if (S.adding) closeAdd();
    else if (S.renaming) S.renaming = false;
    else if (S.editing) S.editing = false;
    else if (S.focusDay >= 0) S.focusDay = -1;
    else return false;
    return true;
}
function pickDay(start) { S.focusDay = S.focusDay === start ? -1 : start; S.hourHover = -1; }

// Everything you looked at (another place, another chart, a future day) is
// forgotten when you leave the app for a while, so it reopens on "now" for the ★ place.
function resetView() {
    S.adding = false; S.editing = false; S.renaming = false; S.toast.shown = false; S.nowOpen = false;
    S.selected = pinned(); S.chartMode = ""; S.focusDay = -1; S.hourHover = -1;
    $("#q").blur();
    $("#scroll").scrollTop = 0;
}

// ── data ────────────────────────────────────────────────────────────
let fetchSeq = 0;
async function refresh() {
    const seq = ++fetchSeq;
    S.loading = true;
    render();
    let r;
    try { r = await fetchPlaces(S.places); } catch (e) { r = { error: "Couldn't get data: " + e.message }; }
    if (seq === fetchSeq) { S.loading = false; S.error = r.error || ""; }
    if (r.places) {                                   // merge, so nothing blinks out
        for (const p of r.places) S.results[p.key] = p;
        S.updated = r.time;
    }
    render();
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
const bigChart = new Chart({ lineWidth: LOOK.lineWidth, fillOpacity: LOOK.fillOpacity, minSpanHours: LOOK.chartMinZoomHours });
let dragging = null;     // reorder in progress (render waits)

function section({ title = "", leading = "", trailing = "", pad = 12, gap = 6, body = "", cls = "", id = "" }) {
    const head = title || leading || trailing
        ? `<div class="sec-head">${leading ? `<div class="sec-lead">${leading}</div>` : ""}<div class="sec-title">${esc(title.toUpperCase())}</div><div class="sec-trail">${trailing}</div></div>`
        : "";
    return `<div class="sec ${cls}"${id ? ` id="${id}"` : ""}>${head}<div class="sec-box" style="padding:${pad}px;gap:${gap}px">${body}</div></div>`;
}

function tile({ title, num, unit, detail, mode, active, accent }) {
    return `<button class="tile${active ? " active" : ""}${mode ? "" : " still"}" ${mode ? `data-act="mode" data-mode="${mode}"` : ""} style="--accent:${accent}">
        <div class="t-title">${title}</div>
        <div class="t-val"><b>${esc(num)}</b><span class="u">${esc(unit)}</span></div>
        ${detail ? `<div class="t-det">${esc(detail)}</div>` : ""}
    </button>`;
}

function renderHeader(cur) {
    const hdr = $("#hdr");
    if (S.renaming && $("#nameEdit")) return;          // keep the text field (and keyboard) as is
    const place = S.places[S.selected];
    if (!place) { morphInto(hdr, ""); return; }
    const d = cur.d, r = cur.r, t = cur.t;
    const sub = [r ? r.name : "", t ? "Tides: " + t.name : ""].filter(s => s).join("  ·  ");
    const n = d && d.weather ? d.weather.now : null;
    const wx = LOOK.showWeather && n && has(n.temp)
        ? `<button class="hwx" data-act="nowToggle">${wxIcon(n.code, n.day, 34)}<span class="hwx-t"><span class="hwx-temp">${n.temp}°</span><span class="hwx-word">${esc(wxWord(n.code))}</span></span></button>`
        : "";
    const isPin = S.selected === pinned();
    morphInto(hdr, `<div class="hrow">
        <div class="hname">
            ${S.renaming ? `<input id="nameEdit" class="name-edit" enterkeyhint="done" autocomplete="off" autocorrect="off">`
                         : `<h1 data-act="rename">${esc(place.name)}</h1>`}
            ${sub ? `<div class="hsub">${esc(sub)}</div>` : ""}
        </div>
        ${wx}
        <button class="hstar${isPin ? " on" : ""}" data-act="pin" data-i="${S.selected}">${icon(isPin ? "star" : "starOutline", 24)}</button>
    </div>
    ${S.nowOpen && n ? `<div class="hnow">Feels like ${n.feels}° · Wind ${n.wind} mph ${compass(n.windDir)}, gusts ${n.gust} mph</div>` : ""}`);
}

function renderTiles(cur) {
    const { d, r, t, mode } = cur;
    if (!d) return "";
    const out = [];
    if (r) out.push(tile({ title: "HEIGHT", accent: LOOK.stageColor, mode: "stage", active: mode === "stage",
        num: has(r.stage) ? r.stage.toFixed(1) : "–", unit: " ft " + arrow(r.stageTrend, 0.05), detail: change(r.stageTrend, " ft", 2) }));
    if (r && has(r.flow)) out.push(tile({ title: "FLOW", accent: LOOK.flowColor, mode: r.flowNote === "NOAA" ? "flow" : "", active: mode === "flow",
        num: commas(r.flow), unit: " cfs " + arrow(r.flowTrend, r.flow * 0.02),
        detail: r.flowNote === "NOAA" ? change(r.flowTrend, " cfs", 0) : r.flowNote + ", " + ago(r.flowTime) }));
    if (t) out.push(tile({ title: "TIDE", accent: LOOK.tideColor, mode: "tide", active: mode === "tide",
        num: has(t.height) ? t.height.toFixed(1) : "–", unit: " ft " + (t.rising === null ? "" : t.rising ? "↑" : "↓"),
        detail: (t.rising ? "Rising" : "Falling") + (t.live ? "" : " (predicted)") }));
    const h = surfNow(d.surf);
    if (h) out.push(tile({ title: "WAVES", accent: LOOK.surfColor, mode: "surf", active: mode === "surf",
        num: has(h[1]) ? h[1].toFixed(1) : "–", unit: " ft", detail: Math.round(h[2]) + " s " + compass(h[3]) + " · " + rateWord(rate(h)) }));
    return `<div class="tiles n${out.length}">${out.join("")}</div>`;
}

function renderChart(cur) {
    const { d, r, mode } = cur;
    const g = bigGraph(d, mode);
    cur.g = g;
    if (!d || g.series.length <= 1) return "";
    const what = mode === "surf" ? "Waves · ft" : mode === "tide" ? "Tide · ft" : mode === "flow" ? "Flow · cfs" : "Height · ft";
    const day = S.focusDay < 0 ? "" : g.dayCovered ? " · " + dayLabel(S.focusDay) : " · no data for " + dayLabel(S.focusDay);
    const p = r ? r.forecastPeak : null;
    return section({ pad: 9, body: `
        <canvas id="bigChart" class="big-chart" style="height:${LOOK.chartHeight}px"></canvas>
        <div class="chart-label">${esc(what + day)}</div>
        ${p ? `<div class="chart-peak">${esc("Forecast peak " + ft(p.stage) + (has(p.flow) ? " / " + cfs(p.flow) : "") + ", " + dayClock(p.time))}</div>` : ""}` });
}

function renderTides(cur) {
    const t = cur.t;
    if (!t) return "";
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

// hourly graph geometry (px)
const HR = { H: 162, padX: 16, topH: 46, rainH: 22 };
HR.cy0 = HR.topH + 22; HR.cy1 = HR.H - HR.rainH - 20;
function hourGeom(hrs) {
    const temps = hrs.map(h => h.temp).filter(has);
    const tmin = temps.length ? Math.min(...temps) : 0, tmax = temps.length ? Math.max(...temps) : 1;
    const span = Math.max(6, tmax - tmin);
    return { tmin, tmax, span, yAt: v => HR.cy1 - ((v - (tmin + tmax - span) / 2) / span) * (HR.cy1 - HR.cy0) };
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
        const labels = hours.map((h, i) => i).filter(i => new Date(hours[i].t).getHours() % 3 === 0).map(i => {
            const h = hours[i], past = h.t + 3600000 <= Date.now();
            return `<div class="hr-col${past ? " past" : ""}" style="${pos(i)}">
                    <div class="hr-time">${clockShort(h.t).replace(":00", "")}</div>${wxIcon(h.code, h.day, 20)}</div>
                ${has(h.temp) ? `<div class="hr-temp${past ? " past" : ""}" style="${pos(i)};top:${(G.yAt(h.temp) - 17).toFixed(1)}px">${h.temp}°</div>` : ""}
                ${(h.pop || 0) >= LOOK.rainDimBelow ? `<div class="hr-pop${past ? " past" : ""}" style="${pos(i)};top:${HR.H - HR.rainH - 14}px">${h.pop}%</div>` : ""}`;
        }).join("");
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
            <div class="hourly" style="height:${HR.H}px"><canvas id="hourCanvas"></canvas>${labels}</div>
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
    const days = surfDays(d ? d.surf : null);
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

function renderPlaces() {
    if (!(S.places.length > 1 || S.editing)) return "";
    const firstVisible = S.places.findIndex((p, i) => S.editing || i !== S.selected);
    const rows = S.places.map((p, i) => {
        const hidden = !S.editing && i === S.selected;
        const isPin = i === pinned();
        const parts_ = S.editing ? "" : parts(dataFor(i)).map(x => `<span class="ppart" style="color:${x.color}">${esc(x.text)}</span>`).join("");
        return `<div class="prow${hidden ? " hide" : ""}${i === firstVisible ? " first" : ""}${S.editing && i === S.selected ? " cur" : ""}"
                     data-key="${esc(keyOf(p))}" ${S.editing ? "" : `data-act="select"`} data-i="${i}">
            ${S.editing ? `<button class="bubble neg" data-act="remove" data-i="${i}">−</button>` : `<canvas class="spark" data-spark="${i}"></canvas>`}
            <div class="pname">${esc(p.name)}</div>
            ${parts_ ? `<div class="pparts">${parts_}</div>` : ""}
            <button class="pstar${isPin ? " on" : ""}" data-act="pin" data-i="${i}">${icon(isPin ? "star" : "starOutline", 18)}</button>
            ${S.editing ? `<div class="handle" data-i="${i}">${icon("handle", 20)}</div>` : ""}
        </div>`;
    }).join("");
    return section({ id: "placesSec", title: S.editing ? "All places" : "Other places", pad: 0, gap: 0,
        trailing: `<button class="edit-btn${S.editing ? " on" : ""}" data-act="edit">${S.editing ? "Done" : "Edit"}</button>`,
        body: `<div id="placesList">${rows}</div>` });
}

function renderBody(cur) {
    if (dragging) { dragging.pending = true; return; }
    let html = "";
    if (!S.places.length) {
        html += `<div class="placeholder">${wxIcon(63, true, 56)}<div class="ph-text">No places yet</div>
            <div class="ph-expl">Add a river gauge or a tide station.</div>
            <button class="ph-btn" data-act="add">${icon("plus", 16)}Add a place</button></div>`;
    }
    const place = cur.place;
    if (place) {
        const errs = [S.error].concat(cur.d ? cur.d.errors : []).filter(s => s);
        let sel = "";
        if (errs.length) sel += `<div class="errors">${errs.map(esc).join("<br>")}</div>`;
        if (!cur.d) sel += `<div class="loading"><span class="spinner"></span>Getting the latest from NOAA…</div>`;
        if (flooding(cur.r)) sel += `<div class="flood" style="--accent:${categoryColor(cur.r.category)}">⚠ ${esc(cur.r.categoryLabel)}</div>`;
        sel += renderTiles(cur);
        sel += renderChart(cur);
        sel += renderTides(cur);
        sel += renderWeather(cur);
        sel += renderSurf(cur);
        if (cur.d && (!place.river || !place.tide)) {
            sel += `<div class="add-half">
                ${!place.tide ? `<button data-act="attach" data-kind="tide">${icon("plus", 13)}Tide station</button>` : ""}
                ${!place.river ? `<button data-act="attach" data-kind="river">${icon("plus", 13)}River gauge</button>` : ""}
            </div>`;
        }
        html += `<div class="selected${flash.selected ? " fadein-slow" : ""}">${sel}</div>`;
    }
    html += renderPlaces();
    morphInto($("#body"), html);
}

function renderFooter() {
    morphInto($("#ftr"), `
        <div class="fstat">${S.loading ? "Updating…" : S.updated ? "Updated " + clock(S.updated) : ""}  ·  NOAA</div>
        <button class="fbtn" data-act="add">${icon("plus", 16)}Add</button>
        <button class="fbtn round${S.loading ? " spin" : ""}" data-act="refresh"${S.loading ? " disabled" : ""}>${icon("refresh", 18)}</button>`);
}

function renderAdd() {
    const rivers = S.attachKind !== "tide", tides = S.attachKind !== "river";
    $("#addTitle").textContent = S.attachTo < 0 ? "Add a place"
        : (S.attachKind === "tide" ? "Tides for " : "River gauge for ") + placeName(S.attachTo);
    $("#q").placeholder = tides && rivers ? "River, town, bay or gauge id" : tides ? "Search tide stations" : "Search river gauges";
    const riverHits = S.searchResults.filter(x => x.kind === "river"), tideHits = S.searchResults.filter(x => x.kind === "tide");
    const shown = (rivers ? riverHits.length : 0) + (tides ? tideHits.length : 0);
    const qlen = $("#q").value.trim().length;
    let html = "";
    if (shown) {
        for (const g of [
            { kind: "river", title: "RIVER GAUGES", show: rivers, hits: riverHits, color: LOOK.stageColor },
            { kind: "tide", title: "TIDE STATIONS", show: tides, hits: tideHits, color: LOOK.tideColor },
        ]) {
            if (!g.show || !g.hits.length) continue;
            html += `<div class="rtitle" style="color:${g.color}">${g.title}</div>`;
            html += g.hits.map(h => {
                const have = alreadyHave(h);
                return `<div class="hit${have ? " have" : ""}" style="--accent:${g.color}" ${have ? "" : `data-act="addHit" data-kind="${h.kind}" data-id="${esc(h.id)}"`}>
                    <div class="hit-main"><div class="hit-name">${esc(h.name)}</div>
                        <div class="hit-sub">${esc([h.state, h.id].filter(s => s).join("  ·  ") + (have ? "  ·  already added" : ""))}</div></div>
                    ${isFinite(parseFloat(h.lat)) && isFinite(parseFloat(h.lon)) ? `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${parseFloat(h.lat)},${parseFloat(h.lon)}" target="_blank" rel="noopener">${icon("map", 24)}</a>` : ""}
                    <span class="bubble" style="background:${have ? "var(--disabled)" : g.color}">${have ? "✓" : "+"}</span>
                </div>`;
            }).join("");
        }
    } else if (S.searching) {
        html = `<div class="placeholder"><span class="spinner big"></span><div class="ph-expl">${S.slowSearch ? "Downloading NOAA's station list…<br>(first time only, ~30 s)" : "Searching…"}</div></div>`;
    } else {
        html = `<div class="placeholder">${icon(qlen < 2 ? "search" : "empty", 44, "ph-icon")}
            <div class="ph-text">${qlen < 2 ? "Find a river or tide station" : "No matches"}</div>
            <div class="ph-expl">${esc(S.searchError || (qlen < 2 ? "Try “Rogue”, “Newport OR”, “Hood Canal” or a gauge id like SNDO3." : "Try fewer words, or the town nearest the gauge."))}</div></div>`;
    }
    morphInto($("#addBody"), html);
}

function renderToast() {
    const t = S.toast, el = $("#toast");
    el.classList.toggle("on", t.shown);
    el.classList.toggle("above-footer", !S.adding);
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
    const cur = { place, d, r: d ? d.river : null, t: d ? d.tide : null, mode: bestMode(d, S.chartMode) };
    document.body.classList.toggle("adding", S.adding);
    document.body.classList.toggle("editing", S.editing);
    renderHeader(cur);
    renderBody(cur);
    renderFooter();
    renderAdd();
    renderToast();
    flash.selected = flash.week = flash.day = false;
    paint(cur);
}

// ── canvases ────────────────────────────────────────────────────────
let lastCur = null;
function paint(cur = lastCur) {
    if (!cur) return;
    lastCur = cur;
    const cv = $("#bigChart");
    if (cv && cur.g) bigChart.set(cv, cur.g, S.selected + "|" + cur.mode + "|" + S.focusDay);
    else bigChart.cv = null;
    document.querySelectorAll("canvas[data-spark]").forEach(c => drawSpark(c, spark(dataFor(+c.dataset.spark)), 1.25, LOOK.fillOpacity));
    paintHourly(cur);
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
    // night
    ctx.globalAlpha = 0.06; ctx.fillStyle = tc;
    for (let i = 0; i < n; i++) if (!H[i].day) {
        const x0 = Math.max(0, xAt(i) - s / 2), x1 = Math.min(W, xAt(i) + s / 2);
        ctx.fillRect(x0, 0, x1 - x0, Ht);
    }
    // rain chance bars
    ctx.fillStyle = LOOK.rainColor;
    for (let i = 0; i < n; i++) {
        const p = H[i].pop || 0;
        if (p <= 0) continue;
        const bh = Math.max(1.5, p / 100 * HR.rainH);
        ctx.globalAlpha = p >= LOOK.rainDimBelow ? 0.6 : 0.25;
        ctx.fillRect(xAt(i) - s * 0.32, Ht - bh, s * 0.64, bh);
    }
    ctx.globalAlpha = 1;
    // temperature curve
    const pts = [];
    for (let i = 0; i < n; i++) if (has(H[i].temp)) pts.push([xAt(i), G.yAt(H[i].temp)]);
    if (pts.length > 1) {
        const grad = ctx.createLinearGradient(0, HR.cy0, 0, HR.cy1);
        grad.addColorStop(0, LOOK.warmColor); grad.addColorStop(1, LOOK.coolColor);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length - 1; k++) {
            const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
            ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        ctx.lineWidth = LOOK.lineWidth + 0.5; ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.strokeStyle = grad; ctx.stroke();
        ctx.lineTo(pts[pts.length - 1][0], HR.cy1 + 2);
        ctx.lineTo(pts[0][0], HR.cy1 + 2);
        ctx.closePath();
        ctx.globalAlpha = 0.12; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1;
    }
    // now
    const now = Date.now();
    if (now >= H[0].t && now <= H[n - 1].t) {
        const x = HR.padX + (now - H[0].t) / 3600000 * s;
        ctx.globalAlpha = 0.45; ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, HR.topH); ctx.lineTo(x, Ht); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // picked hour
    const hv = S.hourHover;
    if (hv >= 0 && hv < n) {
        const x = xAt(hv);
        ctx.globalAlpha = 0.8; ctx.strokeStyle = LOOK.weatherColor; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, HR.topH); ctx.lineTo(x, Ht); ctx.stroke(); ctx.globalAlpha = 1;
        if (has(H[hv].temp)) { ctx.fillStyle = LOOK.weatherColor; ctx.beginPath(); ctx.arc(x, G.yAt(H[hv].temp), 3.5, 0, Math.PI * 2); ctx.fill(); }
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
function startDrag(e, handle) {
    e.preventDefault();
    const list = $("#placesList"), rows = [...list.children], from = +handle.dataset.i, row = rows[from];
    if (!row || dragging) return;
    const r = row.getBoundingClientRect();
    dragging = { from, to: from, row, rows, list, grab: e.clientY - r.top, y: e.clientY, h: r.height, pending: false };
    handle.setPointerCapture(e.pointerId);
    row.classList.add("lifted");
    document.body.classList.add("dragging");
    rows.forEach(x => { if (x !== row) x.style.transition = `transform ${ANIM * 0.8}ms cubic-bezier(.33,1,.68,1)`; });
    const scroller = $("#scroll");
    const frame = () => {
        const D = dragging;
        if (!D || D.dropping) return;
        const sr = scroller.getBoundingClientRect();
        if (D.y < sr.top + 50) scroller.scrollTop -= 6; else if (D.y > sr.bottom - 50) scroller.scrollTop += 6;
        const py = D.y - D.list.getBoundingClientRect().top;
        D.row.style.transform = `translateY(${py - D.grab - D.row.offsetTop}px) scale(1.03)`;
        const c = py - D.grab + D.h / 2;
        let t = 0;
        D.rows.forEach((x, i) => { if (i !== D.from && x.offsetTop + x.offsetHeight / 2 < c) t++; });
        D.to = t;
        D.rows.forEach((x, i) => {
            if (i === D.from) return;
            const sh = i < D.from && i >= t ? D.h : i > D.from && i <= t ? -D.h : 0;
            x.style.transform = sh ? `translateY(${sh}px)` : "";
        });
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
        const hOf = (a, b) => { let h = 0; for (let i = a; i <= b; i++) h += D.rows[i].offsetHeight; return h; };
        const off = D.to > D.from ? hOf(D.from + 1, D.to) : D.to < D.from ? -hOf(D.to, D.from - 1) : 0;
        D.row.style.transition = `transform ${ANIM * 0.8}ms cubic-bezier(.33,1,.68,1)`;
        D.row.style.transform = `translateY(${off}px)`;
        D.row.classList.remove("lifted");
        document.body.classList.remove("dragging");
        setTimeout(() => {
            D.rows.forEach(x => { x.style.transition = "none"; x.style.transform = ""; });
            dragging = null;
            move(D.from, D.to);
            render();
            requestAnimationFrame(() => D.rows.forEach(x => { x.style.transition = ""; }));
        }, Math.max(1, ANIM * 0.8));
    };
    handle.addEventListener("pointermove", moveH);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
}

// ════════════ events ════════════
const ACTIONS = {
    mode: el => { S.chartMode = el.dataset.mode; },
    day: el => {
        if (!el.dataset.start) return;
        const wasDay = S.focusDay >= 0;
        pickDay(+el.dataset.start);
        if (S.focusDay >= 0) flash.day = true; else if (wasDay) flash.week = true;
    },
    week: () => { S.focusDay = -1; S.hourHover = -1; flash.week = true; },
    surfDay: el => {
        const cur = bestMode(dataFor(S.selected), S.chartMode);
        pickDay(+el.dataset.start);
        if (cur !== "tide") S.chartMode = "surf";
    },
    select: el => select(+el.dataset.i),
    pin: el => { const i = +el.dataset.i; if (i !== pinned()) pin(i); },
    edit: () => {
        S.editing = !S.editing;
        if (S.editing) setTimeout(showList, ANIM + 20);
    },
    remove: el => {
        const i = +el.dataset.i, row = el.closest(".prow");
        if (!row || row.classList.contains("removing")) return "skip";
        row.style.height = row.offsetHeight + "px";
        void row.offsetHeight;
        row.classList.add("removing");
        setTimeout(() => { remove(i); render(); }, Math.max(1, ANIM));
        return "skip";
    },
    rename: () => {
        S.renaming = true;
        render();
        const f = $("#nameEdit");
        f.value = S.places[S.selected].name;
        f.focus(); f.select();
        return "skip";
    },
    nowToggle: () => { S.nowOpen = !S.nowOpen; },
    add: () => { openAdd(-1, ""); return "skip"; },
    attach: el => { openAdd(S.selected, el.dataset.kind); return "skip"; },
    refresh: () => { refresh(); return "skip"; },
    closeAdd: () => closeAdd(),
    addHit: el => {
        const item = S.searchResults.find(x => x.kind === el.dataset.kind && x.id === el.dataset.id);
        if (item && !alreadyHave(item)) addResult(item);
    },
};

// Edit mode adds the current place to the list; scroll so the whole list is in view.
function showList() {
    const f = $("#scroll"), sec = $("#placesSec");
    if (!sec) return;
    const want = Math.min(sec.offsetTop + sec.offsetHeight - f.clientHeight + 12, f.scrollHeight - f.clientHeight);
    if (f.scrollTop < want) f.scrollTo({ top: want, behavior: ANIM ? "smooth" : "auto" });
}

function wire() {
    document.addEventListener("touchstart", () => {}, { passive: true });   // lets :active work on iOS

    $("#app").addEventListener("click", e => {
        if (e.target.closest("a")) return;            // map links open on their own
        const el = e.target.closest("[data-act]");
        if (!el || el.disabled) return;
        const fn = ACTIONS[el.dataset.act];
        if (!fn) return;
        if (fn(el) !== "skip") render();
    });

    $("#app").addEventListener("pointerdown", e => {
        const h = e.target.closest(".handle");
        if (h) startDrag(e, h);
    });

    // rename field
    $("#hdr").addEventListener("keydown", e => {
        if (e.target.id !== "nameEdit") return;
        if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
        if (e.key === "Escape") { e.target.dataset.cancel = "1"; e.target.blur(); }
    });
    $("#hdr").addEventListener("focusout", e => {
        if (e.target.id !== "nameEdit" || !S.renaming) return;
        if (!e.target.dataset.cancel) rename(S.selected, e.target.value);
        S.renaming = false;
        $("#hdr").innerHTML = "";
        render();
    });

    // search
    const q = $("#q");
    q.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(q.value), 250); });
    q.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); runSearch(q.value); q.blur(); }
        if (e.key === "Escape") { closeAdd(); render(); }
    });
    $("#addBack").addEventListener("click", () => { closeAdd(); render(); });

    // toast: holding a finger on it keeps it up
    const t = $("#toast");
    t.addEventListener("pointerdown", () => clearTimeout(toastTimer));
    t.addEventListener("pointerup", () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, LOOK.toastMs); });
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
        if (e.key === "Escape" && document.activeElement !== q && !(document.activeElement && document.activeElement.id === "nameEdit") && goBack()) render();
    });

    window.addEventListener("resize", () => paint());

    // leaving and coming back
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        if (hiddenAt && Date.now() - hiddenAt > LOOK.resetAfterAwaySec * 1000) resetView();
        refresh();
    });
    setInterval(() => { if (!document.hidden) refresh(); }, Math.max(5, LOOK.refreshMinutes) * 60000);
    // keep "now" lines and ages current
    setInterval(() => { if (!document.hidden && !dragging) render(); }, 60000);
}

document.documentElement.style.setProperty("--anim", ANIM + "ms");
wire();
render();
refresh();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

// for testing from a computer (tools/shot.py)
window.__rt = { S, render, refresh, ACTIONS, select, pickDay, goBack };
