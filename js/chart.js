// Line chart (port of the widget's Chart.qml): solid past, dashed forecast,
// "now" line, optional threshold (flood stage), labelled markers (tide highs/lows)
// and an optional "ideal" band: the line is green inside it and red outside.
// minimal: true = bare sparkline (the places list).
//
// Big chart on the phone:
//   drag sideways  show the value and time under your finger (stays after you let go,
//                  and stays on the same time when you switch to another chart)
//   pinch          zoom around your fingers; move two fingers to pan
//   double-tap     back to the normal view
// On a computer: hover, scroll to zoom, drag to pan, double-click.
// Zoom never goes past the data already downloaded.

import { fmtTime, fmtDay, sameDay } from "./fmt.js";

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const clean = a => (a || []).filter(p => p[1] !== null && p[1] !== undefined);

function sizeCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return [ctx, w, h];
}

export class Chart {
    constructor(opts = {}) {
        this.g = { series: [], forecast: [], markers: [], color: "#5cb8ff", decimals: 1 };
        this.minimal = !!opts.minimal;
        this.lineWidth = opts.lineWidth || 2;
        this.fillOpacity = opts.fillOpacity ?? 0.18;
        this.minSpanHours = opts.minSpanHours || 2;
        this.viewKey = null;
        this.view0 = NaN; this.view1 = NaN;   // current view; NaN = home
        this.hoverKey = null;
        this.hoverT = NaN;                    // time of the reading bar; NaN = none
        this.pinT = NaN;                      // mouse: where a click left the bar
        this.onHover = opts.onHover || null;  // called with the bar's time when you move it (NaN = gone)
        this.box = { left: 0, right: 1 };
        this.cv = null;
    }

    // data: {series, forecast, color, decimals, nowValue, threshold, thresholdLabel, markers, unit, homeT0, homeT1,
    //        ideal: {lo, hi, good, bad}}  (lo / hi may be NaN = no bound on that side)
    // viewKey changes reset the zoom; hoverKey changes clear the reading bar
    // (so switching Height → Flow → Tide keeps the bar on the same time).
    set(cv, g, viewKey, hoverKey = viewKey) {
        if (viewKey !== this.viewKey) { this.viewKey = viewKey; this.view0 = this.view1 = NaN; }
        if (hoverKey !== this.hoverKey) { this.hoverKey = hoverKey; this.hoverT = this.pinT = NaN; }
        const newView = isNaN(this.view0);
        this.g = g;
        if (cv !== this.cv) { this.cv = cv; if (!this.minimal) this.bind(cv); }
        this.clampView();
        // Switched charts with the reading bar up: if its time is off this chart's
        // normal view (but within the data), slide the view over so the bar shows.
        const h = newView ? this.home() : null, e = this.extents(), t = this.hoverT;
        if (h && e && !isNaN(t) && (t < h[0] || t > h[1]) && t >= e[0] && t <= e[1]) {
            const span = h[1] - h[0];
            this.setView(t - span / 2, t + span / 2);
            return;
        }
        this.paint();
    }

