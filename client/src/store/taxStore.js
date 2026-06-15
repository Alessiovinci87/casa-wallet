import { create } from "zustand";
import api from "../lib/api.js";

export const useTaxStore = create((set, get) => ({
  summary: null, // { totalPending, byMonth: [...] }
  items: [],

  fetchSummary: async () => {
    const [summaryRes, listRes] = await Promise.all([
      api.get("/api/tax-savings/summary"),
      api.get("/api/tax-savings"),
    ]);
    set({ summary: summaryRes.data, items: listRes.data.items });
  },

  markTransferred: async (id) => {
    await api.put(`/api/tax-savings/${id}/transfer`);
    await get().fetchSummary();
  },
}));
