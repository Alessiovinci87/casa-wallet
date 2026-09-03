import { useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "../lib/api.js";
import { useAuthStore } from "../store/authStore.js";

// "Altro": le sezioni secondarie, una lista con tap target da 44px.
const ITEMS = [
  { to: "/treasury", label: "Tesoreria", hint: "Scadenze fiscali, simulatore, prestito interno, profilo fiscale" },
  { to: "/invoices", label: "Fatture", hint: "Import XML, incassi, connettore Aruba" },
  { to: "/analytics", label: "Analisi", hint: "Spese per categoria, negozi, prodotti" },
  { to: "/shopping-list", label: "Lista spesa", hint: "Cosa ricomprare, prevista dagli scontrini" },
  { to: "/budgets", label: "Budget", hint: "Tetto mensile per categoria" },
  { to: "/import", label: "Importa CSV", hint: "Estratto conto della banca" },
  { to: "/settings", label: "Impostazioni", hint: "Famiglia, saldo iniziale, invito" },
];

export default function MorePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [resetting, setResetting] = useState(false);
  const isOwner = user?.role === "OWNER";

  // Ricomincia da capo: azzera i dati economici della famiglia e riapre il Punto zero.
  const restart = async () => {
    const word = window.prompt(
      "Ricominciare da capo? Verranno cancellati movimenti, ricorrenze, obiettivi, fatture, scadenze, budget e saldo iniziale di tutta la famiglia. Restano account e famiglia.\n\nPer confermare scrivi RICOMINCIA:"
    );
    if (word == null) return;
    setResetting(true);
    try {
      await api.post("/api/household/reset", { confirm: word.trim().toUpperCase() });
      try { localStorage.removeItem("onboardingSeen"); } catch { /* storage non disponibile */ }
      navigate("/onboarding");
    } catch (err) {
      window.alert(err.response?.data?.error || "Operazione non riuscita");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card divide-y divide-card-line">
        {ITEMS.map((it) => (
          <button
            key={it.to}
            onClick={() => navigate(it.to)}
            className="w-full text-left px-4 py-3 min-h-[56px] flex items-center justify-between gap-3 hover:bg-paper"
          >
            <span>
              <span className="block font-medium">{it.label}</span>
              <span className="block text-[13px] text-ink-400">{it.hint}</span>
            </span>
            <span className="text-ink-400">›</span>
          </button>
        ))}
      </div>
      {isOwner && (
        <div className="card px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink-600">
            <span className="block font-medium text-ink-900">Ricomincia da capo</span>
            Azzera i conti e riparti dal Punto zero (saldo, ricorrenze, obiettivi).
          </span>
          <button onClick={restart} disabled={resetting} className="shrink-0 text-rose-600 font-medium min-h-[44px] px-2 disabled:opacity-50">
            {resetting ? "…" : "Ricomincia"}
          </button>
        </div>
      )}
      <div className="card px-4 py-3 flex items-center justify-between">
        <span className="text-[13px] text-ink-600 truncate">{user?.name} · {user?.email}</span>
        <button onClick={() => { logout(); navigate("/login"); }} className="text-rose-600 font-medium min-h-[44px] px-2">Esci</button>
      </div>
    </div>
  );
}