    points() { return clean(this.g.series).concat(clean(this.g.forecast)); }
    extents() { const a = this.points(); return a.length < 2 ? null : [a[0][0], a[a.length - 1][0]]; }
    home() {
        const e = this.extents();
        if (!e) return null;
        const h0 = this.g.homeT0, h1 = this.g.homeT1;
        const a = h0 === undefined || isNaN(h0) ? e[0] : Math.max(e[0], h0);
        const b = h1 === undefined || isNaN(h1) ? e[1] : Math.min(e[1], h1);
        return b > a ? [a, b] : e;
    }
    view() { return isNaN(this.view0) ? this.home() : [this.view0, this.view1]; }
    resetView() { this.view0 = this.view1 = NaN; this.paint(); }
    // Bar under a finger / pointer at x (kept inside the plot), and tell the page.
    hoverAt(x) {
        x = Math.min(Math.max(x, this.box.left), this.box.right);
        this.setHoverT(this.timeAt(x));
    }
    setHoverT(t) {
        this.hoverT = t;
        this.paint();
        if (this.onHover) this.onHover(t);
    }
    // Put the bar on a time picked somewhere else (an hour in the weather);
    // slides the view over if that time is off screen. Doesn't call onHover.
    showTime(t) {
        this.hoverT = this.pinT = t;
        const v = this.view(), e = this.extents();
        if (v && e && !isNaN(t) && (t < v[0] || t > v[1]) && t >= e[0] && t <= e[1]) {
            const span = v[1] - v[0];
            this.setView(t - span / 2, t + span / 2);
        } else this.paint();
    }
    setView(a, b) {
        const e = this.extents();
        if (!e) return;
        const full = e[1] - e[0];
        const span = Math.min(Math.max(b - a, Math.min(this.minSpanHours * 3600000, full)), full);
        a = Math.min(Math.max(a, e[0]), e[1] - span);
        this.view0 = a; this.view1 = a + span;
        this.paint();
    }
    clampView() { if (!isNaN(this.view0)) { const a = this.view0, b = this.view1; this.view0 = NaN; this.setView(a, b); } }
    timeAt(x, v = this.view()) { return v[0] + (x - this.box.left) / (this.box.right - this.box.left) * (v[1] - v[0]); }
    valueAt(t) {
        const all = this.points();
        for (let i = 1; i < all.length; i++)
            if (all[i - 1][0] <= t && t <= all[i][0]) {
                const a = all[i - 1], b = all[i];
                return b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]);
            }
        return NaN;
    }

    bind(cv) {
        const pts = new Map();   // pointerId -> {x, y}
        let mode = "", start = null, lastTap = 0, lastTapX = 0, lastMouseX = 0, mouseDownX = NaN;
        const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
        const pinchState = () => {
            const [a, b] = [...pts.values()];
            return { d: Math.max(20, Math.abs(a.x - b.x)), m: (a.x + b.x) / 2, v: this.view() };
        };

        // A touch that starts anywhere else ends whatever the chart was doing, so a
        // lost "finger up" can never leave the chart grabbing taps meant for the tabs.
        const reset = () => {
            for (const id of pts.keys()) { try { cv.releasePointerCapture(id); } catch (err) { /* already gone */ } }
            pts.clear(); mode = "";
        };
        document.addEventListener("pointerdown", e => { if (e.target !== cv && pts.size) reset(); }, true);

        cv.addEventListener("pointerdown", e => {
            const p = local(e);
            pts.set(e.pointerId, p);
            if (e.pointerType === "mouse") { cv.setPointerCapture(e.pointerId); mode = "pan"; lastMouseX = mouseDownX = p.x; return; }
            if (pts.size === 2) { mode = "pinch"; start = pinchState(); }
            else if (pts.size === 1) { mode = "maybe"; start = { x: p.x, y: p.y, t: e.timeStamp }; }
        });
        cv.addEventListener("pointermove", e => {
            const p = local(e);
            if (e.pointerType === "mouse") {
                if (pts.has(e.pointerId) && mode === "pan") {
                    const v = this.view(), dt = (lastMouseX - p.x) / (this.box.right - this.box.left) * (v[1] - v[0]);
                    this.setView(v[0] + dt, v[1] + dt);
                    lastMouseX = p.x;
                }
                this.hoverAt(p.x);
                return;
            }
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, p);
            if (mode === "maybe" && Math.abs(p.x - start.x) > 6 && Math.abs(p.x - start.x) > Math.abs(p.y - start.y)) mode = "scrub";
            if (mode === "scrub") { e.preventDefault(); this.hoverAt(p.x); }
            else if (mode === "pinch" && pts.size === 2) {
                e.preventDefault();
                const now = pinchState(), s = start, span = (s.v[1] - s.v[0]) * s.d / now.d;
                const anchor = this.timeAt(s.m, s.v);
                const frac = (s.m - this.box.left) / (this.box.right - this.box.left);
                const shift = (now.m - s.m) / (this.box.right - this.box.left) * span;
                const a = anchor - frac * span - shift;
                this.setView(a, a + span);
            }
        });
        const end = e => {
            const had = pts.delete(e.pointerId);
            if (e.pointerType === "mouse") {
                // a click (no drag) pins the bar there, like a tap on the phone
                if (e.type === "pointerup" && Math.abs(local(e).x - mouseDownX) < 4) { this.pinT = this.hoverT; }
                mode = ""; return;
            }
            if (!had) return;
            if (mode === "maybe" && e.type === "pointerup") {   // a tap
                const p = local(e);
                if (e.timeStamp - lastTap < 320 && Math.abs(p.x - lastTapX) < 30) { this.resetView(); this.setHoverT(NaN); lastTap = 0; }
                else { this.hoverAt(p.x); lastTap = e.timeStamp; lastTapX = p.x; }
            }
            if (pts.size === 1 && mode === "pinch") { mode = "done"; }
            if (pts.size === 0) mode = "";
        };
        cv.addEventListener("pointerup", end);
        cv.addEventListener("pointercancel", end);
        cv.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") this.setHoverT(this.pinT); });
        cv.addEventListener("dblclick", () => { this.pinT = NaN; this.resetView(); this.setHoverT(NaN); });
        cv.addEventListener("wheel", e => {
            const v = this.view();
            if (!v) return;
            e.preventDefault();
            const p = local(e), dy = e.deltaY, dx = e.deltaX;
            if (Math.abs(dx) > Math.abs(dy)) {
                const dt = dx / 1200 * (v[1] - v[0]);
                this.setView(v[0] + dt, v[1] + dt);
            } else if (dy) {
                const f = Math.pow(0.85, -dy / 120);
                const anchor = Math.min(Math.max(this.timeAt(p.x), v[0]), v[1]);
                this.setView(anchor - (anchor - v[0]) * f, anchor + (v[1] - anchor) * f);
            }
            this.hoverAt(p.x);
        }, { passive: false });
    }

    paint() {
        const cv = this.cv;
        if (!cv || !cv.isConnected) return;
        const [ctx, width, height] = sizeCanvas(cv);
        const g = this.g, minimal = this.minimal, lineWidth = this.lineWidth;
        const past = clean(g.series), fut = clean(g.forecast);
        const all = past.concat(fut);
        if (all.length < 2) return;

        const text = css("--text"), bg = css("--bg");
        const px = 11;
        ctx.font = `${px}px -apple-system, system-ui, sans-serif`;
        const decimals = g.decimals ?? 1, unit = g.unit || "", color = g.color;

        const vw = this.view();
        const t0 = vw[0], t1 = vw[1];
        // vertical range from what's visible (plus the points just outside, so lines reach the edge)
        let v0 = Infinity, v1 = -Infinity;
        for (let i = 0; i < all.length; i++) {
            const p = all[i], nextIn = i + 1 < all.length && all[i + 1][0] >= t0, prevIn = i > 0 && all[i - 1][0] <= t1;
            if ((p[0] >= t0 && p[0] <= t1) || (p[0] < t0 && nextIn) || (p[0] > t1 && prevIn)) {
                v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
            }
        }
        if (!isFinite(v0)) return;
        // Show the threshold only if it's within reach of the data.
        const thr = g.threshold;
        const span0 = Math.max(v1 - v0, 0.5);
        const showThr = thr !== undefined && thr !== null && !isNaN(thr) && thr <= v1 + span0 * 1.5 && thr >= v0 - span0 * 1.5;
        if (showThr) { v1 = Math.max(v1, thr); v0 = Math.min(v0, thr); }
        // Ideal band: its edges are pulled into view when they're close to the data.
        const ib = g.ideal, ok = x => x !== undefined && x !== null && !isNaN(x);
        const band = ib && (ok(ib.lo) || ok(ib.hi)) ? ib : null;
        const pad = Math.max((v1 - v0) * 0.12, 0.1);
        v0 -= pad; v1 += pad;

        const fmt = v => v.toFixed(decimals);
        const left = minimal ? lineWidth : Math.max(ctx.measureText(fmt(v1)).width, ctx.measureText(fmt(v0)).width) + 6;
        const top = minimal ? lineWidth + 2 : px + 4;
        const bottom = minimal ? height - lineWidth - 1 : height - px - 6;
        const right = width - (minimal ? lineWidth + 2 : 2);
        this.box = { left, right };
        const X = t => left + (t - t0) / (t1 - t0) * (right - left);
        const Y = v => bottom - (v - v0) / (v1 - v0) * (bottom - top);
        const now = Date.now();

        // axes labels
        if (!minimal) {
            ctx.fillStyle = text; ctx.globalAlpha = 0.55;
            ctx.textBaseline = "middle"; ctx.textAlign = "right";
            ctx.fillText(fmt(v1 - pad), left - 4, Y(v1 - pad));
            ctx.fillText(fmt(v0 + pad), left - 4, Y(v0 + pad));
            ctx.textBaseline = "top";
            const long = t1 - t0 > 30 * 3600000;
            const tl = t => long ? fmtDay(t) : sameDay(t, now) ? fmtTime(t, "h A") : fmtDay(t) + " " + fmtTime(t, "h A");
            // end labels, unless "now" (drawn below) would overlap them
            const nowX = now > t0 && now < t1 ? X(now) : NaN, gap = w => ctx.measureText("now").width / 2 + w + 8;
            const l0 = tl(t0), l1 = tl(t1);
            if (!(nowX - left < gap(ctx.measureText(l0).width))) { ctx.textAlign = "left"; ctx.fillText(l0, left, bottom + 4); }
            if (!(right - nowX < gap(ctx.measureText(l1).width))) { ctx.textAlign = "right"; ctx.fillText(l1, right, bottom + 4); }
            // baseline
            ctx.globalAlpha = 0.15; ctx.strokeStyle = text; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(left, bottom + 0.5); ctx.lineTo(right, bottom + 0.5); ctx.stroke();
        }

        // everything plotted is clipped to the plot area (matters when zoomed)
        ctx.save();
        ctx.beginPath(); ctx.rect(left - lineWidth - 3, 0, right - left + 2 * lineWidth + 6, height); ctx.clip();

        if (showThr && !minimal) {
            ctx.globalAlpha = 0.6; ctx.strokeStyle = "#ff5c5c"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(left, Y(thr)); ctx.lineTo(right, Y(thr)); ctx.stroke();
            ctx.setLineDash([]); ctx.fillStyle = "#ff5c5c"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
            ctx.fillText(g.thresholdLabel || "", left + 3, Y(thr) - 1);
        }

        // good range: only the line's color shows it (y of its top and bottom edge; an open side runs off the chart)
        const bandTop = band && ok(band.hi) ? Y(band.hi) : -1e4, bandBot = band && ok(band.lo) ? Y(band.lo) : 1e4;

        // area + line
        const path = pts => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); };
        // With an ideal band the line is drawn in pieces: green inside the band, red outside.
        const stroke = (pts, alpha, dash) => {
            ctx.lineWidth = lineWidth; ctx.lineJoin = "round"; ctx.setLineDash(dash);
            if (!band) { path(pts); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.stroke(); }
            else for (const [y0, y1, c] of [[-1e4, bandTop, band.bad], [bandTop, bandBot, band.good], [bandBot, 1e4, band.bad]]) {
                if (y1 <= y0) continue;
                ctx.save(); ctx.beginPath(); ctx.rect(-10, y0, width + 20, y1 - y0); ctx.clip();
                path(pts); ctx.globalAlpha = alpha; ctx.strokeStyle = c; ctx.stroke();
                ctx.restore();
            }
            ctx.setLineDash([]);
        };
        if (past.length > 1) {
            path(past); ctx.lineTo(X(past[past.length - 1][0]), bottom); ctx.lineTo(X(past[0][0]), bottom); ctx.closePath();
            ctx.globalAlpha = this.fillOpacity; ctx.fillStyle = color; ctx.fill();
            stroke(past, 1, []);
        }
        if (fut.length > 1) stroke(past.length ? [past[past.length - 1]].concat(fut) : fut, 0.8, [4, 3]);

        // now line + dot
        if (now > t0 && now < t1) {
            ctx.globalAlpha = 0.35; ctx.strokeStyle = text; ctx.lineWidth = 1; ctx.setLineDash([1, 3]);
            ctx.beginPath(); ctx.moveTo(X(now), top); ctx.lineTo(X(now), bottom); ctx.stroke(); ctx.setLineDash([]);
            if (!minimal) {
                ctx.globalAlpha = 0.55; ctx.fillStyle = text; ctx.textAlign = "center"; ctx.textBaseline = "top";
                ctx.fillText("now", X(now), bottom + 4);
            }
        }
        const nv = g.nowValue;
        const hasNow = nv !== undefined && nv !== null && !isNaN(nv);
        const dotT = hasNow ? now : (past.length ? past[past.length - 1][0] : NaN);
        const dotV = hasNow ? nv : (past.length ? past[past.length - 1][1] : NaN);
        if (!isNaN(dotT) && dotT >= t0 && dotT <= t1) {
            ctx.globalAlpha = 1; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(X(dotT), Y(dotV), lineWidth + (minimal ? 1 : 2), 0, 2 * Math.PI); ctx.fill();
        }

        // markers (tide highs / lows)
        ctx.textAlign = "center";
        for (const m of minimal ? [] : g.markers || []) {
            if (m.time < t0 || m.time > t1) continue;
            const x = X(m.time), y = Y(m.value);
            ctx.globalAlpha = 0.9; ctx.fillStyle = color;
            ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
            if (t1 - t0 > 3 * 86400000) continue;   // a week of highs/lows: dots only, labels would pile up
            ctx.globalAlpha = 0.75; ctx.fillStyle = text;
            ctx.textBaseline = m.above ? "bottom" : "top";
            const w = ctx.measureText(m.label).width;
            const lx = Math.min(Math.max(x, left + w / 2), right - w / 2);
            ctx.fillText(m.label, lx, m.above ? y - 4 : y + 4);
        }
        ctx.restore();

        // readout under the finger / pointer
        const ht = this.hoverT;
        if (!minimal && ht >= t0 && ht <= t1) {
            const t = ht;
            const v = this.valueAt(t);
            if (!isNaN(v)) {
                const x = X(t), y = Y(v);
                ctx.globalAlpha = 0.5; ctx.strokeStyle = text; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, bottom); ctx.stroke();
                ctx.globalAlpha = 1; ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(x, y, lineWidth + 2, 0, 2 * Math.PI); ctx.fill();

                const when = (sameDay(t, now) ? "" : fmtDay(t) + " ") + fmtTime(t, "h:mm A");
                const label = fmt(v) + unit + "  ·  " + when + (past.length && t > past[past.length - 1][0] && fut.length ? " (forecast)" : "");
                const w = ctx.measureText(label).width + 10, h = px + 8;
                const bx = Math.min(Math.max(x - w / 2, left), right - w);
                const by = y - h - 8 < 0 ? y + 8 : y - h - 8;
                ctx.globalAlpha = 0.94; ctx.fillStyle = bg;
                ctx.fillRect(bx, by, w, h);
                ctx.globalAlpha = 0.6; ctx.strokeStyle = color;
                ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
                ctx.globalAlpha = 1; ctx.fillStyle = text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
                ctx.fillText(label, bx + 5, by + h / 2);
            }
        }
    }
}

