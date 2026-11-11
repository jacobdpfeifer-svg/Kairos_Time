/**
 * Kairos mark: a Gabarito lowercase k with one horizontal highlighter swipe.
 * The vectors live in design-system/kairos/logo/ and are copied to the landing
 * page and the extension. This file rasterizes the same geometry for the
 * extension icons, the Mac app icon, and the menu-bar template.
 *
 *   node app/extension-chrome/tools/kairos-icons.mjs          # write every asset
 *   node app/extension-chrome/tools/kairos-icons.mjs --check  # exit 1 if a PNG is stale
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const INK = [0x1d, 0x1d, 0x1f];
export const NIGHT = [0xf1, 0xf1, 0xed];
export const HL = [0xff, 0xe1, 0x4d];
export const PAPER = [0xfb, 0xfb, 0xfa];
export const SIZES = [16, 32, 48, 128];

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
export const ICON_DIR = path.resolve(here, "..", "icons");
const LOGO_DIR = path.join(root, "design-system", "kairos", "logo");
const TAURI_DIR = path.join(root, "app", "src-tauri", "icons");

// Approved mark, in the 1024 icon square. The k is the first letter of the
// Gabarito ExtraBold wordmark, placed with the highlighter across its middle.
const TX = 287.667;
const TY = 772;
const TS = 0.763583;
const K_FONT = [
  [
    [157.9014892578125, 246],
    [157.9014892578125, 266.12353515625],
    [354.5926513671875, 489.5308837890625],
    [533.8280029296875, 489.5308837890625],
    [318.02581787109375, 242.308837890625],
    [315.914794921875, 283.04925537109375],
    [539.6552124023438, 0],
    [352.29632568359375, 0],
  ],
  [
    [47.92572021484375, 681],
    [209.4573974609375, 681],
    [209.4573974609375, 0],
    [47.92572021484375, 0],
  ],
];
const SWIPE = "M303.47 504.18 C319.91 487.21 347.43 446.14 387.75 424.07 C428.07 401.99 491.91 372.23 545.39 371.72 C598.88 371.20 675.51 401.57 708.64 420.98 C741.76 440.39 757.61 460.48 744.14 488.19 C730.66 515.90 670.95 564.77 627.79 587.25 C584.63 609.72 534.74 625.49 485.19 623.04 C435.63 620.60 363.13 588.78 330.46 572.59 C297.79 556.39 293.65 537.28 289.16 525.88 C284.66 514.48 287.04 521.14 303.47 504.18 Z";

function toIcon([x, y]) {
  return [TX + TS * x, TY - TS * y];
}
const K = K_FONT.map((ring) => ring.map(toIcon));

function parseSwipe(d) {
  const rings = [];
  let cursor = [0, 0];
  let start = [0, 0];
  const ring = [];
  const pushCurve = (c1, c2, p) => {
    const steps = 12;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      ring.push([
        u * u * u * cursor[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0],
        u * u * u * cursor[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1],
      ]);
    }
    cursor = p;
  };
  const tokens = d.trim().split(/(?=[MCZ])/);
  for (const raw of tokens) {
    const op = raw[0];
    const n = raw.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (op === "M") {
      cursor = [n[0], n[1]];
      start = cursor;
      ring.push(cursor);
    } else if (op === "C") {
      for (let k = 0; k < n.length; k += 6) {
        pushCurve([n[k], n[k + 1]], [n[k + 2], n[k + 3]], [n[k + 4], n[k + 5]]);
      }
    } else if (op === "Z") {
      ring.push(start);
      rings.push(ring.slice());
    }
  }
  return rings;
}
const SWIPE_RINGS = parseSwipe(SWIPE);

function boundsOf(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function winding(x, y, rings) {
  let w = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      if (y0 === y1) continue;
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const xcross = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
        if (x < xcross) w += y1 > y0 ? 1 : -1;
      }
    }
  }
  return w !== 0;
}

function inSquircle(x, y) {
  const dx = Math.abs(x - 512) / 512;
  const dy = Math.abs(y - 512) / 512;
  return dx ** 5 + dy ** 5 <= 1;
}

function sample(svgX, svgY) {
  if (winding(svgX, svgY, K)) return "ink";
  if (winding(svgX, svgY, SWIPE_RINGS)) return "swipe";
  return "paper";
}

/**
 * @param {number} size
 * @param {{ clip?: boolean, plate?: boolean, ink?: number[], swipe?: boolean }} [opts]
 * clip: transparent outside the squircle. plate: paper behind the mark.
 */
