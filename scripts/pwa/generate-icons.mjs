import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = new URL('../../public/pwa/', import.meta.url);
await mkdir(directory, { recursive: true });
const glyph = '<path d="M224 256h40V184h40M264 256v72h40" fill="none" stroke="#94BDF5" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><rect x="144" y="216" width="80" height="80" rx="22" fill="#94BDF5"/><rect x="304" y="144" width="64" height="80" rx="20" fill="#D1DFF2"/><rect x="304" y="288" width="64" height="80" rx="20" fill="#D1DFF2"/><path d="M166 245h36M166 260h24M324 169h24M324 184h15M324 313h24M324 328h15" stroke="#17171C" stroke-width="8" stroke-linecap="round"/>';
const svg = maskable => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${maskable ? 0 : 108}" fill="#17171C"/>${glyph}</svg>`;
await writeFile(new URL('icon.svg', directory), svg(false));
await writeFile(new URL('maskable.svg', directory), svg(true));
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await writeFile(new URL(name, directory), new Resvg(svg(maskable), { fitTo: { mode: 'width', value: size } }).render().asPng());
}
