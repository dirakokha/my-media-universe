// Generates PNG app icons from the SVG source using sharp (dev dependency).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

await mkdir('public/icons', { recursive: true });
const sizes = [
  ['public/icons/icon.svg', 192, 'public/icons/icon-192.png'],
  ['public/icons/icon.svg', 512, 'public/icons/icon-512.png'],
  ['public/icons/icon-maskable.svg', 512, 'public/icons/icon-maskable-512.png'],
  ['public/icons/icon.svg', 180, 'public/icons/apple-touch-icon.png'],
  ['public/icons/favicon.svg', 32, 'public/icons/favicon-32.png'],
];
for (const [input, size, output] of sizes) {
  await sharp(input, { density: 384 }).resize(size, size).png().toFile(output);
  console.log('wrote', output);
}
