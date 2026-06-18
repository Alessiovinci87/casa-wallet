import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";

// Guards protected routes. While the session is still being restored from
// localStorage (`hydrated` false) we render nothing instead of redirecting,
// so a page refresh does not bounce an authenticated user to /login.
export default function PrivateRoute({ children }) {
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) return null;
  return token ? children : <Navigate to="/login" replace />;
}
