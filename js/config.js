// ┌──────────────────────────────────────────────────────────────────┐
// │  THE LOOK OF THE APP LIVES HERE (the phone version of Style.qml). │
// │  Change a value, push it to GitHub, then reopen the app.          │
// │  Text and background colors follow the phone's light/dark mode    │
// │  and live in css/app.css (:root).                                 │
// └──────────────────────────────────────────────────────────────────┘
export const LOOK = {
    // ── Accent colors (one per kind of reading) ──────────────────────
    stageColor: "#5cb8ff",   // river height
    flowColor:  "#4fd1b0",   // river flow
    tideColor:  "#b48cff",   // tide
    surfColor:  "#f0a35e",   // swell (coastal tide stations)

    // ── Flood status colors ──────────────────────────────────────────
    actionColor:   "#f5c542",
    minorColor:    "#ff9a3c",
    moderateColor: "#ff5c5c",
    majorColor:    "#d76cff",

    // ── Mini graphs in the places list ───────────────────────────────
    sparkPastHours: 24,      // graph window: hours back…
    sparkFutureHours: 12,    // …and hours ahead (forecast / tide prediction)

    // ── Details page ─────────────────────────────────────────────────
    chartHeight: 140,        // px
    lineWidth: 2,            // chart line thickness
    fillOpacity: 0.18,       // chart area shading
    chartMinZoomHours: 2,    // most zoomed-in the big chart goes (pinch to zoom)
    // Most zoomed-out = all data already downloaded: river 2 days back + the whole forecast (~7 days)
    // and tide 12 h back + 36 h ahead.

    // ── Jetty / surf rating (coastal tide stations only) ─────────────
    // Each hour is rated from the forecast wave height (all swell + wind waves),
    // its period, and wind gusts. Rough defaults: tune them to your jetty.
    calmColor:    "#5ccf6a",  // green
    cautionColor: "#f5c542",  // yellow
    sketchyColor: "#ff5c5c",  // red
    jettyCalmMaxFt: 5,        // waves up to this = green…
    jettySketchyFt: 8,        // …above this = red, in between yellow
    jettyLongPeriodS: 13,     // long-period swell hits jetties harder:
    jettyLongPeriodFactor: 1.3, //  at/above that period, waves count this much bigger
    jettyCautionGustMph: 20,  // gusts above this = at least yellow
    jettySketchyGustMph: 30,  // gusts above this = red

    // ── Weather week (every place) ───────────────────────────────────
    showWeather: true,        // false hides the 7-day weather section
    weatherColor: "#9ec5e8",  // "Week" pill, picked-hour line
    rainColor:    "#5cb8ff",  // rain chance %
    warmColor:    "#f5b14a",  // top of each day's temperature bar (high)
    coolColor:    "#5cb8ff",  // bottom of the bar (low)
    rainDimBelow: 30,         // rain chances under this % aren't shown

    // ── Motion & timing ──────────────────────────────────────────────
    animationMs: 220,         // slides, fades, row removal (0 = off)
    toastMs: 4500,            // how long "Removed … Undo" stays up
    refreshMinutes: 15,       // refresh while the app is open
    resetAfterAwaySec: 60,    // away longer than this = reopen on the ★ place, right now
};

// First run only (empty: add your own with + Add). After that the list lives
// on the phone (Safari storage for this app).
export const DEFAULT_PLACES = [];
