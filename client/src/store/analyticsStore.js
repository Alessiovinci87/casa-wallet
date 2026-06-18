import { create } from "zustand";
import api from "../lib/api.js";

// Spending analytics over receipts. `range` is { from, to } ISO strings (or {}).
export const useAnalyticsStore = create((set, get) => ({
  byCategory: [],
  byStore: [],
  topProducts: [],
  trend: null, // { canonicalName, rows: [...] }
  loading: false,
  range: {},

  fetchAll: async (range) => {
    const active = range ?? get().range;
    const params = Object.fromEntries(
      Object.entries(active).filter(([, v]) => v)
    );
    set({ loading: true, range: active });
    try {
      const [byCategory, byStore, topProducts] = await Promise.all([
        api.get("/api/analytics/by-category", { params }),
        api.get("/api/analytics/by-store", { params }),
        api.get("/api/analytics/top-products", { params: { ...params, limit: 30 } }),
      ]);
      set({
        byCategory: byCategory.data,
        byStore: byStore.data,
        topProducts: topProducts.data,
      });
    } finally {
      set({ loading: false });
    }
  },

  fetchTrend: async (canonicalName) => {
    const params = { canonicalName, ...Object.fromEntries(Object.entries(get().range).filter(([, v]) => v)) };
    const { data } = await api.get("/api/analytics/product-trend", { params });
    set({ trend: { canonicalName, rows: data } });
  },

  clearTrend: () => set({ trend: null }),
}));
