#!/usr/bin/env node
// Guida utente Awareness — pipeline ripetibile: seed demo → screenshot → PDF.
//
//   npm run docs:guide                       # locale: DB guide.db, server :3011, client :5183
//   npm run docs:guide -- --skip-seed        # riusa guide.db
//   npm run docs:guide -- --shots-only       # niente PDF
//   npm run docs:guide -- --pdf-only         # niente seed/server/screenshot
//   npm run docs:guide -- --base-url=https://casa-wallet.vercel.app \
//        --api-url=https://casa-wallet-production.up.railway.app \
//        --email=... --password=...          # prod: salta seed/server e le schermate sensibili
//
// Output: docs/guide/img/*.png, docs/Guida_Awareness.pdf, client/public/Guida_Awareness.pdf
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { marked } from "marked";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = path.join(ROOT, "docs", "guide");
const IMG = path.join(DOCS, "img");
const FIX = path.join(DOCS, "fixtures");
const PDF = path.join(ROOT, "docs", "Guida_Awareness.pdf");
fs.mkdirSync(IMG, { recursive: true });

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const PROD = Boolean(args["base-url"]);
const BASE = args["base-url"] || "http://localhost:5183";
const API = args["api-url"] || (PROD ? BASE : "http://localhost:3011");
const EMAIL = args.email || process.env.GUIDE_EMAIL || "anna@demo.local";
const PASSWORD = args.password || process.env.GUIDE_PASSWORD || "demo1234";
const VIEWPORT = { width: 390, height: 844 };

