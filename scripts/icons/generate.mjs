#!/usr/bin/env node
// Icone dell'app da client/public/favicon.svg (portafoglio bianco su verde):
//   web/PWA  → client/public/icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png
//   Android  → client/android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png
// Uso: npm run icons   (usa Playwright/chromium come la guida; env CHROME=<chrome.exe> se serve)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUB = path.join(ROOT, "client", "public");
const RES = path.join(ROOT, "client", "android", "app", "src", "main", "res");
const svg = fs.readFileSync(path.join(PUB, "favicon.svg"), "utf8");
const GREEN = "#0a6847";

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();

// Renderizza l'SVG in un PNG di lato `size`. `pad` = margine (frazione) attorno al glifo
// su fondo verde pieno (per maskable e foreground Android, dove il sistema ritaglia).
async function png(file, size, { pad = 0, square = false } = {}) {
  const inner = Math.round(size * (1 - 2 * pad));
  const body = square || pad > 0
    ? `<div style="width:${size}px;height:${size}px;background:${GREEN};display:flex;align-items:center;justify-content:center">${svg.replace("<rect width=\"512\" height=\"512\" rx=\"112\" fill=\"#0a6847\"/>", "").replace(/width="512" height="512"/, `width="${inner}" height="${inner}"`)}</div>`
    : svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${body}</body>`);
  await page.screenshot({ path: file, omitBackground: !(square || pad > 0), clip: { x: 0, y: 0, width: size, height: size } });
  console.log("✓", path.relative(ROOT, file));
}

// Web / PWA
await png(path.join(PUB, "icon-192.png"), 192);
await png(path.join(PUB, "icon-512.png"), 512);
await png(path.join(PUB, "icon-512-maskable.png"), 512, { pad: 0.1 });
await png(path.join(PUB, "apple-touch-icon.png"), 180, { square: true });

// Android (Capacitor): launcher legacy + round + foreground per l'adaptive icon
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = path.join(RES, `mipmap-${d}`);
  if (!fs.existsSync(dir)) continue;
  await png(path.join(dir, "ic_launcher.png"), Math.round(48 * k));
  await png(path.join(dir, "ic_launcher_round.png"), Math.round(48 * k));
  await png(path.join(dir, "ic_launcher_foreground.png"), Math.round(108 * k), { pad: 0.22 });
}
// Sfondo dell'adaptive icon: stesso verde.
const bg = path.join(RES, "values", "ic_launcher_background.xml");
if (fs.existsSync(bg)) {
  fs.writeFileSync(bg, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GREEN}</color>\n</resources>\n`);
  console.log("✓ values/ic_launcher_background.xml →", GREEN);
}
await browser.close();
