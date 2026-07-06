import { create } from "zustand";
import api from "../lib/api.js";

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  // `hydrated` becomes true once we've checked localStorage on boot. Routes
  // must wait for this before deciding whether to redirect to /login, otherwise
  // a page refresh redirects before the saved session is restored.
  hydrated: false,

  // Restore session from localStorage on app boot.
  loadFromStorage: () => {
    try {
      const token = localStorage.getItem("token");
      const userRaw = localStorage.getItem("user");
      if (token && userRaw) {
        set({ token, user: JSON.parse(userRaw), hydrated: true });
        return;
      }
    } catch {
      // Corrupt storage — fall through and start unauthenticated.
    }
    set({ hydrated: true });
  },

  login: async (email, password) => {
    const { data } = await api.post("/api/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ token: data.token, user: data.user, hydrated: true });
    return data.user;
  },

  // Registrazione: crea una nuova famiglia (householdName) oppure si unisce a
  // una esistente (inviteCode). Stessa persistenza sessione del login.
  register: async ({ name, email, password, householdName, inviteCode }) => {
    const { data } = await api.post("/api/auth/register", {
      name,
      email,
      password,
      ...(householdName ? { householdName } : {}),
      ...(inviteCode ? { inviteCode } : {}),
    });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ token: data.token, user: data.user, hydrated: true });
    return data;
  },

  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ token: null, user: null });
  },
}));
