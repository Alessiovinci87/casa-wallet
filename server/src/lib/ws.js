// WebSocket server + broadcast helper, kept in its own module so route
// handlers can import broadcast() without creating a cycle with index.js.
//
// Ogni connessione è autenticata via JWT (?token= in query string) e taggata
// con la famiglia: i broadcast raggiungono solo i client della stessa famiglia.

import { WebSocketServer } from "ws";
import jwt from "jsonwebtoken";

let wss = null;

/**
 * Attach a WebSocket server to the given HTTP server.
 * @param {import("node:http").Server} server
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let payload;
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload.householdId) throw new Error("missing householdId");
    } catch {
      ws.close(4401, "Token non valido");
      return;
    }

    ws.householdId = payload.householdId;
    console.log("[ws] client connected, total:", wss.clients.size);

    ws.on("close", () => {
      console.log("[ws] client disconnected, total:", wss.clients.size);
    });
  });

  return wss;
}

/**
 * Broadcast a JSON-serializable message to every connected client of a family.
 * @param {string} householdId
 * @param {unknown} message
 */
export function broadcast(householdId, message) {
  if (!wss) return;
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN && client.householdId === householdId) {
      client.send(data);
    }
  }
}
