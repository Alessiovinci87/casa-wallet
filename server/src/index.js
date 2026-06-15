// CasaWallet API server
// Express + WebSocket (real-time sync between the two users)

import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { WebSocketServer } from "ws";

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

// TODO: mount routes here
// app.use("/api/auth", authRouter);
// app.use("/api/transactions", transactionsRouter);
// app.use("/api/alerts", alertsRouter);
// app.use("/api/ocr", ocrRouter);

// --- HTTP + WebSocket server ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[ws] client connected, total:", wss.clients.size);

  ws.on("message", (raw) => {
    // Relay messages to every other connected client for real-time sync.
    let payload = raw.toString();
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  });

  ws.on("close", () => {
    console.log("[ws] client disconnected, total:", wss.clients.size);
  });
});

/**
 * Broadcast an event to all connected clients (e.g. after a transaction
 * is created/updated) so both users stay in sync in real time.
 * @param {string} type
 * @param {unknown} data
 */
export function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

server.listen(PORT, () => {
  console.log(`[http] CasaWallet server listening on http://localhost:${PORT}`);
  console.log(`[ws]   WebSocket endpoint at ws://localhost:${PORT}/ws`);
});
