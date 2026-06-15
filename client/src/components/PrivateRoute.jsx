import { Navigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";

// Guards protected routes: redirects to /login when there is no token.
export default function PrivateRoute({ children }) {
  const token = useAuthStore((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}
