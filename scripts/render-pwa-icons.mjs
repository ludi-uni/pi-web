// Rasterize the PWA SVG icons to PNG using the Playwright-bundled Chromium
// already installed for e2e tests — no new repo dependencies.
//
// Usage (from repo root):
//   node scripts/render-pwa-icons.mjs
//
// Regenerates:
//   internal/ui/embedded/assets/icon-192.png          (192×192, from icon.svg)
//   internal/ui/embedded/assets/icon-512.png          (512×512, from icon.svg)
//   internal/ui/embedded/assets/icon-maskable-512.png (512×512, from icon-maskable.svg)
//   internal/ui/embedded/assets/apple-touch-icon.png  (180×180, from icon.svg — iOS
//     requires opaque PNG; icon.svg already has an opaque rounded-rect background)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../e2e/node_modules/playwright/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'internal', 'ui', 'embedded', 'assets');

const jobs = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  { src: 'icon.svg', out: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { src, out, size } of jobs) {
    const svg = readFileSync(join(assets, src), 'utf8');
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0;padding:0">` +
        `<div style="width:${size}px;height:${size}px">${svg}</div>` +
        `</body></html>`,
    );
    // Force the SVG to fill the box exactly (it has viewBox 0 0 800 800).
    await page.addStyleTag({
      content: `svg{width:${size}px!important;height:${size}px!important;display:block}`,
    });
    const el = page.locator('svg');
    const buf = await el.screenshot({ type: 'png', omitBackground: false });
    writeFileSync(join(assets, out), buf);
    console.log(`${out} ${size}x${size} (${buf.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
