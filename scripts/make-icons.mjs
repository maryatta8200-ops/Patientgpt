/**
 * Icon generator — draws the Pulse mark once and rasterises every PWA size.
 *   node scripts/make-icons.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

/** @param {{padding:number, rounded:boolean, size:number}} opts */
function svgMark({ padding, rounded, size }) {
  const inset = size * padding;
  const inner = size - inset * 2;
  const radius = rounded ? inner * 0.26 : 0;
  const stroke = inner * 0.086;
  const cx = size / 2;
  const cy = size / 2;
  const w = inner * 0.62;
  const h = inner * 0.34;

  const path = `
    M ${cx - w / 2} ${cy}
    h ${w * 0.17}
    l ${w * 0.1} ${-h * 0.72}
    l ${w * 0.16} ${h * 1.52}
    l ${w * 0.12} ${-h * 0.8}
    l ${w * 0.09} ${h * 0.36}
    h ${w * 0.2}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3af0d1"/>
      <stop offset="0.55" stop-color="#35d0ff"/>
      <stop offset="1" stop-color="#8b7bff"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${inner}" height="${inner}" rx="${radius}" fill="url(#bg)"/>
  <rect x="${inset}" y="${inset}" width="${inner}" height="${inner * 0.55}" rx="${radius}" fill="url(#sheen)" opacity="0.55"/>
  <path d="${path}" fill="none" stroke="#04140f" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
</svg>`;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Standard + maskable PNGs
  const jobs = [
    { file: 'icon-192.png', size: 192, padding: 0.06, rounded: true },
    { file: 'icon-512.png', size: 512, padding: 0.06, rounded: true },
    // Maskable needs a 20% safe zone: full-bleed background, mark pulled in.
    { file: 'maskable-192.png', size: 192, padding: 0.11, rounded: false },
    { file: 'maskable-512.png', size: 512, padding: 0.11, rounded: false },
    { file: 'apple-touch-icon.png', size: 180, padding: 0.04, rounded: false },
    { file: 'favicon-32.png', size: 32, padding: 0.03, rounded: true },
  ];

  for (const job of jobs) {
    const svg = svgMark(job);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(outDir, job.file));
    console.log('✔', job.file);
  }

  // Favicon SVG (scales everywhere)
  await writeFile(join(outDir, 'favicon.svg'), svgMark({ size: 512, padding: 0.06, rounded: true }));
  await writeFile(join(outDir, 'icon.svg'), svgMark({ size: 512, padding: 0.06, rounded: true }));
  console.log('✔ favicon.svg + icon.svg');

  // Open Graph card
  const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3af0d1"/><stop offset="0.55" stop-color="#35d0ff"/><stop offset="1" stop-color="#8b7bff"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.8">
      <stop offset="0" stop-color="#2ee6c5" stop-opacity="0.22"/><stop offset="1" stop-color="#2ee6c5" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#05070a"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <g transform="translate(96,150)">
    <rect width="112" height="112" rx="30" fill="url(#g)"/>
    <g transform="translate(56,56)" fill="none" stroke="#04140f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-34 0h11l7-21 12 44 8-27 6 12h13"/>
    </g>
  </g>
  <text x="240" y="230" font-family="Helvetica Neue, Arial, sans-serif" font-size="74" font-weight="700" fill="#eaf2f5" letter-spacing="-2">Pulse</text>
  <text x="96" y="392" font-family="Helvetica Neue, Arial, sans-serif" font-size="52" font-weight="600" fill="#b9c7d1" letter-spacing="-1">Private questions, answered.</text>
  <text x="96" y="452" font-family="Helvetica Neue, Arial, sans-serif" font-size="30" fill="#8a9aa8">Local-first · Burn-after-read relay · Nothing to steal</text>
  <rect x="96" y="516" width="264" height="6" rx="3" fill="url(#g)"/>
</svg>`;
  await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(join(outDir, 'og.png'));
  console.log('✔ og.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
