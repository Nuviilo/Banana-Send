import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function sampleBananaPixel(nx, ny, shape, transparentBg) {
  // Background check
  let bgAlpha = 255;
  if (!transparentBg) {
    if (shape === 'circle') {
      const dist = Math.hypot(nx, ny);
      if (dist > 1.0) bgAlpha = 0;
      else if (dist > 0.96) bgAlpha = Math.round(((1.0 - dist) / 0.04) * 255);
    } else if (shape === 'rounded') {
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const corner = 0.56;
      const rad = 0.44;
      if (ax > corner && ay > corner) {
        const d = Math.hypot(ax - corner, ay - corner);
        if (d > rad) bgAlpha = 0;
        else if (d > rad - 0.03) bgAlpha = Math.round(((rad - d) / 0.03) * 255);
      }
    }
  } else {
    bgAlpha = 0;
  }

  // Stylized banana crescent + stem + subtle highlight
  const d1 = Math.hypot(nx + 0.16, ny + 0.16);
  const d2 = Math.hypot(nx + 0.44, ny + 0.44);
  const inBanana =
    d1 < 0.78 &&
    d2 > 0.56 &&
    nx > -0.62 &&
    ny > -0.62 &&
    nx + ny < 0.52;

  const inHighlight =
    d1 < 0.70 &&
    d1 > 0.65 &&
    d2 > 0.59 &&
    nx > -0.50 &&
    ny > -0.50 &&
    nx + ny < 0.36;

  // Stem tip
  const dxS = nx - 0.44;
  const dyS = ny + 0.48;
  const inStem = Math.hypot(dxS * 1.1, dyS * 1.1) < 0.095;

  if (inBanana) {
    if (inHighlight) return [254, 240, 138, 255]; // #FEF08A
    return [250, 204, 21, 255]; // #FACC15
  }
  if (inStem) {
    return [202, 138, 4, 255]; // #CA8A04
  }
  if (transparentBg) {
    return [0, 0, 0, 0];
  }
  return [23, 23, 20, bgAlpha]; // #171714
}

function renderPng(size, { shape = 'rounded', padding = 0.08, transparentBg = false } = {}) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const scale = 1 / (1 - 2 * padding);
  // 2x2 supersampling for crisp anti-aliased edges
  const offsets = [0.25, 0.75];

  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const ux = ((x + ox) / size) * 2 - 1;
          const uy = ((y + oy) / size) * 2 - 1;
          const [sr, sg, sb, sa] = sampleBananaPixel(ux * scale, uy * scale, shape, transparentBg);
          r += sr * (sa / 255);
          g += sg * (sa / 255);
          b += sb * (sa / 255);
          a += sa;
        }
      }
      const idx = row + 1 + x * 4;
      const totalA = a / 4;
      if (totalA > 0) {
        raw[idx] = Math.min(255, Math.round((r / 4) * (255 / totalA)));
        raw[idx + 1] = Math.min(255, Math.round((g / 4) * (255 / totalA)));
        raw[idx + 2] = Math.min(255, Math.round((b / 4) * (255 / totalA)));
        raw[idx + 3] = Math.min(255, Math.round(totalA));
      } else {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(pngEntries) {
  // ICONDIR: 6 bytes header + 16 bytes per image
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, buffer } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.buffer)]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 1. Windows Icons (build/)
ensureDir('build');
const icoSizes = [16, 32, 48, 256];
const icoEntries = icoSizes.map((size) => ({
  size,
  buffer: renderPng(size, { shape: 'rounded', padding: 0.08, transparentBg: false }),
}));
fs.writeFileSync('build/icon.ico', buildIco(icoEntries));
fs.writeFileSync(
  'build/icon.png',
  renderPng(512, { shape: 'rounded', padding: 0.08, transparentBg: false })
);

// 2. Refresh PWA icons in public/ with anti-aliased rendering
ensureDir('public');
fs.writeFileSync(
  'public/pwa-192x192.png',
  renderPng(192, { shape: 'rounded', padding: 0.08, transparentBg: false })
);
fs.writeFileSync(
  'public/pwa-512x512.png',
  renderPng(512, { shape: 'rounded', padding: 0.08, transparentBg: false })
);
fs.writeFileSync(
  'public/pwa-maskable-512x512.png',
  renderPng(512, { shape: 'square', padding: 0.16, transparentBg: false })
);
fs.writeFileSync(
  'public/apple-touch-icon.png',
  renderPng(180, { shape: 'square', padding: 0.08, transparentBg: false })
);

// 3. Android Mipmap Launcher Icons (android/app/src/main/res/)
const androidDensities = [
  { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

for (const d of androidDensities) {
  const dir = path.join('android/app/src/main/res', d.folder);
  ensureDir(dir);
  fs.writeFileSync(
    path.join(dir, 'ic_launcher.png'),
    renderPng(d.launcher, { shape: 'rounded', padding: 0.1, transparentBg: false })
  );
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_round.png'),
    renderPng(d.launcher, { shape: 'circle', padding: 0.12, transparentBg: false })
  );
  fs.writeFileSync(
    path.join(dir, 'ic_launcher_foreground.png'),
    renderPng(d.foreground, { shape: 'square', padding: 0.22, transparentBg: true })
  );
}

console.log('Generated Windows (.ico, .png), PWA (.png), and Android mipmap launcher icons.');
