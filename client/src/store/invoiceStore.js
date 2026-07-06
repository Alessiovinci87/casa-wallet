import { create } from "zustand";
import api from "../lib/api.js";

export const useInvoiceStore = create((set, get) => ({
  invoices: [],
  loading: false,
  filters: { status: "", year: new Date().getFullYear() },
  importing: false,
  importResult: null, // { imported, skipped, errors, warning? }
  aruba: null, // { connected, username?, lastSyncAt? }
  syncing: false,
  syncResult: null,

  setFilters: (patch) => {
    set((s) => ({ filters: { ...s.filters, ...patch } }));
    get().fetchInvoices();
  },

  fetchInvoices: async () => {
    set({ loading: true });
    try {
      const { status, year } = get().filters;
      const params = {};
      if (status) params.status = status;
      if (year) params.year = year;
      const { data } = await api.get("/api/invoices", { params });
      set({ invoices: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  importXml: async (files) => {
    set({ importing: true, importResult: null });
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const { data } = await api.post("/api/invoices/import-xml", fd);
      set({ importing: false, importResult: data });
      await get().fetchInvoices();
      return data;
    } catch (err) {
      set({ importing: false });
      throw err;
    }
  },

  collect: async (id, payload) => {
    await api.put(`/api/invoices/${id}/collect`, payload);
    await get().fetchInvoices();
  },

  uncollect: async (id) => {
    await api.put(`/api/invoices/${id}/uncollect`);
    await get().fetchInvoices();
  },

  remove: async (id) => {
    await api.delete(`/api/invoices/${id}`);
    await get().fetchInvoices();
  },

  fetchAruba: async () => {
    const { data } = await api.get("/api/invoices/aruba");
    set({ aruba: data });
  },

  connectAruba: async (username, password) => {
    const { data } = await api.post("/api/invoices/aruba/connect", { username, password });
    set({ aruba: { connected: true, username: data.username, lastSyncAt: null } });
  },

  disconnectAruba: async () => {
    await api.delete("/api/invoices/aruba/connect");
    set({ aruba: { connected: false }, syncResult: null });
  },

  syncAruba: async () => {
    set({ syncing: true, syncResult: null });
    try {
      const { data } = await api.post("/api/invoices/aruba/sync");
      set({ syncing: false, syncResult: data });
      await Promise.all([get().fetchInvoices(), get().fetchAruba()]);
      return data;
    } catch (err) {
      set({ syncing: false });
      throw err;
    }
  },
}));
