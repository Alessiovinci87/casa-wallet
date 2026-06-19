import { create } from "zustand";
import api from "../lib/api.js";

export const useBudgetStore = create((set, get) => ({
  budgets: [], // [{ id, category, amount, spent, percent, over }]
  loading: false,

  fetchBudgets: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/budgets");
      set({ budgets: data });
    } finally {
      set({ loading: false });
    }
  },

  saveBudget: async (category, amount) => {
    await api.post("/api/budgets", { category, amount });
    await get().fetchBudgets();
  },

  removeBudget: async (id) => {
    await api.delete(`/api/budgets/${id}`);
    await get().fetchBudgets();
  },
}));
