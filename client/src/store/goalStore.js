import { create } from "zustand";
import api from "../lib/api.js";

// Obiettivi di risparmio (condivisi in famiglia + personali dell'utente).
export const useGoalStore = create((set, get) => ({
  goals: [],
  summary: null, // { count, parked, monthQuota, monthContributed, behind }
  loaded: false,
  loading: false,

  fetchGoals: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/goals");
      set({ goals: data.goals, summary: data.summary, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  createGoal: async (payload) => {
    const { data } = await api.post("/api/goals", payload);
    await get().fetchGoals();
    return data;
  },

  updateGoal: async (id, payload) => {
    const { data } = await api.put(`/api/goals/${id}`, payload);
    await get().fetchGoals();
    return data;
  },

  deleteGoal: async (id) => {
    await api.delete(`/api/goals/${id}`);
    await get().fetchGoals();
  },

  contribute: async (id, payload) => {
    const { data } = await api.post(`/api/goals/${id}/contribute`, payload);
    await get().fetchGoals();
    return data;
  },

  // Distribuisci: proposta (nessuna scrittura) e conferma.
  propose: async (payload) => {
    const { data } = await api.post("/api/goals/allocate", payload);
    return data;
  },

  confirmAllocation: async (allocations, extra = {}) => {
    const { data } = await api.post("/api/goals/allocate/confirm", { allocations, ...extra });
    set({ goals: data.goals, summary: data.summary, loaded: true });
    return data;
  },
}));
