// Small QR code encoder (byte mode, error correction L or M), drawn as SVG.
// Written for Flow Tides so the app needs no outside code. Follows the
// QR Code spec (ISO/IEC 18004); same structure as Project Nayuki's encoder.

const ECC = {   // [error correction codewords per block, number of blocks], index = version
    L: { bits: 1,
         per: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
         blocks: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25] },
    M: { bits: 0,
         per: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
         blocks: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49] },
};

function rawModules(ver) {
    let n = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const a = Math.floor(ver / 7) + 2;
        n -= (25 * a - 10) * a - 55;
        if (ver >= 7) n -= 36;
    }
    return n;
}
const dataCodewords = (ver, e) => Math.floor(rawModules(ver) / 8) - ECC[e].per[ver] * ECC[e].blocks[ver];

function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}
function rsDivisor(n) {
    const r = new Array(n).fill(0);
    r[n - 1] = 1;
    let root = 1;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            r[j] = gfMul(r[j], root);
            if (j + 1 < n) r[j] ^= r[j + 1];
        }
        root = gfMul(root, 2);
    }
    return r;
}
function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
        const f = b ^ r.shift();
        r.push(0);
        for (let i = 0; i < div.length; i++) r[i] ^= gfMul(div[i], f);
    }
    return r;
}

function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
}

const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

// Returns {size, dark(x, y)}. text is encoded as UTF-8. forceMask is for tests.
export function qrEncode(text, ecl = "M", forceMask = -1) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 40; ver++) {
        const bits = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
        if (bits <= dataCodewords(ver, ecl) * 8) break;
    }
    if (ver > 40) throw new Error("too long for a QR code");
    const size = ver * 4 + 17, capBytes = dataCodewords(ver, ecl);

    // data bits: byte mode, length, data, terminator, padding
    const bb = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bb.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, capBytes * 8 - bb.length));
    put(0, (8 - bb.length % 8) % 8);
    for (let pad = 0xec; bb.length < capBytes * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bb.length; i += 8) data.push(bb.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));

    // error correction, split into blocks and interleaved
    const nBlocks = ECC[ecl].blocks[ver], eccLen = ECC[ecl].per[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nBlocks - raw % nBlocks, shortLen = Math.floor(raw / nBlocks), div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nBlocks; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < nShort) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++)
        blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

    // grid with the fixed patterns
    const grid = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { grid[y][x] = d; fixed[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
            if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
    const ap = alignPositions(ver), last = ap.length - 1;
    ap.forEach((ay, i) => ap.forEach((ax, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
            set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const drawFormat = mask => {
        const d = ECC[ecl].bits << 3 | mask;
        let r = d;
        for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
        const bits = (d << 10 | r) ^ 0x5412, bit = i => ((bits >>> i) & 1) === 1;
        for (let i = 0; i <= 5; i++) set(8, i, bit(i));
        set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
        set(8, size - 8, true);
    };
    drawFormat(0);   // reserve the format areas
    if (ver >= 7) {
        let r = ver;
        for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
        const bits = ver << 12 | r;
        for (let i = 0; i < 18; i++) {
            const d = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
            set(a, b, d); set(b, a, d);
        }
    }

    // codewords in the zigzag order
    let n = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
            const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
            if (!fixed[y][x] && n < all.length * 8) { grid[y][x] = ((all[n >>> 3] >>> (7 - (n & 7))) & 1) === 1; n++; }
        }
    }

    const applyMask = m => {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
            if (!fixed[y][x] && MASKS[m](x, y)) grid[y][x] = !grid[y][x];
    };
    let mask = forceMask;
    if (mask < 0) {
        let best = Infinity;
        for (let m = 0; m < 8; m++) {
            applyMask(m); drawFormat(m);
            const p = penalty(grid, size);
            if (p < best) { best = p; mask = m; }
            applyMask(m);
        }
    }
    applyMask(mask); drawFormat(mask);
    return { size, mask, version: ver, dark: (x, y) => grid[y][x] };
}

// Spec penalty rules 1-4 (picks the mask that scans most easily).
function penalty(g, size) {
    let p = 0, dark = 0;
    const lines = [];
    for (let i = 0; i < size; i++) { lines.push(g[i]); lines.push(g.map(r => r[i])); }
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
            if (i < size && line[i] === line[i - 1]) run++;
            else { if (run >= 5) p += run - 2; run = 1; }
        }
        // finder-like 1:1:3:1:1 with 4 light on one side
        for (let i = 0; i + 7 <= size; i++) {
            if (line[i] && !line[i + 1] && line[i + 2] && line[i + 3] && line[i + 4] && !line[i + 5] && line[i + 6]) {
                const lightBefore = [1, 2, 3, 4].every(k => i - k < 0 || !line[i - k]);
                const lightAfter = [7, 8, 9, 10].every(k => i + k >= size || !line[i + k]);
                if (lightBefore || lightAfter) p += 40;
            }
        }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (g[y][x]) dark++;
        if (x + 1 < size && y + 1 < size && g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3;
    }
    const total = size * size;
    p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return p;
}

// SVG markup: dark modules as one path, with a 4-module quiet zone.
export function qrSvg(text, px = 220) {
    const q = qrEncode(text, "M"), m = q.size + 8;
    let d = "";
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++)
        if (q.dark(x, y)) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return `<svg class="qr" width="${px}" height="${px}" viewBox="0 0 ${m} ${m}" shape-rendering="crispEdges" aria-label="QR code">
        <rect width="${m}" height="${m}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