const rasterCache = new Map();
export function rasterize(size, opts = {}) {
  const clip = opts.clip !== false;
  const plate = opts.plate !== false;
  const swipe = opts.swipe !== false;
  const ink = opts.ink || INK;
  const key = `${size}|${clip}|${plate}|${swipe}|${ink.join(",")}`;
  const cached = rasterCache.get(key);
  if (cached) return cached;
  const px = Buffer.alloc(size * size * 4);
  const S = size >= 512 ? 2 : 4;
  const n = S * S;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let covered = 0;
      let inkN = 0;
      let swipeN = 0;
      let paperN = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const svgX = ((i + (si + 0.5) / S) / size) * 1024;
          const svgY = ((j + (sj + 0.5) / S) / size) * 1024;
          if (clip && !inSquircle(svgX, svgY)) continue;
          covered++;
          const hit = sample(svgX, svgY);
          if (hit === "ink") inkN++;
          else if (hit === "swipe" && swipe) swipeN++;
          else paperN++;
        }
      }
      const o = (j * size + i) * 4;
      if (!covered) continue;
      const a = covered / n;
      // Ink covers the swipe, the swipe covers the paper. Paper is omitted
      // when the icon has no plate (the menu-bar template, the inline PNG).
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      if (inkN) {
        r += ink[0] * inkN;
        g += ink[1] * inkN;
        b += ink[2] * inkN;
        weight += inkN;
      }
      if (swipeN) {
        r += HL[0] * swipeN;
        g += HL[1] * swipeN;
        b += HL[2] * swipeN;
        weight += swipeN;
      }
      if (plate && paperN) {
        r += PAPER[0] * paperN;
        g += PAPER[1] * paperN;
        b += PAPER[2] * paperN;
        weight += paperN;
      }
      if (!weight) continue;
      px[o] = Math.round(r / weight);
      px[o + 1] = Math.round(g / weight);
      px[o + 2] = Math.round(b / weight);
      px[o + 3] = Math.round(a * 255 * (plate ? 1 : (inkN + swipeN) / covered));
    }
  }
  rasterCache.set(key, px);
  return px;
}

/** The k alone, in black, for the menu-bar template. */
export function rasterizeTray(size) {
  const box = boundsOf(K);
  const pad = 0.16 * Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const contentW = box.maxX - box.minX + pad * 2;
  const contentH = box.maxY - box.minY + pad * 2;
  const span = Math.max(contentW, contentH);
  const originX = box.minX - pad - (span - contentW) / 2;
  const originY = box.minY - pad - (span - contentH) / 2;
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  const n = S * S;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hit = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const svgX = originX + ((i + (si + 0.5) / S) / size) * span;
          const svgY = originY + ((j + (sj + 0.5) / S) / size) * span;
          if (winding(svgX, svgY, K)) hit++;
        }
      }
      if (!hit) continue;
      const o = (j * size + i) * 4;
      px[o + 3] = Math.round((hit / n) * 255);
    }
  }
  return px;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fmt(n) {
  return Math.round(n * 100) / 100;
}
function ringPath(ring) {
  return `M${ring.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;
}
function fitPoint([x, y], map) {
  return [map.ox + (x - map.minX) * map.s, map.oy + (y - map.minY) * map.s];
}
function fitMap(rings, size, padFrac) {
  const b = boundsOf(rings);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const pad = padFrac * Math.max(w, h);
  const innerW = w + pad * 2;
  const innerH = h + pad * 2;
  const s = size / Math.max(innerW, innerH);
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    s,
    ox: (size - innerW * s) / 2,
    oy: (size - innerH * s) / 2,
  };
}

function markSvg(ink) {
  const map = fitMap([...K, ...SWIPE_RINGS], 512, 0.08);
  const swipe = SWIPE_RINGS.map((ring) => ringPath(ring.map((p) => fitPoint(p, map)))).join("");
  const k = K.map((ring) => ringPath(ring.map((p) => fitPoint(p, map)))).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="kairos">
  <title>kairos</title>
  <path fill="#ffe14d" d="${swipe}"/>
  <path fill="${ink}" d="${k}"/>
</svg>
`;
}

function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function same(file, data) {
  return fs.existsSync(file) && fs.readFileSync(file).equals(data);
}

function encodeIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const parts = [header, dir];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const e = i * 16;
    dir[e] = img.size >= 256 ? 0 : img.size;
    dir[e + 1] = img.size >= 256 ? 0 : img.size;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.png.length;
    parts.push(img.png);
  }
  return Buffer.concat(parts);
}

