import { create } from "zustand";
import api from "../lib/api.js";

export const useTransactionStore = create((set, get) => ({
  transactions: [],
  loading: false,
  // Remember the last-used filters so a WebSocket-triggered refresh keeps them.
  filters: {},

  fetchTransactions: async (filters) => {
    const active = filters ?? get().filters;
    set({ loading: true, filters: active });
    try {
      // Drop empty filter values before sending.
      const params = Object.fromEntries(
        Object.entries(active).filter(([, v]) => v !== "" && v != null)
      );
      const { data } = await api.get("/api/transactions", { params });
      set({ transactions: data });
    } finally {
      set({ loading: false });
    }
  },

  addTransaction: async (data) => {
    const res = await api.post("/api/transactions", data);
    await get().fetchTransactions();
    return res.data;
  },

  updateTransaction: async (id, data) => {
    const res = await api.put(`/api/transactions/${id}`, data);
    await get().fetchTransactions();
    return res.data;
  },

  deleteTransaction: async (id) => {
    await api.delete(`/api/transactions/${id}`);
    await get().fetchTransactions();
  },
}));
