'use strict';

/**
 * Generates the app and tray icons into assets/ with no image dependencies.
 *
 * The mark is a clock face — the app is a post-game timer, and a clock stays
 * legible at 16px where anything more detailed turns to mush. Shapes are drawn
 * at 4x and box-downsampled, which is a cheap way to get antialiased edges.
 *
 * Run with `npm run icons` after changing anything here.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const NAVY = [0x0a, 0x14, 0x28, 255];
const GOLD = [0xc8, 0xaa, 0x6e, 255];
const BLACK = [0, 0, 0, 255];
const SS = 4; // supersampling factor

function createCanvas(size) {
  return { size, pixels: new Float64Array(size * size * 4) };
}

function blend(canvas, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  const alpha = a / 255;
  const px = canvas.pixels;
  px[i] = px[i] * (1 - alpha) + r * alpha;
  px[i + 1] = px[i + 1] * (1 - alpha) + g * alpha;
  px[i + 2] = px[i + 2] * (1 - alpha) + b * alpha;
  px[i + 3] = Math.min(255, px[i + 3] + a * (1 - px[i + 3] / 255));
}

/** Paint every pixel where `inside(x, y)` is true. */
function fill(canvas, color, inside) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      if (inside(x + 0.5, y + 0.5)) blend(canvas, x, y, color);
    }
  }
}

function roundedRect(x0, y0, x1, y1, radius) {
  return (x, y) => {
    const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
}

function ring(cx, cy, outer, inner) {
  return (x, y) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    return d2 <= outer ** 2 && d2 >= inner ** 2;
  };
}

/** Capsule-shaped stroke from (x0,y0) to (x1,y1). */
function segment(x0, y0, x1, y1, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy || 1;
  const half = width / 2;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSq));
    const px = x0 + t * dx;
    const py = y0 + t * dy;
    return (x - px) ** 2 + (y - py) ** 2 <= half * half;
  };
}

function downsample(canvas, factor) {
  const size = canvas.size / factor;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          for (let c = 0; c < 4; c += 1) sums[c] += canvas.pixels[i + c];
        }
      }
      const o = (y * size + x) * 4;
      const samples = factor * factor;
      for (let c = 0; c < 4; c += 1) out[o + c] = Math.round(sums[c] / samples);
    }
  }
  return { size, data: out };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Minimal RGBA8 PNG encoder (filter type 0 on every scanline). */
function encodePng({ size, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {number} size final pixel size
 * @param {object} options
 * @param {boolean} options.background draw the rounded navy plate
 * @param {number[]} options.foreground clock colour
 */
function drawClock(size, { background, foreground }) {
  const s = size * SS;
  const canvas = createCanvas(s);
  const c = s / 2;

  if (background) {
    fill(canvas, NAVY, roundedRect(0, 0, s, s, s * 0.22));
  }

  const outer = s * (background ? 0.34 : 0.44);
  const stroke = s * (background ? 0.05 : 0.08);
  fill(canvas, foreground, ring(c, c, outer, outer - stroke));

  // Hands at roughly 10:10 — the pose clock faces are always photographed in.
  const handWidth = stroke * 0.9;
  fill(canvas, foreground, segment(c, c, c - outer * 0.42, c - outer * 0.42, handWidth));
  fill(canvas, foreground, segment(c, c, c + outer * 0.5, c - outer * 0.36, handWidth));
  fill(canvas, foreground, ring(c, c, handWidth * 0.9, 0));

  return downsample(canvas, SS);
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const outputs = [
  ['icon.png', drawClock(256, { background: true, foreground: GOLD })],
  ['tray.png', drawClock(32, { background: false, foreground: GOLD })],
  // macOS tray icons must be monochrome + alpha and end in "Template".
  ['trayTemplate.png', drawClock(32, { background: false, foreground: BLACK })],
  ['trayTemplate@2x.png', drawClock(64, { background: false, foreground: BLACK })],
];

for (const [name, image] of outputs) {
  const file = path.join(assetsDir, name);
  fs.writeFileSync(file, encodePng(image));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${image.size}x${image.size})`);
}
