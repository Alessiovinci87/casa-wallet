// CasaWallet API server
// Express + WebSocket (real-time sync between the two users)

import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { initWebSocket } from "./lib/ws.js";
import authRouter from "./routes/auth.js";
import transactionsRouter from "./routes/transactions.js";
import taxSavingsRouter from "./routes/taxSavings.js";
import ocrRouter from "./routes/ocr.js";

dotenv.config();

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const app = express();

app.use(cors({ origin: CLIENT_URL, credentials: true }));
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

// --- HTTP + WebSocket server ---
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`[http] CasaWallet server listening on http://localhost:${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
});
