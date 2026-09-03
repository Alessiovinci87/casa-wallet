import { create } from "zustand";
import api from "../lib/api.js";

// Conti bancari della famiglia (es. Stipendi, Mutuo): saldo per conto e totale.
export const useAccountStore = create((set, get) => ({
  accounts: [], // [{ id, name, number, isDefault, openingBalance, openingBalanceDate, balance }]
  balance: 0,
  loaded: false,
  loading: false,

  fetchAccounts: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get("/api/accounts");
      set({ accounts: data.accounts, balance: data.balance, loaded: true });
      return data;
    } finally {
      set({ loading: false });
    }
  },
  createAccount: async (payload) => {
    const { data } = await api.post("/api/accounts", payload);
    await get().fetchAccounts();
    return data.account;
  },
  updateAccount: async (id, payload) => {
    const { data } = await api.put(`/api/accounts/${id}`, payload);
    await get().fetchAccounts();
    return data.account;
  },
  removeAccount: async (id) => {
    await api.delete(`/api/accounts/${id}`);
    await get().fetchAccounts();
  },
  reorder: async (ids) => {
    const { data } = await api.put("/api/accounts/reorder", { ids });
    set({ accounts: data.accounts, balance: data.balance });
  },
  defaultId: () => get().accounts.find((a) => a.isDefault)?.id ?? get().accounts[0]?.id ?? null,
}));
