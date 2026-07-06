import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { useTransactionStore } from "../store/transactionStore.js";
import { PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import { downloadTransactionsCsv } from "../lib/exportCsv.js";
import TransactionForm from "../components/TransactionForm.jsx";

const now = new Date();

export default function TransactionsPage() {
  const { transactions, loading, fetchTransactions, deleteTransaction } = useTransactionStore();
  const location = useLocation();
  const [filters, setFilters] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    // Arriving from a Dashboard card pre-filters by type (INCOME/EXPENSE).
    type: location.state?.filterType ?? "",
    method: "",
  });
  // If we arrived from the OCR page with prefilled data, open the form on it.
  const [formInitial, setFormInitial] = useState(location.state?.prefill ?? null);
  const [showForm, setShowForm] = useState(Boolean(location.state?.prefill));

  // The year is a free-typed number: debounce it (400ms) so we don't refetch on
  // every keystroke. Other filters commit immediately.
  const [yearInput, setYearInput] = useState(filters.year);
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (String(f.year) === String(yearInput) ? f : { ...f, year: yearInput }));
    }, 400);
    return () => clearTimeout(id);
  }, [yearInput]);

  useEffect(() => {
    fetchTransactions(filters);
  }, [filters, fetchTransactions]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  const openNew = () => { setFormInitial(null); setShowForm(true); };
  const openEdit = (t) => { setFormInitial(t); setShowForm(true); };

  const exportCsv = () => {
    const name = `transazioni_${filters.year}-${String(filters.month).padStart(2, "0")}.csv`;
    downloadTransactionsCsv(transactions, name);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Transazioni</h1>
        <div className="flex w-full sm:w-auto gap-2">
          <button
            onClick={exportCsv}
            disabled={transactions.length === 0}
            className="flex-1 sm:flex-none px-4 py-2 border border-slate-300 text-slate-600 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Esporta CSV
          </button>
          <button onClick={openNew} className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
            + Nuova transazione
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-3 shadow-sm flex flex-wrap gap-3 text-sm">
        <select value={filters.month} onChange={(e) => setFilter("month", e.target.value)} className="px-2 py-1 border border-slate-300 rounded">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{dayjs().month(m - 1).format("MMMM")}</option>
          ))}
        </select>
        <input type="number" value={yearInput} onChange={(e) => setYearInput(e.target.value)} className="px-2 py-1 border border-slate-300 rounded w-24" />
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
                  {t.user?.name ? (
                    <span className="ml-1 inline-block px-1.5 py-0.5 text-xs rounded-full bg-slate-100 text-slate-500 align-middle">
                      {t.user.name}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-semibold ${t.type === "INCOME" ? "text-emerald-600" : "text-rose-600"}`}>
                  {t.type === "INCOME" ? "+" : "−"}{eur(t.amount)}
                </span>
                <button onClick={() => openEdit(t)} className="text-slate-300 hover:text-emerald-600" title="Modifica">✎</button>
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
