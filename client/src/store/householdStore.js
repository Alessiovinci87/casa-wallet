import { create } from "zustand";
import api from "../lib/api.js";

export const useHouseholdStore = create((set) => ({
  household: null, // { id, name, inviteCode, createdAt, members: [...] }
  loading: false,

  fetchHousehold: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/household");
      set({ household: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  rename: async (name) => {
    const { data } = await api.put("/api/household", { name });
    set((s) => ({ household: s.household ? { ...s.household, name: data.name } : s.household }));
    return data;
  },

  regenerateInvite: async () => {
    const { data } = await api.post("/api/household/regenerate-invite");
    set((s) => ({
      household: s.household ? { ...s.household, inviteCode: data.inviteCode } : s.household,
    }));
    return data.inviteCode;
  },
}));
