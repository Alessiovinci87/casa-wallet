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
      active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow-sm w-full max-w-sm">
        <h1 className="text-2xl font-bold text-emerald-600 mb-1">CasaWallet</h1>
        <p className="text-sm text-slate-500 mb-6">Crea il tuo account</p>

        <div className="flex gap-2 mb-6">
          <button type="button" className={tabClass(mode === "create")} onClick={() => setMode("create")}>
            Crea famiglia
          </button>
          <button type="button" className={tabClass(mode === "join")} onClick={() => setMode("join")}>
            Unisciti con codice
          </button>
        </div>

        {error && <div className="mb-4 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        <label className="block text-sm text-slate-600 mb-1">Il tuo nome</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />

        <label className="block text-sm text-slate-600 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />

        <label className="block text-sm text-slate-600 mb-1">Password (min 8 caratteri)</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />

        {mode === "create" ? (
          <>
            <label className="block text-sm text-slate-600 mb-1">Nome della famiglia</label>
            <input
              type="text"
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
              required
              placeholder="es. Casa Rossi"
              className="w-full mb-6 px-3 py-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </>
        ) : (
          <>
            <label className="block text-sm text-slate-600 mb-1">Codice invito</label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              placeholder="es. X7K2M9PA"
              maxLength={8}
              className="w-full mb-6 px-3 py-2 border border-slate-300 rounded font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? "Registrazione…" : mode === "create" ? "Crea famiglia e inizia" : "Unisciti alla famiglia"}
        </button>

        <p className="mt-4 text-sm text-slate-500 text-center">
          Hai già un account?{" "}
          <Link to="/login" className="text-emerald-600 hover:underline">
            Accedi
          </Link>
        </p>
      </form>
    </div>
  );
}
