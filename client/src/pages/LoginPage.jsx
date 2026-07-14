import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Errore di accesso");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={handleSubmit} className="card p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-brand-600 mb-6">Awareness</h1>
        {error && <div className="mb-4 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}
        <label className="block text-sm text-ink-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full mb-4 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <label className="block text-sm text-ink-600 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full mb-6 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 text-white py-2 rounded hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Accesso…" : "Accedi"}
        </button>
        <p className="mt-4 text-sm text-ink-600 text-center">
          Non hai un account?{" "}
          <Link to="/register" className="text-brand-600 hover:underline">
            Registrati
          </Link>
        </p>
      </form>
    </div>
  );
}
