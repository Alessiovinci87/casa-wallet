import { create } from "zustand";
import api from "../lib/api.js";

export const useTreasuryStore = create((set, get) => ({
  deadlines: [],
  profile: null, // profilo finanziario (o { ok:false, reason })
  simulation: null,
  simulating: false,
  fiscalProfile: null,
  fiscalLoaded: false, // cache: il prefill del form non rifetcha
  suggestedMinPercent: null,
  belowSuggested: false,

  fetchDeadlines: async () => {
    const { data } = await api.get("/api/deadlines");
    set({ deadlines: data });
  },

  saveDeadline: async (payload, id) => {
    if (id) await api.put(`/api/deadlines/${id}`, payload);
    else await api.post("/api/deadlines", payload);
    await get().fetchDeadlines();
  },

  deleteDeadline: async (id) => {
    await api.delete(`/api/deadlines/${id}`);
    await get().fetchDeadlines();
  },

  togglePaid: async (id, paid) => {
    await api.put(`/api/deadlines/${id}`, { paid });
    await get().fetchDeadlines();
  },

  fetchProfile: async (scope = "user") => {
    const { data } = await api.get("/api/treasury/profile", { params: { scope } });
    set({ profile: data });
  },

  simulate: async (amount, scope = "user") => {
    set({ simulating: true });
    try {
      const { data } = await api.post("/api/treasury/simulate", { amount, scope });
      set({ simulation: data, simulating: false });
      return data;
    } catch (err) {
      set({ simulating: false });
      throw err;
    }
  },

  fetchFiscalProfile: async () => {
    if (get().fiscalLoaded) return; // cache per il prefill del TransactionForm
    const { data } = await api.get("/api/treasury/fiscal-profile");
    set({
      fiscalProfile: data.profile,
      suggestedMinPercent: data.suggestedMinPercent,
      belowSuggested: data.belowSuggested,
      fiscalLoaded: true,
    });
  },

  saveFiscalProfile: async (payload) => {
    const { data } = await api.put("/api/treasury/fiscal-profile", payload);
    set({
      fiscalProfile: data.profile,
      suggestedMinPercent: data.suggestedMinPercent,
      belowSuggested: data.belowSuggested,
      fiscalLoaded: true,
    });
    return data;
  },
}));
