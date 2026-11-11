// Share links: your places and their settings packed into the link's #fragment.
// The fragment never leaves the device (browsers don't send it to the server),
// so the link itself is the only copy. NOAA data isn't included; it downloads fresh.
//
//   https://…/riverdash/#import=z<base64url of deflated JSON {v:1, s: ★ index, p: places}>
// "z" = deflate-raw compressed, "j" = plain JSON (browsers without CompressionStream).

const MODES = ["stage", "flow", "tide", "surf"];
const JETTY = ["calm", "sketchy", "cautionGust", "sketchyGust"];
const MAX_PLACES = 50;
const num = v => typeof v === "number" && isFinite(v) && Math.abs(v) < 1e7;

// Only the known fields, with sane values. Imported links can come from anyone.
export function cleanPlace(p) {
    if (!p || typeof p !== "object") return null;
    const out = {};
    const name = typeof p.name === "string" ? p.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) : "";
    if (typeof p.river === "string" && /^[A-Za-z0-9]{3,12}$/.test(p.river)) out.river = p.river.toUpperCase();
    if (typeof p.tide === "string" && /^[A-Za-z0-9]{4,12}$/.test(p.tide)) out.tide = p.tide;
    if (!out.river && !out.tide) return null;
    out.name = name || out.river || out.tide;
    if (Array.isArray(p.hide)) {
        const h = MODES.filter(m => p.hide.includes(m));
        if (h.length) out.hide = h;
    }
    if (p.ideal && typeof p.ideal === "object") {
        const ideal = {};
        for (const m of ["stage", "flow", "tide"]) {
            const r = p.ideal[m];
            if (!Array.isArray(r)) continue;
            const lo = num(r[0]) ? r[0] : null, hi = num(r[1]) ? r[1] : null;
            if (lo !== null || hi !== null) ideal[m] = [lo, hi];
        }
        if (Object.keys(ideal).length) out.ideal = ideal;
    }
    if (p.jetty && typeof p.jetty === "object") {
        const j = {};
        for (const k of JETTY) if (num(p.jetty[k])) j[k] = p.jetty[k];
        if (Object.keys(j).length) out.jetty = j;
    }
    return out;
}

const b64url = bytes => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function packSetup(places, pinned) {
    const p = places.map(cleanPlace).filter(x => x).slice(0, MAX_PLACES);
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, s: Math.max(0, Math.min(pinned, p.length - 1)), p }));
    if (typeof CompressionStream === "function") {
        try { return "z" + b64url(await pipe(json, new CompressionStream("deflate-raw"))); } catch (e) { /* plain below */ }
    }
    return "j" + b64url(json);
}

// -> {places, pinned}; throws a short message if the code isn't usable.
export async function unpackSetup(code) {
    code = String(code || "").trim();
    if (code.length > 20000 || !/^[zj][A-Za-z0-9_-]+$/.test(code)) throw new Error("Not a Flow Tides link");
    let bytes;
    try { bytes = unb64url(code.slice(1)); } catch (e) { throw new Error("Not a Flow Tides link"); }
    if (code[0] === "z") {
        if (typeof DecompressionStream !== "function") throw new Error("This browser is too old to open the link");
        try { bytes = await pipe(bytes, new DecompressionStream("deflate-raw")); } catch (e) { throw new Error("The link is cut off"); }
    }
    let obj;
    try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error("The link is cut off"); }
    if (!obj || obj.v !== 1 || !Array.isArray(obj.p)) throw new Error("Made by a newer Flow Tides; update the app");
    const places = obj.p.slice(0, MAX_PLACES).map(cleanPlace).filter(x => x);
    if (!places.length) throw new Error("No places in this link");
    const s = Number.isInteger(obj.s) ? Math.max(0, Math.min(obj.s, places.length - 1)) : 0;
    return { places, pinned: s };
}

// Finds the code in a pasted link, a bare code, or text around a link.
export function codeFrom(text) {
    const m = String(text || "").match(/#import=([zj][A-Za-z0-9_-]+)/);
    if (m) return m[1];
    const t = String(text || "").trim();
    return /^[zj][A-Za-z0-9_-]{8,}$/.test(t) ? t : "";
}

export const shareUrl = code => new URL("./", location.href).href.replace(/[?#].*$/, "") + "#import=" + code;
