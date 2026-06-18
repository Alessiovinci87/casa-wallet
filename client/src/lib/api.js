import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001",
});

// Attach the bearer token (if any) to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear the session and bounce to /login.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    // Only force a logout when an *authenticated* request is rejected (a token
    // was sent). Anonymous 401s — e.g. a failed login, or anything during the
    // boot/hydration phase before a token exists — must not wipe and redirect.
    const hadToken = !!localStorage.getItem("token");
    if (error.response?.status === 401 && hadToken) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
