import { useNavigate } from "react-router-dom";
import { useState } from "react";
import api from "../lib/api.js";
import { useAuthStore } from "../store/authStore.js";
import { hardRefresh } from "../lib/refresh.js";
import { dialog } from "../lib/dialog.js";
import { ChevronRightIcon, CameraIcon, UploadIcon, PieIcon, ReceiptIcon, CartIcon, GaugeIcon, SparkIcon, WalletIcon, CoinIcon, SettingsIcon } from "../components/Icons.jsx";

// "Altro": menù raggruppato stile app (icona, voce, chevron). Se un giorno la
// tab bar sparisse, questa pagina è già l'hamburger completo.
const GROUPS = [
  { title: "Registra", items: [
    { to: "/ocr", label: "Foto scontrino", Icon: CameraIcon },
    { to: "/import", label: "Importa estratto conto", Icon: UploadIcon },
  ] },
  { title: "Analizza", items: [
    { to: "/spending", label: "Dove vanno i soldi", Icon: PieIcon },
    { to: "/advisor", label: "Consulente", Icon: SparkIcon },
    { to: "/budgets", label: "Budget", Icon: GaugeIcon },
    { to: "/analytics", label: "Analisi scontrini", Icon: ReceiptIcon },
    { to: "/shopping-list", label: "Lista spesa", Icon: CartIcon },
  ] },
  { title: "Partita IVA", items: [
    { to: "/treasury", label: "Tesoreria", Icon: WalletIcon },
    { to: "/invoices", label: "Fatture", Icon: ReceiptIcon },
    { to: "/tax-savings", label: "Tasse accantonate", Icon: CoinIcon },
  ] },
];

export default function MorePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [resetting, setResetting] = useState(false);
  const isOwner = user?.role === "OWNER";

  // Ricomincia da capo: azzera i dati economici della famiglia e riapre il Punto zero.
  const restart = async () => {
    const word = await dialog.prompt({
      title: "Ricominciare da capo?",
      message: "Verranno cancellati movimenti, ricorrenze, obiettivi, fatture, scadenze, budget e saldo iniziale di tutta la famiglia. Restano account e famiglia.\n\nPer confermare scrivi RICOMINCIA:",
      placeholder: "RICOMINCIA",
      okLabel: "Cancella tutto",
    });
    if (word == null) return;
    setResetting(true);
    try {
      await api.post("/api/household/reset", { confirm: word.trim().toUpperCase() });
      try { localStorage.removeItem("onboardingSeen"); } catch { /* storage non disponibile */ }
      navigate("/onboarding");
    } catch (err) {
      dialog.alert({ message: err.response?.data?.error || "Operazione non riuscita" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => navigate("/settings")} className="list row w-full">
        <span className="w-11 h-11 rounded-full bg-brand-600 text-white font-semibold flex items-center justify-center shrink-0 text-lg">{user?.name?.[0]?.toUpperCase() || "?"}</span>
        <span className="min-w-0">
          <span className="block font-semibold truncate">{user?.name}</span>
          <span className="block text-[13px] text-ink-400 truncate">{user?.email} · Famiglia e impostazioni</span>
        </span>
        <ChevronRightIcon size={18} className="row-chevron" />
      </button>

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <h2>{g.title}</h2>
          <div className="list">
            {g.items.map(({ to, label, Icon }) => (
              <button key={to} type="button" onClick={() => navigate(to)} className="row w-full">
                <span className="row-icon"><Icon size={20} /></span>
                <span className="font-medium">{label}</span>
                <ChevronRightIcon size={18} className="row-chevron" />
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h2>App</h2>
        <div className="list">
          <button type="button" onClick={() => navigate("/settings")} className="row w-full">
            <span className="row-icon"><SettingsIcon size={20} /></span>
            <span className="font-medium">Impostazioni</span>
            <ChevronRightIcon size={18} className="row-chevron" />
          </button>
          <button type="button" onClick={() => window.open("/Guida_Awareness.pdf", "_blank")} className="row w-full">
            <span className="font-medium">Guida</span>
            <ChevronRightIcon size={18} className="row-chevron" />
          </button>
          <button type="button" onClick={hardRefresh} className="row w-full">
            <span className="min-w-0"><span className="block font-medium">Aggiorna app</span><span className="block text-[13px] text-ink-400">Svuota la cache e ricarica l'ultima versione</span></span>
          </button>
          {isOwner && (
            <button type="button" onClick={restart} disabled={resetting} className="row w-full disabled:opacity-50">
              <span className="min-w-0"><span className="block font-medium text-rose-600">{resetting ? "…" : "Ricomincia da capo"}</span><span className="block text-[13px] text-ink-400">Azzera i conti e riparti dal Punto zero</span></span>
            </button>
          )}
          <button type="button" onClick={() => { logout(); navigate("/login"); }} className="row w-full">
            <span className="font-medium text-rose-600">Esci</span>
          </button>
        </div>
      </section>
    </div>
  );
}
