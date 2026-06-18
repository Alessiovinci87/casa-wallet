import { create } from "zustand";
import api from "../lib/api.js";

// Predictive shopping list + recurring products.
export const useShoppingListStore = create((set, get) => ({
  list: [],
  recurring: [],
  loading: false,

  fetchList: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/shopping-list");
      set({ list: data });
    } finally {
      set({ loading: false });
    }
  },

  fetchRecurring: async () => {
    const { data } = await api.get("/api/recurring");
    set({ recurring: data });
  },

  dismiss: async (canonicalName) => {
    await api.post("/api/shopping-list/dismiss", { canonicalName });
    await get().fetchList();
  },

  setRecurring: async ({ canonicalName, alwaysBuy, intervalDays }) => {
    await api.post("/api/recurring", { canonicalName, alwaysBuy, intervalDays });
    await Promise.all([get().fetchRecurring(), get().fetchList()]);
  },

  removeRecurring: async (canonicalName) => {
    await api.delete(`/api/recurring/${encodeURIComponent(canonicalName)}`);
    await Promise.all([get().fetchRecurring(), get().fetchList()]);
  },
}));
