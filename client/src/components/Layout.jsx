import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { HomeIcon, ListIcon, TargetIcon, ChartIcon, MoreIcon, PlusIcon, CameraIcon, MinusCircleIcon, PlusCircleIcon, XIcon } from "./Icons.jsx";
import TransactionForm from "./TransactionForm.jsx";
import DialogHost from "./DialogHost.jsx";

// Navigazione mobile-first: bottom tab bar (5 voci) + FAB "+" su mobile,
// sidebar sinistra fissa con bottone "Nuovo" su desktop (≥ 768px).
// Header di pagina: solo titolo e avatar (tap → Impostazioni).
//
// Guscio app (senza position:fixed): header · main scorrevole · tab bar sono
// tre righe di una colonna alta quanto il viewport VISUALE (--vvh). Su iPhone
// le barre fisse saltavano con la toolbar di Safari e con la tastiera; qui
// scorre solo <main>, la tab bar è sempre al suo posto e non copre nulla.

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
  ["/add", "Nuovo movimento"],
  ["/spending", "Dove vanno i soldi"],
  ["/advisor", "Consulente"],
  ["/import", "Importa estratto conto"],
  ["/analytics", "Analisi"],
  ["/shopping-list", "Lista spesa"],
  ["/budgets", "Budget"],
  ["/summary", "Riepilogo"],
  ["/settings", "Impostazioni"],
  ["/onboarding", "Punto zero"],
];
// Pagine principali (tab bar): niente tasto indietro.
const ROOTS = new Set(["/", "/movements", "/goals", "/forecast", "/more"]);
// "Indietro" va sempre alla pagina genitore (affidabile anche dopo un refresh o da una push).
const PARENTS = [
  ["/add", "/movements"], ["/ocr", "/movements"], ["/tax-savings", "/goals"], ["/onboarding", "/"],
  ["/settings", "/more"], ["/treasury", "/more"], ["/invoices", "/more"], ["/spending", "/more"], ["/advisor", "/more"],
  ["/import", "/more"], ["/analytics", "/more"], ["/shopping-list", "/more"], ["/budgets", "/more"], ["/summary", "/"],
];
const parentOf = (path) => PARENTS.find(([p]) => path.startsWith(p))?.[1] || "/more";
const pageTitle = (path) => (path === "/" ? "Home" : TITLES.find(([p]) => path.startsWith(p))?.[1] || "");

// Il FAB non compare sulle pagine che sono già un form.
const NO_FAB = ["/ocr", "/onboarding", "/import", "/add"];

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
  const mainRef = useRef(null);
  useWebSocket(); // live sync while logged in

  // Scorre solo <main>: a ogni cambio pagina si riparte dall'alto.
  useEffect(() => { mainRef.current?.scrollTo?.(0, 0); }, [location.pathname, location.search]);

  // Tab bar nascosta quando la tastiera è aperta (mobile: il viewport visuale si restringe).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setKeyboard(window.innerHeight - vv.height > 150);
      // Il guscio (e le finestre) si dimensionano sul viewport visuale: con la
      // tastiera aperta tutto resta scorrevole fino al tasto Salva, e la pagina
      // non "scappa" verso l'alto (iOS sposta il layout viewport: lo riportiamo a 0).
      document.documentElement.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
      if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => { vv.removeEventListener("resize", onResize); vv.removeEventListener("scroll", onResize); };
  }, []);

  const pick = (key) => {
    setSheet(false);
    if (key === "ocr") navigate("/ocr");
    else navigate(`/add?type=${key === "income" ? "income" : "expense"}`);
  };
  // FAB: un tocco e sei sull'importo (Uscita; in pagina si passa a Entrata o allo scontrino).
  const quickAdd = () => navigate("/add?type=expense");

  const showFab = !NO_FAB.some((p) => location.pathname.startsWith(p));
  const title = pageTitle(location.pathname);

  const tabClass = ({ isActive }) =>
    `flex flex-col items-center justify-center gap-0.5 min-h-[44px] flex-1 text-[13px] ${isActive ? "text-brand-600 font-semibold [&_svg]:stroke-[2.4]" : "text-ink-400"}`;
  const sideClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl min-h-[44px] ${isActive ? "bg-brand-50 text-brand-700 font-semibold" : "text-ink-600 hover:bg-paper"}`;

  return (
    <div className="app-shell bg-paper text-ink-900 md:flex">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex md:flex-col w-56 shrink-0 border-r border-card-line bg-white h-full p-3 gap-1">
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

      <div className="flex-1 min-w-0 h-full flex flex-col">
        <header className="shrink-0 z-20 bg-paper pt-[env(safe-area-inset-top)]">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center min-w-0">
              {!ROOTS.has(location.pathname) && (
                <button
                  type="button"
                  onClick={() => navigate(parentOf(location.pathname))}
                  className="w-11 h-11 -ml-3 mr-1 flex items-center justify-center text-ink-600"
                  aria-label="Indietro"
                >
                  <span aria-hidden="true" className="text-2xl leading-none">‹</span>
                </button>
              )}
              <h1 className="text-[22px] font-bold tracking-tight truncate">{title}</h1>
            </div>
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

        <div className="relative flex-1 min-h-0">
          <main ref={mainRef} className="app-main h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-4 pb-24 md:pb-8">
              <Outlet />
            </div>
          </main>

          {/* FAB mobile: dentro l'area scorrevole (absolute, non fixed) */}
          {showFab && !keyboard && (
            <button
              onClick={quickAdd}
              className="md:hidden absolute right-4 bottom-4 z-30 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center hover:bg-brand-700"
              aria-label="Nuovo movimento"
            >
              <PlusIcon size={26} />
            </button>
          )}
        </div>

        {/* Bottom tab bar mobile: in flusso, sotto <main>, mai sopra al contenuto */}
        {!keyboard && !location.pathname.startsWith("/add") && (
          <nav className="md:hidden shrink-0 z-30 bg-white/95 backdrop-blur border-t border-card-line pb-[env(safe-area-inset-bottom)]">
            <div className="flex h-14">
              {TABS.map(({ to, label, Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={tabClass}>
                  <Icon size={22} /> {label}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>

      {sheet && <ActionSheet onClose={() => setSheet(false)} onPick={pick} />}
      {form && <TransactionForm initial={form} onClose={() => setForm(null)} />}
      <DialogHost />
    </div>
  );
}
