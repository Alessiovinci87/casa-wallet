// CasaWallet API server
// Express + WebSocket (real-time sync between the two users)

import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { initWebSocket } from "./lib/ws.js";
import { startCronJobs } from "./jobs/cron.js";
import authRouter from "./routes/auth.js";
import transactionsRouter from "./routes/transactions.js";
import taxSavingsRouter from "./routes/taxSavings.js";
import ocrRouter from "./routes/ocr.js";
import receiptsRouter from "./routes/receipts.js";
import analyticsRouter from "./routes/analytics.js";
import shoppingListRouter from "./routes/shoppingList.js";
import recurringRouter from "./routes/recurring.js";
import budgetsRouter from "./routes/budgets.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const app = express();

// Allow the configured client URL, any Vercel preview deploy (*.vercel.app),
// and non-browser requests (no Origin header, e.g. curl/health checks).
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (origin === CLIENT_URL) return cb(null, true);
  try {
    if (new URL(origin).hostname.endsWith(".vercel.app")) return cb(null, true);
  } catch {
    // malformed origin → fall through to rejection
  }
  return cb(new Error(`Origin non consentita da CORS: ${origin}`));
}

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

// --- Health check ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "casawallet-server", ts: new Date().toISOString() });
});

// --- Routes ---
app.use("/api/auth", authRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/tax-savings", taxSavingsRouter);
app.use("/api/ocr", ocrRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/shopping-list", shoppingListRouter);
app.use("/api/recurring", recurringRouter);
app.use("/api/budgets", budgetsRouter);

// --- HTTP + WebSocket server ---
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`[http] CasaWallet server listening on http://localhost:${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
  startCronJobs();
});
