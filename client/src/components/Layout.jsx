import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { HomeIcon, ListIcon, TargetIcon, ChartIcon, MoreIcon, PlusIcon, CameraIcon, MinusCircleIcon, PlusCircleIcon, XIcon } from "./Icons.jsx";
import TransactionForm from "./TransactionForm.jsx";

// Navigazione mobile-first: bottom tab bar (5 voci) + FAB "+" su mobile,
// sidebar sinistra fissa con bottone "Nuovo" su desktop (≥ 768px).
// Header di pagina: solo titolo e avatar (tap → Impostazioni).

const TABS = [
  { to: "/", label: "Home", Icon: HomeIcon, end: true },
  { to: "/movements", label: "Movimenti", Icon: ListIcon },
  { to: "/goals", label: "Obiettivi", Icon: TargetIcon },
  { to: "/forecast", label: "Previsione", Icon: ChartIcon },
  { to: "/more", label: "Altro", Icon: MoreIcon },
];

// Titolo dell'header per route (le pagine non ripetono l'h1).
const TITLES = [
  ["/movements", "Movimenti"],
  ["/expenses", "Movimenti"],
  ["/income", "Movimenti"],
  ["/recurring", "Movimenti"],
  ["/goals", "Obiettivi"],
  ["/tax-savings", "Tasse accantonate"],
  ["/forecast", "Previsione"],
  ["/more", "Altro"],
  ["/treasury", "Tesoreria"],
  ["/invoices", "Fatture"],
  ["/ocr", "Nuova spesa"],
  ["/import", "Importa CSV"],
  ["/analytics", "Analisi"],
  ["/shopping-list", "Lista spesa"],
  ["/budgets", "Budget"],
  ["/summary", "Riepilogo"],
  ["/settings", "Impostazioni"],
  ["/onboarding", "Punto zero"],
];
const pageTitle = (path) => (path === "/" ? "Home" : TITLES.find(([p]) => path.startsWith(p))?.[1] || "");

// Il FAB non compare sulle pagine che sono già un form.
const NO_FAB = ["/ocr", "/onboarding", "/import"];

function ActionSheet({ onClose, onPick }) {
  const items = [
    { key: "ocr", label: "Foto scontrino", hint: "Camera o galleria, prodotti letti dall'AI", Icon: CameraIcon },
    { key: "expense", label: "Spesa manuale", hint: "Uscita con categoria e metodo", Icon: MinusCircleIcon },
    { key: "income", label: "Entrata", hint: "Stipendio, incasso fattura, altro", Icon: PlusCircleIcon },
  ];
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute inset-x-0 bottom-0 md:inset-auto md:left-56 md:top-20 md:w-80 bg-white rounded-t-2xl md:rounded-2xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Nuovo movimento"
      >
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-sm font-semibold text-ink-600">Nuovo</span>
          <button onClick={onClose} className="p-2 -mr-2 text-ink-400" aria-label="Chiudi"><XIcon size={20} /></button>
        </div>
        {items.map(({ key, label, hint, Icon }) => (
          <button
            key={key}
            onClick={() => onPick(key)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-paper text-left min-h-[52px]"
          >
            <span className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><Icon /></span>
            <span>
              <span className="block font-medium">{label}</span>
              <span className="block text-[13px] text-ink-400">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Layout() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState(null); // { type } → TransactionForm
  const [keyboard, setKeyboard] = useState(false);
  useWebSocket(); // live sync while logged in

  // Tab bar nascosta quando la tastiera è aperta (mobile: il viewport visuale si restringe).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboard(window.innerHeight - vv.height > 150);
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const pick = (key) => {
    setSheet(false);
    if (key === "ocr") navigate("/ocr");
    else setForm({ type: key === "income" ? "INCOME" : "EXPENSE" });
  };

  const showFab = !NO_FAB.some((p) => location.pathname.startsWith(p));
  const title = pageTitle(location.pathname);

  const tabClass = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 min-h-[44px] flex-1 text-[13px] ${isActive ? "text-brand-600 font-semibold" : "text-ink-600"}`;
  const sideClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl min-h-[44px] ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-ink-600 hover:bg-paper"}`;

  return (
    <div className="min-h-screen bg-paper text-ink-900 md:flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-card-line bg-white sticky top-0 h-screen p-3 gap-1">
        <button
          onClick={() => setSheet(true)}
          className="flex items-center justify-center gap-2 bg-brand-600 text-white rounded-xl py-2.5 mb-2 font-semibold hover:bg-brand-700"
        >
          <PlusIcon size={18} /> Nuovo
        </button>
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={sideClass}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
      </aside>

      <div className="flex-1 min-w-0">
        <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur border-b border-card-line">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
            <h1 className="text-lg font-bold truncate">{title}</h1>
            <button
              onClick={() => navigate("/settings")}
              className="w-11 h-11 -mr-2 flex items-center justify-center"
              aria-label="Impostazioni"
              title={user?.name}
            >
              <span className="w-8 h-8 rounded-full bg-brand-600 text-white text-[13px] font-semibold flex items-center justify-center">
                {user?.name?.[0]?.toUpperCase() || "?"}
              </span>
            </button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* FAB mobile */}
      {showFab && !keyboard && (
        <button
          onClick={() => setSheet(true)}
          className="md:hidden fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center hover:bg-brand-700"
          aria-label="Nuovo movimento"
        >
          <PlusIcon size={26} />
        </button>
      )}

      {/* Bottom tab bar mobile */}
      {!keyboard && (
        <nav className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-card-line pb-[env(safe-area-inset-bottom)]">
          <div className="flex h-14">
            {TABS.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={tabClass}>
                <Icon size={22} /> {label}
              </NavLink>
            ))}
          </div>
        </nav>
      )}

      {sheet && <ActionSheet onClose={() => setSheet(false)} onPick={pick} />}
      {form && <TransactionForm initial={form} onClose={() => setForm(null)} />}
    </div>
  );
}
