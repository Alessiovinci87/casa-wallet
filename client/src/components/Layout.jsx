import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transactions", label: "Transazioni" },
  { to: "/tax-savings", label: "Salvadanaio" },
  { to: "/ocr", label: "Nuova spesa" },
  { to: "/analytics", label: "Analisi" },
  { to: "/shopping-list", label: "Lista spesa" },
  { to: "/budgets", label: "Budget" },
  { to: "/summary", label: "Riepilogo" },
  { to: "/settings", label: "Impostazioni" },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  useWebSocket(); // live sync while logged in

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const navClass = ({ isActive }) =>
    isActive ? "text-emerald-600 font-medium" : "text-slate-500 hover:text-slate-800";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 min-w-0">
            <span className="font-bold text-emerald-600">CasaWallet</span>
            {/* Desktop nav */}
            <nav className="hidden md:flex gap-4 text-sm">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden sm:inline text-slate-500 truncate max-w-[8rem]">{user?.name}</span>
            <button onClick={handleLogout} className="hidden md:inline text-slate-500 hover:text-rose-600">
              Esci
            </button>
            {/* Mobile hamburger */}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden p-2 -mr-2 text-slate-600"
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <div className="space-y-1.5">
                <span className={`block h-0.5 w-6 bg-current transition-transform ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
                <span className={`block h-0.5 w-6 bg-current transition-opacity ${menuOpen ? "opacity-0" : ""}`} />
                <span className={`block h-0.5 w-6 bg-current transition-transform ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
              </div>
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <nav className="md:hidden border-t border-slate-200 bg-white px-4 py-2">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block py-3 ${isActive ? "text-emerald-600 font-medium" : "text-slate-600"}`
                }
              >
                {l.label}
              </NavLink>
            ))}
            <div className="border-t border-slate-100 mt-1 pt-3 pb-1 flex items-center justify-between">
              <span className="text-slate-500 text-sm truncate">{user?.name}</span>
              <button onClick={handleLogout} className="text-rose-600 text-sm">
                Esci
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