// Several sparklines on one canvas (a river group in the places list): each line
// scaled to its own range, gray ones underneath so the colored ones stand out.
export function drawMultiSpark(cv, gs, plain, lineWidth = 1.25) {
    if (!cv || !cv.isConnected) return;
    const [ctx, w, h] = sizeCanvas(cv);
    const lines = gs.map(g => ({ g, past: clean(g.series), fut: clean(g.forecast) }))
        .filter(l => l.past.length + l.fut.length > 1)
        .sort((a, b) => (b.g.color === plain) - (a.g.color === plain));
    if (!lines.length) return;
    let t0 = Infinity, t1 = -Infinity;
    for (const l of lines) for (const p of l.past.concat(l.fut)) { t0 = Math.min(t0, p[0]); t1 = Math.max(t1, p[0]); }
    const pad = lineWidth + 1, X = t => pad + (t - t0) / (t1 - t0 || 1) * (w - 2 * pad);
    ctx.lineWidth = lineWidth; ctx.lineJoin = "round";
    for (const l of lines) {
        const all = l.past.concat(l.fut);
        let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
        if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
        const Y = v => h - pad - (v - lo) / (hi - lo) * (h - 2 * pad);
        const stroke = (pts, alpha, dash) => {
            if (pts.length < 2) return;
            ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
            ctx.globalAlpha = alpha; ctx.strokeStyle = l.g.color; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
        };
        stroke(l.past, 0.95, []);
        stroke(l.past.length ? [l.past[l.past.length - 1]].concat(l.fut) : l.fut, 0.7, [3, 2]);
    }
    ctx.globalAlpha = 1;
}

// Sparkline into a canvas (places list).
export function drawSpark(cv, g, lineWidth = 1.25, fillOpacity = 0.18) {
    const c = new Chart({ minimal: true, lineWidth, fillOpacity });
    c.cv = cv; c.g = g;
    c.paint();
}
