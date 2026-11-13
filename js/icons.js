// Inline SVG icons: weather (stand-ins for the Breeze weather icons the widget
// uses) and a few UI symbols. All drawn on a 32×32 grid.

const SUN = "#fdbc4b", MOON = "#f4e3a1", CLOUD = "#e6eaee", CLOUD_EDGE = "#aab3bc",
      DARK = "#8d97a1", DARK_EDGE = "#6b747d", RAIN = "#3daee9", SNOW = "#ffffff", BOLT = "#fdbc4b";

const sun = (cx = 16, cy = 16, r = 6.5) => {
    let rays = "";
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, x1 = cx + Math.cos(a) * (r + 2.6), y1 = cy + Math.sin(a) * (r + 2.6),
              x2 = cx + Math.cos(a) * (r + 5.2), y2 = cy + Math.sin(a) * (r + 5.2);
        rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }
    return `<g stroke="${SUN}" stroke-width="2" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;
};
const moon = (cx = 16, cy = 16, r = 8) =>
    `<path d="M${cx + r * 0.25} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.75} ${r * 1.45} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.75} ${-r * 1.45}z" fill="${MOON}"/>`;
const cloud = (dx = 0, dy = 0, s = 1, dark = false) =>
    `<path transform="translate(${dx} ${dy}) scale(${s})" d="M9 25h15.5a5.5 5.5 0 0 0 .6-11A7.5 7.5 0 0 0 10.6 12.2 6.4 6.4 0 0 0 9 25z"
      fill="${dark ? DARK : CLOUD}" stroke="${dark ? DARK_EDGE : CLOUD_EDGE}" stroke-width="1.1" stroke-linejoin="round"/>`;
const drops = (xs, y = 25.5) => xs.map(x =>
    `<line x1="${x}" y1="${y}" x2="${x - 1.6}" y2="${y + 4.4}" stroke="${RAIN}" stroke-width="2" stroke-linecap="round"/>`).join("");
const flakes = (xs, y = 27.5) => xs.map(x =>
    `<g stroke="${SNOW}" stroke-width="1.4" stroke-linecap="round"><line x1="${x - 2}" y1="${y}" x2="${x + 2}" y2="${y}"/>` +
    `<line x1="${x - 1}" y1="${y - 1.8}" x2="${x + 1}" y2="${y + 1.8}"/><line x1="${x + 1}" y1="${y - 1.8}" x2="${x - 1}" y2="${y + 1.8}"/></g>` +
    `<circle cx="${x}" cy="${y}" r="0.6" fill="${DARK_EDGE}"/>`).join("");

const ART = {
    clear: () => sun(),
    "clear-night": () => moon(),
    few: () => sun(12, 12, 5.5) + cloud(5, 6, 0.8),
    "few-night": () => moon(12, 11, 7) + cloud(5, 6, 0.8),
    clouds: () => sun(11, 11, 5) + cloud(1, 2, 0.95),
    "clouds-night": () => moon(11, 10, 6.5) + cloud(1, 2, 0.95),
    overcast: () => cloud(-4, -4, 0.75, true) + cloud(1, 1, 0.95),
    fog: () => cloud(0, -4, 0.95) + `<g stroke="${CLOUD_EDGE}" stroke-width="2" stroke-linecap="round"><line x1="5" y1="25" x2="27" y2="25"/><line x1="8" y1="29" x2="24" y2="29"/></g>`,
    scattered: () => sun(10, 10, 4.8) + cloud(1, -2, 0.95) + drops([14, 20]),
    "scattered-night": () => moon(10, 9, 6) + cloud(1, -2, 0.95) + drops([14, 20]),
    showers: () => cloud(0, -3, 1, true) + drops([10, 16, 22]),
    freezing: () => cloud(0, -3, 1, true) + drops([10, 22]) + flakes([16]),
    "snow-scattered": () => cloud(0, -3, 1) + flakes([12, 21]),
    snow: () => cloud(0, -3, 1) + flakes([9, 16, 23]),
    storm: () => cloud(0, -4, 1, true) + `<path d="M17 19l-4.5 7h3.6l-2 6 6-8.2h-3.7l2.4-4.8z" fill="${BOLT}"/>` + drops([9, 24], 23),
    none: () => `<circle cx="16" cy="16" r="10" fill="none" stroke="${CLOUD_EDGE}" stroke-width="2"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="${CLOUD_EDGE}" font-family="sans-serif">?</text>`,
};

// WMO weather code -> icon (same groups as the widget's wxIcon)
export function wxIconName(c, day) {
    const n = day === false ? "-night" : "";
    return c === 0 ? "clear" + n : c === 1 ? "few" + n : c === 2 ? "clouds" + n
         : c === 3 ? "overcast" : c === 45 || c === 48 ? "fog"
         : (c >= 51 && c <= 55) || c === 61 || c === 80 ? "scattered" + n
         : c === 56 || c === 57 || c === 66 || c === 67 ? "freezing"
         : c === 63 || c === 65 || c === 81 || c === 82 ? "showers"
         : c === 71 || c === 85 ? "snow-scattered" : c === 73 || c === 75 || c === 77 || c === 86 ? "snow"
         : c >= 95 ? "storm" : "none";
}
export function wxIcon(c, day, size = 24) {
    const art = ART[wxIconName(c, day)] || ART.none;
    return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${art()}</svg>`;
}

