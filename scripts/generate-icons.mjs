#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

if (!existsSync(PUBLIC)) mkdirSync(PUBLIC, { recursive: true });

/** @type {Array<{src: string, out: string, width: number}>} */
const TARGETS = [
  // Browser tab favicons (rasterized fallbacks)
  { src: 'favicon.svg', out: 'favicon-16.png', width: 16 },
  { src: 'favicon.svg', out: 'favicon-32.png', width: 32 },
  { src: 'favicon.svg', out: 'favicon-48.png', width: 48 },
  // Apple touch icon (iOS home screen)
  { src: 'favicon.svg', out: 'apple-touch-icon.png', width: 180 },
  // Android / PWA
  { src: 'favicon.svg', out: 'android-chrome-192.png', width: 192 },
  { src: 'favicon.svg', out: 'android-chrome-512.png', width: 512 },
  // Open Graph card (1200x630)
  { src: 'og-image.svg', out: 'og-image.png', width: 1200 },
];

let ok = 0;
let fail = 0;

for (const target of TARGETS) {
  const srcPath = join(PUBLIC, target.src);
  const outPath = join(PUBLIC, target.out);
  if (!existsSync(srcPath)) {
    console.error(`  ✗ ${target.out} — source missing: ${target.src}`);
    fail++;
    continue;
  }
  const svg = readFileSync(srcPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: target.width },
    background: 'rgba(0, 0, 0, 0)',
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
    },
  });
  const pngData = resvg.render().asPng();
  writeFileSync(outPath, pngData);
  const sizeKB = (pngData.length / 1024).toFixed(1);
  console.log(`  ✓ ${target.out.padEnd(28)} ${target.width}px · ${sizeKB} KB`);
  ok++;
}

console.log(`\n${ok} generated · ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
