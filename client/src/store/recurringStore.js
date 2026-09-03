import { create } from "zustand";
import api from "../lib/api.js";

// Ricorrenze (regole entrate/uscite ricorrenti) della famiglia.
export const useRecurringStore = create((set, get) => ({
  rules: [],
  monthlyFixedExpense: 0,
  monthlyFixedIncome: 0,
  loaded: false,
  loading: false,

  fetchRules: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/recurring-rules");
      set({
        rules: data.rules,
        monthlyFixedExpense: data.monthlyFixedExpense,
        monthlyFixedIncome: data.monthlyFixedIncome,
        loaded: true,
      });
    } finally {
      set({ loading: false });
    }
  },

  createRule: async (payload) => {
    const { data } = await api.post("/api/recurring-rules", payload);
    await get().fetchRules();
    return data;
  },

  updateRule: async (id, payload) => {
    const { data } = await api.put(`/api/recurring-rules/${id}`, payload);
    await get().fetchRules();
    return data;
  },

  deleteRule: async (id) => {
    await api.delete(`/api/recurring-rules/${id}`);
    await get().fetchRules();
  },

  confirmPending: async (id, payload = {}) => {
    const { data } = await api.post(`/api/recurring-rules/${id}/confirm`, payload);
    await get().fetchRules();
    return data;
  },

  skipPending: async (id) => {
    await api.post(`/api/recurring-rules/${id}/skip`);
    await get().fetchRules();
  },
}));
