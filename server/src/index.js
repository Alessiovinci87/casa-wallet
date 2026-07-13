// CasaWallet API server
// Express + WebSocket (real-time sync between the two users)

import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

import { initWebSocket } from "./lib/ws.js";
import { startCronJobs } from "./jobs/cron.js";
import authRouter from "./routes/auth.js";
import householdRouter from "./routes/household.js";
import transactionsRouter from "./routes/transactions.js";
import taxSavingsRouter from "./routes/taxSavings.js";
import ocrRouter from "./routes/ocr.js";
import receiptsRouter from "./routes/receipts.js";
import analyticsRouter from "./routes/analytics.js";
import shoppingListRouter from "./routes/shoppingList.js";
import recurringRouter from "./routes/recurring.js";
import budgetsRouter from "./routes/budgets.js";
import pushRouter from "./routes/push.js";
import deadlinesRouter from "./routes/deadlines.js";
import treasuryRouter from "./routes/treasury.js";
import invoicesRouter from "./routes/invoices.js";

dotenv.config();

// Fail-fast: senza JWT_SECRET ogni login/verifica fallirebbe con errori fuorvianti.
if (!process.env.JWT_SECRET) {
  console.error("[fatal] JWT_SECRET non configurata — il server non può partire.");
  process.exit(1);
}
if (!process.env.INVOICE_CRED_SECRET) {
  console.warn("[warn] INVOICE_CRED_SECRET assente: il connettore Aruba risponderà con errore.");
}

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const app = express();

// Dietro il proxy di Railway: serve per far leggere al rate limiter il vero IP
// client da X-Forwarded-For (altrimenti tutti condividono l'IP del proxy).
app.set("trust proxy", 1);

// Allow the configured client URL, any Vercel preview deploy (*.vercel.app),
// the Capacitor webview (https://localhost on Android, capacitor://localhost on iOS)
// and non-browser requests (no Origin header, e.g. curl/health checks).
const CAPACITOR_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (origin === CLIENT_URL) return cb(null, true);
  if (CAPACITOR_ORIGINS.has(origin)) return cb(null, true);
  try {
    // Solo i deploy Vercel di QUESTO progetto (prod + preview), non chiunque su vercel.app.
    const host = new URL(origin).hostname;
    if (host.endsWith(".vercel.app") && host.startsWith("casa-wallet")) return cb(null, true);
  } catch {
    // malformed origin → fall through to rejection
  }
  return cb(new Error(`Origin non consentita da CORS: ${origin}`));
}

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

// Anti brute-force su login/register: 20 tentativi per IP ogni 15 minuti.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Troppi tentativi, riprova tra qualche minuto" },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// --- Health check ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "casawallet-server", ts: new Date().toISOString() });
});

// --- Routes ---
app.use("/api/auth", authRouter);
app.use("/api/household", householdRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/tax-savings", taxSavingsRouter);
app.use("/api/ocr", ocrRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/shopping-list", shoppingListRouter);
app.use("/api/recurring", recurringRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/push", pushRouter);
app.use("/api/deadlines", deadlinesRouter);
app.use("/api/treasury", treasuryRouter);
app.use("/api/invoices", invoicesRouter);

// --- Error handler globale: mai HTML, sempre JSON coerente con il resto dell'API ---
// (Express 5 inoltra qui anche i reject delle route async.)
app.use((err, _req, res, _next) => {
  if (String(err?.message || "").startsWith("Origin non consentita")) {
    return res.status(403).json({ error: err.message });
  }
  console.error("[error]", err);
  res.status(500).json({ error: "Errore interno del server" });
});

// --- HTTP + WebSocket server ---
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`[http] CasaWallet server listening on http://localhost:${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
  startCronJobs();
});