const log = (...a) => console.log("[guide]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === "win32";

// ---------- 1. Seed + server + client (solo in locale) ----------
const children = [];
function run(cmd, cmdArgs, opts) {
  const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], shell: isWin, ...opts });
  child.stdout.on("data", (d) => process.env.GUIDE_VERBOSE && process.stdout.write(d));
  child.stderr.on("data", (d) => process.env.GUIDE_VERBOSE && process.stderr.write(d));
  children.push(child);
  return child;
}
function runSync(cmd, cmdArgs, opts) {
  return new Promise((res, rej) => {
    const c = run(cmd, cmdArgs, opts);
    c.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${cmdArgs.join(" ")} → exit ${code}`))));
  });
}
async function waitFor(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ }
    await sleep(700);
  }
  throw new Error(`timeout aspettando ${url}`);
}
function killAll() {
  for (const c of children) {
    try { isWin ? spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" }) : c.kill("SIGTERM"); } catch { /* già chiuso */ }
  }
}
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(1); });

async function startLocal() {
  const server = path.join(ROOT, "server");
  const client = path.join(ROOT, "client");
  const env = { ...process.env, DATABASE_URL: "file:./guide.db" };
  if (!args["skip-seed"]) {
    log("DB demo: prisma db push + seed-demo (guide.db)");
    try { fs.rmSync(path.join(server, "prisma", "guide.db")); } catch { /* assente */ }
    await runSync("npx", ["prisma", "db", "push", "--skip-generate"], { cwd: server, env });
    await runSync("node", ["prisma/seed-demo.js"], { cwd: server, env });
  }
  log("avvio server :3011 e client :5183");
  run("node", ["src/index.js"], { cwd: server, env: { ...env, PORT: "3011", CLIENT_URL: BASE, RESEND_API_KEY: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", OPENAI_API_KEY: "" } });
  run("npx", ["vite", "--port", "5183", "--strictPort"], { cwd: client, env: { ...process.env, VITE_API_URL: API, VITE_WS_URL: "ws://localhost:3011/ws" } });
  await waitFor(`${API}/api/health`);
  await waitFor(BASE);
}

// ---------- 2. Schermate ----------
// Ogni voce: id (nome file), path, azioni per raggiungere lo stato più espressivo,
// sensitive=true → saltata contro la prod (resta l'immagine precedente).
const shortDate = (d) => d.toISOString().slice(0, 10);
const SCREENS = [
  { id: "punto-zero", path: "/onboarding", sensitive: true },
  { id: "dashboard", path: "/", act: async (p) => { await p.getByText("Disponibile reale").first().click(); await p.waitForTimeout(400); } },
  { id: "notifiche", path: "/" },
  { id: "nuovo-movimento", path: "/", act: async (p) => { await p.getByRole("button", { name: "Nuovo movimento" }).click(); await p.waitForTimeout(300); } },
  { id: "nuova-spesa", path: "/ocr", act: async (p) => {
    await p.route("**/api/ocr/parse", (route) => route.fulfill({ json: OCR_MOCK }));
    await p.locator('input[type="file"]').nth(1).setInputFiles(path.join(FIX, "scontrino.png"));
    await p.getByRole("button", { name: /Analizza/ }).click();
    await p.getByText(/Conferma|Salva/).first().waitFor({ timeout: 10000 });
    await p.waitForTimeout(300);
  } },
  { id: "movimenti-uscite", path: "/movements?tab=expenses" },
  { id: "movimenti-entrate", path: "/movements?tab=income" },
  { id: "ricorrenze", path: "/movements?tab=recurring" },
  { id: "obiettivi", path: "/goals" },
  { id: "obiettivo-nuovo", path: "/goals", act: async (p) => {
    await p.getByRole("button", { name: "+ Nuovo obiettivo" }).click();
    await p.getByPlaceholder("es. Vacanze").fill("Regalo di Natale");
    await p.getByRole("button", { name: "Avanti" }).click();
    await p.locator('input[type="number"]').first().fill("1200");
    await p.getByRole("button", { name: "Avanti" }).click();
    const d = new Date(); d.setMonth(d.getMonth() + 8);
    await p.locator('input[type="date"]').first().fill(shortDate(d));
    await p.waitForTimeout(300);
  } },
  { id: "previsione", path: "/forecast", act: async (p) => { await p.getByText(/Settimana/).first().scrollIntoViewIfNeeded(); await p.mouse.wheel(0, -260); await p.waitForTimeout(300); } },
  { id: "budget", path: "/budgets" },
  { id: "lista-spesa", path: "/shopping-list" },
  { id: "analisi", path: "/analytics", act: async (p) => { await p.getByText("Dove conviene comprare").scrollIntoViewIfNeeded(); await p.mouse.wheel(0, -60); await p.waitForTimeout(300); } },
  { id: "tesoreria", path: "/treasury", sensitive: true, act: async (p) => {
    await p.locator('form input[type="number"][min="1"]').first().fill("800");
    await p.getByRole("button", { name: "Simula" }).click();
    await p.getByText(/Verdetto per/).waitFor({ timeout: 15000 });
    // Schermata alta: verdetto, scenari e "Preleva con piano di rientro" in un colpo solo.
    await p.setViewportSize({ width: VIEWPORT.width, height: 1150 });
    await p.getByText(/Verdetto per/).scrollIntoViewIfNeeded();
    await p.mouse.wheel(0, 200);
    await p.waitForTimeout(300);
  } },
  { id: "fatture", path: "/invoices", sensitive: true },
  { id: "importa-csv", path: "/import", act: async (p) => {
    await p.locator('input[type="file"]').setInputFiles(path.join(FIX, "estratto.csv"));
    await p.getByText(/Colonne/).waitFor({ timeout: 10000 });
    await p.getByText("Applica e salva mapping").scrollIntoViewIfNeeded();
    await p.mouse.wheel(0, -500);
    await p.waitForTimeout(300);
  } },
  { id: "impostazioni", path: "/settings", sensitive: true },
];

const OCR_MOCK = {
  store: "Supermercato Nord", total: 23.47, date: shortDate(new Date()), method: "POS",
  items: [
    { rawName: "LATTE PS 1L x2", canonicalName: "latte", category: "Latticini e uova", quantity: 2, unitPrice: 1.19, totalPrice: 2.38 },
    { rawName: "PANE CASERECCIO", canonicalName: "pane", category: "Pane e cereali", quantity: 1, unitPrice: 2.6, totalPrice: 2.6 },
    { rawName: "BANANE", canonicalName: "banane", category: "Frutta e verdura", quantity: 1, unitPrice: 1.89, totalPrice: 1.89 },
    { rawName: "PETTO POLLO", canonicalName: "petto di pollo", category: "Carne e pesce", quantity: 1, unitPrice: 6.9, totalPrice: 6.9 },
    { rawName: "YOGURT BIANCO x4", canonicalName: "yogurt", category: "Latticini e uova", quantity: 4, unitPrice: 0.55, totalPrice: 2.2 },
    { rawName: "PASTA 500G x3", canonicalName: "pasta", category: "Dispensa", quantity: 3, unitPrice: 1.1, totalPrice: 3.3 },
    { rawName: "DETERSIVO PIATTI", canonicalName: "detersivo piatti", category: "Cura casa", quantity: 1, unitPrice: 2.3, totalPrice: 2.3 },
    { rawName: "ACQUA 6X1.5", canonicalName: "acqua", category: "Bevande", quantity: 1, unitPrice: 1.9, totalPrice: 1.9 },
  ],
  amount: 23.47, type: "EXPENSE", description: "Supermercato Nord",
};

async function ensureFixtures(browser) {
  fs.mkdirSync(FIX, { recursive: true });
  const csv = path.join(FIX, "estratto.csv");
  if (!fs.existsSync(csv)) {
    fs.writeFileSync(csv, "﻿Data;Descrizione;Importo;Valuta\r\n05/06/2026;ADDEBITO SDD RATA AUTO;-289,00;EUR\r\n05/07/2026;ADDEBITO SDD RATA AUTO;-289,00;EUR\r\n14/07/2026;PAGAMENTO POS SUPERMERCATO NORD;-54,30;EUR\r\n27/07/2026;BONIFICO STIPENDIO;2.450,00;EUR\r\n30/07/2026;ADDEBITO INTERNET CASA;-29,90;EUR\r\n02/08/2026;PAGAMENTO POS FARMACIA;-18,50;EUR\r\n");
  }
  const png = path.join(FIX, "scontrino.png");
  if (!fs.existsSync(png)) {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
    await page.setContent(`<body style="margin:0;background:#fff;font:14px 'Courier New',monospace;padding:24px 28px;color:#222">
      <div style="text-align:center;font-weight:bold">SUPERMERCATO NORD<br><span style="font-weight:normal">Via Esempio 12 — P.IVA 00000000000</span></div><hr>
      ${OCR_MOCK.items.map((i) => `<div style="display:flex;justify-content:space-between"><span>${i.rawName}</span><span>${i.totalPrice.toFixed(2)}</span></div>`).join("")}
      <hr><div style="display:flex;justify-content:space-between;font-weight:bold"><span>TOTALE</span><span>${OCR_MOCK.total.toFixed(2)}</span></div>
      <div style="margin-top:12px;text-align:center">PAGAMENTO POS — GRAZIE</div></body>`);
    await page.screenshot({ path: png });
    await page.close();
  }
}

async function takeScreens(browser) {
  const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }).then((r) => r.json());
  if (!login.token) throw new Error("login fallito: " + JSON.stringify(login));
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "it-IT", timezoneId: "Europe/Rome" });
  await ctx.addInitScript(({ token, user }) => { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("onboardingSeen", "1"); }, { token: login.token, user: login.user });
  const captured = [];
  for (const s of SCREENS) {
    if (PROD && s.sensitive) { log(`salto ${s.id} (dati sensibili, modalità prod)`); continue; }
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + s.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      if (s.act) await s.act(page);
      await page.screenshot({ path: path.join(IMG, `${s.id}.png`) });
      captured.push(s.id);
      log(`✓ ${s.id}`);
    } catch (err) {
      log(`✗ ${s.id}: ${err.message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }
  await ctx.close();
  return captured;
}

// ---------- 3. PDF ----------
async function buildPdf(browser) {
  const md = fs.readFileSync(path.join(DOCS, "guide.md"), "utf8");
  const tpl = fs.readFileSync(path.join(DOCS, "template.html"), "utf8");
  let html = marked.parse(md);
  // Ogni "## Capitolo" diventa una sezione a pagina intera; l'immagine va nella colonna destra.
  const parts = html.split(/(?=<h2)/);
  html = parts.map((part, i) => {
    if (i === 0) return `<section class="cover">${part}</section>`;
    const img = part.match(/<p><img[^>]*><\/p>/);
    const body = img ? part.replace(img[0], "") : part;
    const cls = /class="rules"|id="come-funziona/.test(part) || /<h2[^>]*>Come funziona/.test(part) || /<h2[^>]*>La routine/.test(part) ? "chapter wide" : "chapter";
    return `<section class="${cls}"><div class="cols"><div class="text">${body}</div>${img ? `<figure>${img[0].replace(/<\/?p>/g, "")}</figure>` : ""}</div></section>`;
  }).join("\n");
  const out = tpl.replace("{{content}}", html).replace(/\{\{date\}\}/g, new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }));
  const tmp = path.join(DOCS, ".guide.html");
  fs.writeFileSync(tmp, out);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.pdf({ path: PDF, format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" }, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="width:100%;font-size:9px;color:#8B9691;text-align:center;font-family:system-ui">Awareness · Guida utente · pagina <span class="pageNumber"></span> di <span class="totalPages"></span></div>' });
  await page.close();
  if (!args["keep-html"]) fs.rmSync(tmp);
  const pub = path.join(ROOT, "client", "public", "Guida_Awareness.pdf");
  fs.copyFileSync(PDF, pub);
  log(`PDF: ${PDF} (copiato in client/public per la voce "Guida" nelle Impostazioni)`);
}

// ---------- main ----------
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  let captured = [];
  if (!args["pdf-only"]) {
    if (!PROD) await startLocal();
    await ensureFixtures(browser);
    captured = await takeScreens(browser);
  }
  if (!args["shots-only"]) await buildPdf(browser);
  if (captured.length) console.log("\nSchermate catturate:\n" + captured.map((c) => ` - ${c}.png`).join("\n"));
} finally {
  await browser.close();
  killAll();
}
process.exit(0);