// UI symbols, drawn with currentColor
const UI = {
    star: `<path d="M16 3.5l3.8 7.9 8.6 1.2-6.3 6 1.6 8.6L16 23.1l-7.7 4.1 1.6-8.6-6.3-6 8.6-1.2z" fill="currentColor"/>`,
    starOutline: `<path d="M16 3.5l3.8 7.9 8.6 1.2-6.3 6 1.6 8.6L16 23.1l-7.7 4.1 1.6-8.6-6.3-6 8.6-1.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    refresh: `<path d="M25.5 12.5A10 10 0 1 0 26 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M27 5v8h-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    sliders: `<path d="M5 9h22M5 16h22M5 23h22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="20" cy="9" r="3.2" fill="var(--bg)" stroke="currentColor" stroke-width="2.2"/><circle cx="11" cy="16" r="3.2" fill="var(--bg)" stroke="currentColor" stroke-width="2.2"/><circle cx="18" cy="23" r="3.2" fill="var(--bg)" stroke="currentColor" stroke-width="2.2"/>`,
    plus: `<path d="M16 6v20M6 16h20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
    back: `<path d="M20 5L9 16l11 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    next: `<path d="M12 5l11 11-11 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    list: `<circle cx="6.5" cy="9" r="1.9" fill="currentColor"/><circle cx="6.5" cy="16" r="1.9" fill="currentColor"/><circle cx="6.5" cy="23" r="1.9" fill="currentColor"/><path d="M12 9h15M12 16h15M12 23h15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
    handle: `<path d="M7 11h18M7 16h18M7 21h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    search: `<circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20 20l7 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
    empty: `<circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 23.5l15-15" stroke="currentColor" stroke-width="2"/>`,
    rain: `<path d="M16 4c4 6 8 10.5 8 15a8 8 0 0 1-16 0c0-4.5 4-9 8-15z" fill="currentColor"/>`,
    share: `<path d="M16 4v15M10 9.5L16 4l6 5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 14H8v13h16V14h-3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    receive: `<path d="M16 4v14M10 12.5L16 18l6-5.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 19v7h20v-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    mail: `<rect x="4" y="7" width="24" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2.3"/><path d="M5.5 9l10.5 8 10.5-8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
    copy: `<rect x="10" y="10" width="15" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M7 21V7.5A2.5 2.5 0 0 1 9.5 5H20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
};
export function icon(name, size = 20, cls = "") {
    return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${UI[name]}</svg>`;
}
