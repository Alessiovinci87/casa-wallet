import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import { downloadTransactionsCsv } from "../lib/exportCsv.js";
import TransactionForm from "../components/TransactionForm.jsx";
import Segmented from "../components/Segmented.jsx";

// Pagina Entrate (/income) o Uscite (/expenses): stessa lista, filtrata per
// `type`. In cima il totale del mese con confronto col mese precedente; in
// Uscite due blocchi Fisse (da ricorrenze) e Variabili.

const now = new Date();

const TITLES = { EXPENSE: "Uscite", INCOME: "Entrate" };

function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / prev) * 100;
}

function Row({ t, type, onEdit, onDelete }) {
  return (
    <div className="p-3 flex items-center justify-between gap-2">
      <div className="text-sm min-w-0">
        <div className="font-medium truncate">
          {t.description || t.category}
          {t.description && <span className="text-ink-400 font-normal"> · {t.category}</span>}
        </div>
        <div className="text-ink-400 text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span>{PAY_METHOD_LABELS[t.method]} · {dayjs(t.date).format("DD/MM/YYYY")}</span>
          {t.recurringRuleId && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">↻ Ricorrente</span>
          )}
          {type === "INCOME" && t.invoice && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-paper text-ink-600">Fattura n. {t.invoice.numero}</span>
          )}
          {type === "INCOME" && t.taxPercent > 0 && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-tax-50 text-tax-600 nums">
              {t.taxPercent}% tasse · {eur(t.taxAmount)}
            </span>
          )}
          {t.user?.name && (
            <span className="inline-block px-1.5 py-0.5 rounded-full bg-paper text-ink-600">{t.user.name}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`font-semibold nums ${type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
          {type === "INCOME" ? "+" : "−"}{eur(t.amount)}
        </span>
        <button onClick={() => onEdit(t)} className="text-ink-400 hover:text-brand-600" title="Modifica">✎</button>
        <button onClick={() => onDelete(t)} className="text-ink-400 hover:text-rose-600" title="Elimina">✕</button>
      </div>
    </div>
  );
}

export default function TransactionsPage({ type = "EXPENSE" }) {
  const { transactions, loading, fetchTransactions, deleteTransaction } = useTransactionStore();
  const location = useLocation();
  const [filters, setFilters] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    type,
    method: "",
  });
  const [prevTotal, setPrevTotal] = useState(null);
  // Arrivando dall'OCR con dati precompilati, apri subito il form.
  const [formInitial, setFormInitial] = useState(location.state?.prefill ?? null);
  const [showForm, setShowForm] = useState(Boolean(location.state?.prefill));

  // Cambio pagina Entrate ↔ Uscite: stesso componente, aggiorna il tipo.
  useEffect(() => {
    setFilters((f) => (f.type === type ? f : { ...f, type }));
  }, [type]);

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

  // Totale del mese precedente per il confronto.
  useEffect(() => {
    const y = Number(filters.year);
    const m = Number(filters.month);
    if (!y || !m) return;
    const prev = new Date(y, m - 2, 1);
    api
      .get("/api/transactions", { params: { month: prev.getMonth() + 1, year: prev.getFullYear(), type: filters.type } })
      .then(({ data }) => setPrevTotal(data.reduce((s, t) => s + t.amount, 0)))
      .catch(() => setPrevTotal(null));
  }, [filters.month, filters.year, filters.type]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const openNew = () => { setFormInitial({ type }); setShowForm(true); };
  const openEdit = (t) => { setFormInitial(t); setShowForm(true); };
  const remove = async (t) => {
    if (!window.confirm(`Eliminare "${t.description || t.category}" (${eur(t.amount)})?`)) return;
    try { await deleteTransaction(t.id); } catch { window.alert("Eliminazione non riuscita, riprova."); }
  };

  const { total, fixed, variable, taxTotal } = useMemo(() => {
    let total = 0, taxTotal = 0;
    const fixed = [], variable = [];
    for (const t of transactions) {
      total += t.amount;
      taxTotal += t.taxAmount || 0;
      (t.recurringRuleId ? fixed : variable).push(t);
    }
    return { total, fixed, variable, taxTotal };
  }, [transactions]);
  const fixedTotal = fixed.reduce((s, t) => s + t.amount, 0);
  const variableTotal = total - fixedTotal;
  const delta = prevTotal == null ? null : pctChange(total, prevTotal);
  const goodWhenUp = type === "INCOME";
  const monthLabel = dayjs(new Date(Number(filters.year), Number(filters.month) - 1, 1)).format("MMMM YYYY");

  const exportCsv = () => {
    const name = `${TITLES[type].toLowerCase()}_${filters.year}-${String(filters.month).padStart(2, "0")}.csv`;
    downloadTransactionsCsv(transactions, name);
  };

  const list = (items, empty) =>
    items.length === 0 ? (
      <p className="p-4 text-sm text-ink-400">{empty}</p>
    ) : (
      items.map((t) => <Row key={t.id} t={t} type={type} onEdit={openEdit} onDelete={remove} />)
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{TITLES[type]}</h1>
        <div className="flex w-full sm:w-auto gap-2">
          <button
            onClick={exportCsv}
            disabled={transactions.length === 0}
            className="flex-1 sm:flex-none px-4 py-2 border border-card-line text-ink-600 rounded hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Esporta CSV
          </button>
          <button onClick={openNew} className="flex-1 sm:flex-none px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
            + Nuova {type === "INCOME" ? "entrata" : "uscita"}
          </button>
        </div>
      </div>

      {/* Totale del mese + confronto */}
      <div className={`rounded-2xl p-5 text-white ${type === "INCOME" ? "bg-brand-600" : "bg-ink-900"}`}>
        <div className="text-[11px] uppercase tracking-widest text-white/70 capitalize">{TITLES[type]} · {monthLabel}</div>
        <div className="text-3xl sm:text-4xl font-bold tracking-tight mt-1 nums">{eur(total)}</div>
        <div className="mt-2 text-sm text-white/85 flex flex-wrap gap-x-4 gap-y-1">
          {delta == null ? (
            <span className="text-white/60">Nessun confronto col mese precedente</span>
          ) : (
            <span>
              <span className={`font-semibold nums ${Math.abs(delta) < 0.5 ? "" : (delta > 0) === goodWhenUp ? "text-emerald-200" : "text-rose-200"}`}>
                {Math.abs(delta) < 0.5 ? "→" : delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
              </span>{" "}
              <span className="text-white/60">vs mese precedente ({eur(prevTotal)})</span>
            </span>
          )}
          {type === "INCOME" && taxTotal > 0 && (
            <span className="text-white/80">di cui accantonate per tasse <span className="font-semibold nums">{eur(taxTotal)}</span></span>
          )}
          {type === "EXPENSE" && total > 0 && (
            <span className="text-white/80">
              fisse <span className="font-semibold nums">{eur(fixedTotal)}</span> · variabili <span className="font-semibold nums">{eur(variableTotal)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Filtri — mesi a tendina (in italiano), il resto a pulsanti */}
      <div className="card p-3 space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <select value={filters.month} onChange={(e) => setFilter("month", e.target.value)} className="px-2 py-1.5 border border-card-line rounded-lg capitalize">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m} className="capitalize">{dayjs().month(m - 1).format("MMMM")}</option>
            ))}
          </select>
          <input type="number" value={yearInput} onChange={(e) => setYearInput(e.target.value)} className="px-2 py-1.5 border border-card-line rounded-lg w-24 nums" />
        </div>
        <Segmented
          size="sm"
          value={filters.method}
          onChange={(v) => setFilter("method", v)}
          options={[
            { value: "", label: "Tutti i metodi" },
            ...PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] })),
          ]}
        />
      </div>

      {loading && transactions.length === 0 ? (
        <div className="card"><p className="p-4 text-sm text-ink-400">Caricamento…</p></div>
      ) : type === "EXPENSE" ? (
        <>
          <section className="card">
            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-600">Fisse <span className="text-ink-400 font-normal">· da ricorrenze</span></h2>
              <span className="text-sm font-semibold nums">{eur(fixedTotal)}</span>
            </div>
            <div className="divide-y divide-card-line">{list(fixed, "Nessuna uscita fissa registrata questo mese.")}</div>
          </section>
          <section className="card">
            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-600">Variabili</h2>
              <span className="text-sm font-semibold nums">{eur(variableTotal)}</span>
            </div>
            <div className="divide-y divide-card-line">{list(variable, "Nessuna uscita variabile.")}</div>
          </section>
        </>
      ) : (
        <div className="card divide-y divide-card-line">{list(transactions, "Nessuna entrata.")}</div>
      )}

      {showForm && (
        <TransactionForm initial={formInitial} onClose={() => { setShowForm(false); setFormInitial(null); }} />
      )}
    </div>
  );
}
