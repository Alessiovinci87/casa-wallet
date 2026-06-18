import { create } from "zustand";
import api from "../lib/api.js";

// Drives the receipt OCR → confirm → save flow.
export const useReceiptStore = create((set) => ({
  parsing: false,
  saving: false,

  // Send one or more images to the OCR endpoint, return the parsed receipt.
  parse: async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append("images", f);
    set({ parsing: true });
    try {
      const { data } = await api.post("/api/ocr/parse", fd);
      return data;
    } finally {
      set({ parsing: false });
    }
  },

  // Save the confirmed receipt + create the linked EXPENSE transaction.
  save: async (payload) => {
    set({ saving: true });
    try {
      const { data } = await api.post("/api/receipts", { ...payload, createTransaction: true });
      return data;
    } finally {
      set({ saving: false });
    }
  },
}));
