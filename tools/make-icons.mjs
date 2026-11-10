// Draws the app icon (a navy-to-violet rounded square with a hexagon) and writes
// icons/icon.svg, icon-192.png, icon-512.png and icon-maskable-512.png.
// Plain Node, nothing to install. Run: node tools/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
const NAVY = [15, 26, 61];
const VIOLET = [123, 92, 245];
const hex = rgb => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;

// Pointy-top hexagon corners.
const hexagon = (cx, cy, radius) => Array.from({ length: 6 }, (_, k) => {
  const angle = ((-90 + 60 * k) * Math.PI) / 180;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
});

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// The shapes, in units of the icon's size. Maskable icons fill the square and shrink the
// hexagon so it stays inside the safe zone when a phone crops the icon to a circle.
function shapes(size, maskable) {
  const scale = maskable ? 0.8 : 1;
  return {
    corner: maskable ? 0 : 0.22 * size,
    outer: hexagon(size / 2, size / 2, 0.26 * size * scale),
    inner: hexagon(size / 2, size / 2, 0.1 * size * scale),
    stroke: 0.052 * size * scale,
  };
}

function colorAt(x, y, size, shape) {
  const { corner, outer, inner, stroke } = shape;
  if (corner) {
    const dx = Math.max(corner - x, x - (size - corner), 0);
    const dy = Math.max(corner - y, y - (size - corner), 0);
    if (dx * dx + dy * dy > corner * corner) return [0, 0, 0, 0];
  }
  let nearest = Infinity;
  for (let i = 0; i < 6; i += 1) nearest = Math.min(nearest, distanceToSegment(x, y, outer[i], outer[(i + 1) % 6]));
  if (nearest <= stroke / 2 || insidePolygon(x, y, inner)) return [255, 255, 255, 255];
  const t = (x + y) / (2 * size);
  return [...NAVY.map((n, i) => n + (VIOLET[i] - n) * t), 255];
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size, maskable) {
  const shape = shapes(size, maskable);
  const SUB = 4; // 4 x 4 samples per pixel for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUB; sy += 1) {
        for (let sx = 0; sx < SUB; sx += 1) {
          const [cr, cg, cb, ca] = colorAt(x + (sx + 0.5) / SUB, y + (sy + 0.5) / SUB, size, shape);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const at = row + 1 + x * 4;
      raw[at] = a ? Math.round(r / a) : 0;
      raw[at + 1] = a ? Math.round(g / a) : 0;
      raw[at + 2] = a ? Math.round(b / a) : 0;
      raw[at + 3] = Math.round(a / (SUB * SUB));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg(size) {
  const { corner, outer, inner, stroke } = shapes(size, false);
  const points = list => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hex(NAVY)}"/><stop offset="1" stop-color="${hex(VIOLET)}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${corner.toFixed(1)}" fill="url(#g)"/>
  <polygon points="${points(outer)}" fill="none" stroke="#fff" stroke-width="${stroke.toFixed(1)}" stroke-linejoin="round"/>
  <polygon points="${points(inner)}" fill="#fff"/>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}icon.svg`, svg(512));
writeFileSync(`${OUT}icon-192.png`, png(192, false));
writeFileSync(`${OUT}icon-512.png`, png(512, false));
writeFileSync(`${OUT}icon-maskable-512.png`, png(512, true));
console.log('Wrote icons/icon.svg, icon-192.png, icon-512.png and icon-maskable-512.png');
