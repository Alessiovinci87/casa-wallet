import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/transactions", label: "Transazioni" },
  { to: "/tax-savings", label: "Salvadanaio" },
  { to: "/ocr", label: "OCR" },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  useWebSocket(); // live sync while logged in

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="font-bold text-emerald-600">CasaWallet</span>
            <nav className="flex gap-4 text-sm">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    isActive ? "text-emerald-600 font-medium" : "text-slate-500 hover:text-slate-800"
                  }
                >
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user?.name}</span>
            <button onClick={handleLogout} className="text-slate-500 hover:text-rose-600">
              Esci
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
