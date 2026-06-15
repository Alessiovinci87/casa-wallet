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

function App() {
  const loadFromStorage = useAuthStore((s) => s.loadFromStorage);

  // Restore the session once on startup.
  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

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
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
