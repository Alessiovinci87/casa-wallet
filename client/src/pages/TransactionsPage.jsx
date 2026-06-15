import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { useTransactionStore } from "../store/transactionStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import TransactionForm from "../components/TransactionForm.jsx";

const now = new Date();

export default function TransactionsPage() {
  const { transactions, loading, fetchTransactions, deleteTransaction } = useTransactionStore();
  const location = useLocation();
  const [filters, setFilters] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    type: "",
    method: "",
  });
  // If we arrived from the OCR page with prefilled data, open the form on it.
  const [formInitial, setFormInitial] = useState(location.state?.prefill ?? null);
  const [showForm, setShowForm] = useState(Boolean(location.state?.prefill));

  useEffect(() => {
    fetchTransactions(filters);
  }, [filters, fetchTransactions]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const openNew = () => { setFormInitial(null); setShowForm(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transazioni</h1>
        <button onClick={openNew} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
          + Nuova transazione
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-3 shadow-sm flex flex-wrap gap-3 text-sm">
        <select value={filters.month} onChange={(e) => setFilter("month", e.target.value)} className="px-2 py-1 border border-slate-300 rounded">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{dayjs().month(m - 1).format("MMMM")}</option>
          ))}
        </select>
        <input type="number" value={filters.year} onChange={(e) => setFilter("year", e.target.value)} className="px-2 py-1 border border-slate-300 rounded w-24" />
        <select value={filters.type} onChange={(e) => setFilter("type", e.target.value)} className="px-2 py-1 border border-slate-300 rounded">
          <option value="">Tutti i tipi</option>
          <option value="INCOME">Entrate</option>
          <option value="EXPENSE">Uscite</option>
        </select>
        <select value={filters.method} onChange={(e) => setFilter("method", e.target.value)} className="px-2 py-1 border border-slate-300 rounded">
          <option value="">Tutti i metodi</option>
          {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm divide-y divide-slate-100">
        {loading ? (
          <p className="p-4 text-sm text-slate-400">Caricamento…</p>
        ) : transactions.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Nessuna transazione.</p>
        ) : (
          transactions.map((t) => (
            <div key={t.id} className="p-3 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-medium">{t.category}{t.subcategory ? ` · ${t.subcategory}` : ""}</div>
                <div className="text-slate-400">
                  {PAY_METHOD_LABELS[t.method]} · {dayjs(t.date).format("DD/MM/YYYY")}
                  {t.description ? ` · ${t.description}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-semibold ${t.type === "INCOME" ? "text-emerald-600" : "text-rose-600"}`}>
                  {t.type === "INCOME" ? "+" : "−"}{eur(t.amount)}
                </span>
                <button onClick={() => deleteTransaction(t.id)} className="text-slate-300 hover:text-rose-600" title="Elimina">✕</button>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <TransactionForm initial={formInitial} onClose={() => { setShowForm(false); setFormInitial(null); }} />
      )}
    </div>
  );
}
