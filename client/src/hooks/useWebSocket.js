import { useEffect, useRef } from "react";
import { useTransactionStore } from "../store/transactionStore.js";
import { useShoppingListStore } from "../store/shoppingListStore.js";
import { useAnalyticsStore } from "../store/analyticsStore.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";

// Connects to the server WebSocket and refreshes the relevant views on update
// events. Auto-reconnects 3s after a disconnect. Stores are read via getState()
// so the effect never re-subscribes on store changes.
export function useWebSocket() {
  const wsRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let closed = false;

    const refreshTransactions = () => useTransactionStore.getState().fetchTransactions();
    const refreshReceiptViews = () => {
      // A receipt may have created a transaction; also refresh the views that
      // depend on receipts — but only if the user has already loaded them.
      useTransactionStore.getState().fetchTransactions();
      const sl = useShoppingListStore.getState();
      if (sl.list.length || sl.recurring.length) sl.fetchList();
      const an = useAnalyticsStore.getState();
      if (an.byCategory.length || an.byStore.length || an.topProducts.length) an.fetchAll();
    };

    const connect = () => {
      // Il server autentica la connessione e scopa i broadcast per famiglia.
      const token = localStorage.getItem("token");
      if (!token) return;
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === "transaction_update") refreshTransactions();
          else if (msg.event === "receipt_update") refreshReceiptViews();
          else if (msg.event === "shopping_list_update") useShoppingListStore.getState().fetchList();
        } catch {
          // ignore non-JSON frames
        }
      };

      ws.onclose = (e) => {
        // 4401 = token rifiutato dal server: inutile ritentare, al prossimo 401
        // HTTP l'interceptor axios farà comunque il redirect al login.
        if (!closed && e.code !== 4401) retryRef.current = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);
}
