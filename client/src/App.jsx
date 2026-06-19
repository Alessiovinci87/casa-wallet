import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStore } from "./store/authStore.js";
import PrivateRoute from "./components/PrivateRoute.jsx";
import Layout from "./components/Layout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import TransactionsPage from "./pages/TransactionsPage.jsx";
import TaxSavingsPage from "./pages/TaxSavingsPage.jsx";
import OcrPage from "./pages/OcrPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import ShoppingListPage from "./pages/ShoppingListPage.jsx";
import BudgetsPage from "./pages/BudgetsPage.jsx";
import SummaryPage from "./pages/SummaryPage.jsx";

function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);
  const hydrated = useAuthStore((s) => s.hydrated);

  // Restore the session once on startup.
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  // Wait until the saved session has been read before rendering any route,
  // so a refresh never redirects an authenticated user to /login.
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-emerald-600 animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/tax-savings" element={<TaxSavingsPage />} />
          <Route path="/ocr" element={<OcrPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/shopping-list" element={<ShoppingListPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/summary" element={<SummaryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
