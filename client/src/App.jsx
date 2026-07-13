import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useAuthStore } from "./store/authStore.js";
import PrivateRoute from "./components/PrivateRoute.jsx";
import Layout from "./components/Layout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import Dashboard from "./pages/Dashboard.jsx";

// Le pagine secondarie sono lazy: escono dal bundle iniziale (recharts pesa da
// solo ~150KB e serve solo in Dashboard/Analisi) e si caricano alla prima visita.
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const TreasuryPage = lazy(() => import("./pages/TreasuryPage.jsx"));
const InvoicesPage = lazy(() => import("./pages/InvoicesPage.jsx"));
const TransactionsPage = lazy(() => import("./pages/TransactionsPage.jsx"));
const TaxSavingsPage = lazy(() => import("./pages/TaxSavingsPage.jsx"));
const OcrPage = lazy(() => import("./pages/OcrPage.jsx"));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage.jsx"));
const ShoppingListPage = lazy(() => import("./pages/ShoppingListPage.jsx"));
const BudgetsPage = lazy(() => import("./pages/BudgetsPage.jsx"));
const SummaryPage = lazy(() => import("./pages/SummaryPage.jsx"));

const Spinner = () => (
  <div className="min-h-[40vh] flex items-center justify-center">
    <div className="h-8 w-8 rounded-full border-2 border-card-line border-t-brand-600 animate-spin" />
  </div>
);

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
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="h-8 w-8 rounded-full border-2 border-card-line border-t-brand-600 animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
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
            <Route path="/treasury" element={<TreasuryPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/ocr" element={<OcrPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/shopping-list" element={<ShoppingListPage />} />
            <Route path="/budgets" element={<BudgetsPage />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