/** Tight transparent mark, for the README and anywhere a plate would disappear on paper. */
function rasterizeLoose(size, ink) {
  const map = fitMap([...K, ...SWIPE_RINGS], size, 0.08);
  const kRings = K.map((ring) => ring.map((p) => fitPoint(p, map)));
  const swipeRings = SWIPE_RINGS.map((ring) => ring.map((p) => fitPoint(p, map)));
  const px = Buffer.alloc(size * size * 4);
  const S = 3;
  const n = S * S;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let inkN = 0;
      let swipeN = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const x = i + (si + 0.5) / S;
          const y = j + (sj + 0.5) / S;
          if (winding(x, y, kRings)) inkN++;
          else if (winding(x, y, swipeRings)) swipeN++;
        }
      }
      const cover = inkN + swipeN;
      if (!cover) continue;
      const o = (j * size + i) * 4;
      const r = ink[0] * inkN + HL[0] * swipeN;
      const g = ink[1] * inkN + HL[1] * swipeN;
      const b = ink[2] * inkN + HL[2] * swipeN;
      px[o] = Math.round(r / cover);
      px[o + 1] = Math.round(g / cover);
      px[o + 2] = Math.round(b / cover);
      px[o + 3] = Math.round((cover / n) * 255);
    }
  }
  return px;
}

function pngAssets() {
  const assets = [];
  for (const size of SIZES) {
    assets.push([
      path.join(ICON_DIR, `kairos-${size}.png`),
      encodePng(size, rasterize(size, { clip: true, plate: true })),
    ]);
  }
  const app = (size) => encodePng(size, rasterize(size, { clip: false, plate: true }));
  assets.push([path.join(TAURI_DIR, "32x32.png"), app(32)]);
  assets.push([path.join(TAURI_DIR, "128x128.png"), app(128)]);
  assets.push([path.join(TAURI_DIR, "128x128@2x.png"), app(256)]);
  assets.push([path.join(TAURI_DIR, "icon.png"), app(1024)]);
  assets.push([path.join(TAURI_DIR, "trayTemplate.png"), encodePng(128, rasterizeTray(128))]);
  assets.push([
    path.join(LOGO_DIR, "kairos-wordmark.png"),
    encodePng(640, rasterizeLoose(640, INK)),
  ]);
  assets.push([
    path.join(LOGO_DIR, "kairos-wordmark-night.png"),
    encodePng(640, rasterizeLoose(640, NIGHT)),
  ]);
  return assets;
}

function writeIconSet() {
  const dir = path.join(TAURI_DIR, "icon.iconset");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const pairs = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of pairs) {
    fs.writeFileSync(
      path.join(dir, name),
      encodePng(size, rasterize(size, { clip: false, plate: true })),
    );
  }
  execFileSync("iconutil", ["-c", "icns", dir, "-o", path.join(TAURI_DIR, "icon.icns")]);
  fs.rmSync(dir, { recursive: true, force: true });
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const ico = encodeIco(
    icoSizes.map((size) => ({
      size,
      png: encodePng(size, rasterize(size, { clip: false, plate: true })),
    })),
  );
  fs.writeFileSync(path.join(TAURI_DIR, "icon.ico"), ico);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const day = markSvg("#1d1d1f");
  const night = markSvg("#f1f1ed");
  const svgCopies = [
    [path.join(LOGO_DIR, "kairos-wordmark.svg"), day],
    [path.join(LOGO_DIR, "kairos-wordmark-night.svg"), night],
    [path.join(root, "landing", "logo", "kairos-wordmark.svg"), day],
    [path.join(root, "landing", "logo", "kairos-wordmark-night.svg"), night],
    [path.join(root, "app", "extension-chrome", "brand", "kairos-wordmark.svg"), day],
    [path.join(root, "app", "extension-chrome", "brand", "kairos-wordmark-night.svg"), night],
  ];
  let stale = false;
  if (check) {
    for (const [file, text] of svgCopies) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) {
        console.error(`stale: ${path.relative(root, file)}`);
        stale = true;
      }
    }
    for (const [file, png] of pngAssets()) {
      if (!same(file, png)) {
        console.error(`stale: ${path.relative(root, file)}`);
        stale = true;
      }
    }
    if (stale) process.exit(1);
  } else {
    for (const [file, text] of svgCopies) writeFile(file, text);
    for (const [file, png] of pngAssets()) writeFile(file, png);
    writeIconSet();
  }
}
