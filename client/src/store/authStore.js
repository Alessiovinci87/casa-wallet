import { create } from "zustand";
import api from "../lib/api.js";

export const useAuthStore = create((set) => ({
  user: null,
  token: null,

  // Restore session from localStorage on app boot.
  loadFromStorage: () => {
    const token = localStorage.getItem("token");
    const userRaw = localStorage.getItem("user");
    if (token && userRaw) {
      set({ token, user: JSON.parse(userRaw) });
    }
  },

  login: async (email, password) => {
    const { data } = await api.post("/api/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ token: data.token, user: data.user });
    return data.user;
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ token: null, user: null });
  },
}));
