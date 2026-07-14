import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";

// Registrazione: "Crea famiglia" (nuova household, utente OWNER) oppure
// "Unisciti" a una famiglia esistente con il codice invito.
export default function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const [mode, setMode] = useState("create"); // "create" | "join"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register({
        name,
        email,
        password,
        ...(mode === "create" ? { householdName } : { inviteCode }),
      });
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Errore di registrazione");
    } finally {
      setLoading(false);
    }
  };

  const tabClass = (active) =>
    `flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
      active ? "bg-brand-600 text-white" : "bg-paper text-ink-600 hover:bg-brand-50"
    }`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper">
      <form onSubmit={handleSubmit} className="card p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-brand-600 mb-1">Awareness</h1>
        <p className="text-sm text-ink-600 mb-6">Crea il tuo account</p>

        <div className="flex gap-2 mb-6">
          <button type="button" className={tabClass(mode === "create")} onClick={() => setMode("create")}>
            Crea famiglia
          </button>
          <button type="button" className={tabClass(mode === "join")} onClick={() => setMode("join")}>
            Unisciti con codice
          </button>
        </div>

        {error && <div className="mb-4 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        <label className="block text-sm text-ink-600 mb-1">Il tuo nome</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-4 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
        />

        <label className="block text-sm text-ink-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full mb-4 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
        />

        <label className="block text-sm text-ink-600 mb-1">Password (min 8 caratteri)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full mb-4 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
        />

        {mode === "create" ? (
          <>
            <label className="block text-sm text-ink-600 mb-1">Nome della famiglia</label>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              required
              placeholder="es. Casa Rossi"
              className="w-full mb-6 px-3 py-2 border border-card-line rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </>
        ) : (
          <>
            <label className="block text-sm text-ink-600 mb-1">Codice invito</label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              placeholder="es. X7K2M9PA"
              maxLength={8}
              className="w-full mb-6 px-3 py-2 border border-card-line rounded font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-600 text-white py-2 rounded hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Registrazione…" : mode === "create" ? "Crea famiglia e inizia" : "Unisciti alla famiglia"}
        </button>

        <p className="mt-4 text-sm text-ink-600 text-center">
          Hai già un account?{" "}
          <Link to="/login" className="text-brand-600 hover:underline">
            Accedi
          </Link>
        </p>
      </form>
    </div>
  );
}
