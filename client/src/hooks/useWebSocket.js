import { useEffect, useRef } from "react";
import { useTransactionStore } from "../store/transactionStore.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";

// Connects to the server WebSocket and refreshes transactions on update events.
// Auto-reconnects 3s after a disconnect.
export function useWebSocket() {
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let closed = false;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "transaction_update") {
            fetchTransactions();
          }
        } catch {
          // ignore non-JSON frames
        }
      };

      ws.onclose = () => {
        if (!closed) {
          retryRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [fetchTransactions]);
}
