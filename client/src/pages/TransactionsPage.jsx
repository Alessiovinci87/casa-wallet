import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { eur } from "../lib/format.js";
import { downloadTransactionsCsv } from "../lib/exportCsv.js";
import TransactionForm from "../components/TransactionForm.jsx";
import Segmented from "../components/Segmented.jsx";
import { useAccountStore } from "../store/accountStore.js";

// Uscite / Entrate (dentro Movimenti): totale del mese con confronto, selettore
// mese, blocchi Fisse/Variabili (Uscite) con subtotali. Riga: categoria,
// descrizione, importo, chip Ricorrente / Fattura n. / da obiettivo.

const now = new Date();
const TITLES = { EXPENSE: "Uscite", INCOME: "Entrate" };

function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / prev) * 100;
}

function Row({ t, type, onEdit }) {
  const accounts = useAccountStore((s) => s.accounts);
  const accountName = accounts.length > 1 ? (accounts.find((a) => a.id === t.accountId) || accounts.find((a) => a.isDefault))?.name : null;
  return (
    <button type="button" onClick={() => onEdit(t)} className="w-full text-left px-4 py-3 min-h-[52px] flex items-center justify-between gap-3 hover:bg-paper">
      <div className="min-w-0">
        <div className="font-medium truncate">{t.merchant || t.what ? [t.merchant, t.what].filter(Boolean).join(" · ") : (t.description || t.category)}</div>
        <div className="text-[13px] text-ink-400 flex flex-wrap items-center gap-x-1.5">
          {t.description && <span>{t.category}</span>}
          {t.recurringRuleId && <span className="px-1.5 rounded-full bg-brand-50 text-brand-700">Ricorrente</span>}
          {t.invoice && <span className="px-1.5 rounded-full bg-paper text-ink-600">Fattura n. {t.invoice.numero}</span>}
          {t.goalContribution && <span className="px-1.5 rounded-full bg-paper text-ink-600">da obiettivo</span>}
          {accountName && <span className="px-1.5 rounded-full bg-paper text-ink-600">{accountName}</span>}
          {type === "INCOME" && t.taxPercent > 0 && <span className="px-1.5 rounded-full bg-tax-50 text-tax-600 nums">{t.taxPercent}% tasse</span>}
        </div>
      </div>
      <span className={`shrink-0 font-semibold nums ${type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
        {type === "INCOME" ? "+" : "−"}{eur(t.amount)}
      </span>
    </button>
  );
}

// Lista raggruppata per giorno.
function DayGroups({ items, type, onEdit, empty }) {
  if (items.length === 0) return <p className="px-4 py-3 text-[13px] text-ink-400">{empty}</p>;
  const groups = [];
  for (const t of items) {
    const k = dayjs(t.date).format("YYYY-MM-DD");
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, date: t.date, items: [] });
    groups[groups.length - 1].items.push(t);
  }
  return groups.map((g) => (
    <div key={g.k}>
      <div className="px-4 pt-2 pb-1 text-[13px] text-ink-400 capitalize">{dayjs(g.date).format("ddd D MMMM")}</div>
      <div className="divide-y divide-card-line">{g.items.map((t) => <Row key={t.id} t={t} type={type} onEdit={onEdit} />)}</div>
    </div>
  ));
}

export default function TransactionsPage({ type = "EXPENSE", accountId = "", onAccountChange, hideAccountFilter = false, noMerchant = false, onClearNoMerchant, initialMonth = null }) {
  const { transactions, loading, fetchTransactions, deleteTransaction } = useTransactionStore();
  const location = useLocation();
  const accounts = useAccountStore((s) => s.accounts);
  const [filters, setFilters] = useState({ month: initialMonth?.month || now.getMonth() + 1, year: initialMonth?.year || now.getFullYear(), type, accountId });
  const [prevTotal, setPrevTotal] = useState(null);
  const [formInitial, setFormInitial] = useState(location.state?.prefill ?? null);
  const [showForm, setShowForm] = useState(Boolean(location.state?.prefill));

  useEffect(() => { setFilters((f) => (f.type === type ? f : { ...f, type })); }, [type]);
  useEffect(() => { setFilters((f) => (f.accountId === accountId ? f : { ...f, accountId })); }, [accountId]);
  useEffect(() => { fetchTransactions(filters); }, [filters, fetchTransactions]);
  const accountsLoaded = useAccountStore((s) => s.loaded);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  useEffect(() => { if (!accountsLoaded) fetchAccounts().catch(() => {}); }, [accountsLoaded, fetchAccounts]);
  useEffect(() => {
    const prev = new Date(filters.year, filters.month - 2, 1);
    api.get("/api/transactions", { params: { month: prev.getMonth() + 1, year: prev.getFullYear(), type: filters.type, ...(filters.accountId && { accountId: filters.accountId }) } })
      .then(({ data }) => setPrevTotal(data.reduce((s, t) => s + t.amount, 0)))
      .catch(() => setPrevTotal(null));
  }, [filters.month, filters.year, filters.type, filters.accountId]);

  const shiftMonth = (n) => setFilters((f) => {
    const d = new Date(f.year, f.month - 1 + n, 1);
    return { ...f, month: d.getMonth() + 1, year: d.getFullYear() };
  });
  const openEdit = (t) => { setFormInitial(t); setShowForm(true); };
  const remove = async (t) => {
    if (!window.confirm(`Eliminare "${t.description || t.category}" (${eur(t.amount)})?`)) return;
    try { await deleteTransaction(t.id); } catch { window.alert("Eliminazione non riuscita, riprova."); }
  };

  // Filtro "senza Dove" (da Dove vanno i soldi): solo i movimenti da completare.
  const shown = useMemo(() => (noMerchant ? transactions.filter((t) => !t.merchant) : transactions), [transactions, noMerchant]);
  const { total, fixed, variable } = useMemo(() => {
    let total = 0;
    const fixed = [], variable = [];
    for (const t of shown) { total += t.amount; (t.recurringRuleId ? fixed : variable).push(t); }
    return { total, fixed, variable };
  }, [shown]);
  const fixedTotal = fixed.reduce((s, t) => s + t.amount, 0);
  const delta = prevTotal == null ? null : pctChange(total, prevTotal);
  const goodWhenUp = type === "INCOME";
  const monthDate = new Date(filters.year, filters.month - 1, 1);
  const isCurrent = filters.month === now.getMonth() + 1 && filters.year === now.getFullYear();

  if (showForm) {
    return (
      <TransactionForm
        initial={formInitial}
        onClose={() => { setShowForm(false); setFormInitial(null); }}
        onDelete={formInitial?.id ? () => { setShowForm(false); remove(formInitial); } : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">{TITLES[type]}</h1>

      {/* Filtro per conto (solo con più conti) */}
      {accounts.length > 1 && !hideAccountFilter && (
        <Segmented
          size="sm"
          value={accountId || ""}
          onChange={(v) => (onAccountChange ? onAccountChange(v) : setFilters((f) => ({ ...f, accountId: v })))}
          options={[{ value: "", label: "Tutti i conti" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
      )}

      {noMerchant && (
        <div className="card p-3 flex items-center justify-between gap-3 border-tax-600/30 bg-tax-50/40 text-[13px]">
          <span className="text-tax-600">Movimenti senza "Dove": toccane uno, compila Dove e Cosa, poi Salva.</span>
          <button type="button" onClick={onClearNoMerchant} className="shrink-0 min-h-[44px] px-2 text-ink-600">Mostra tutti</button>
        </div>
      )}

      {/* Totale del mese + selettore mese */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shiftMonth(-1)} className="w-11 h-11 -ml-2 text-ink-600 text-xl" aria-label="Mese precedente">‹</button>
          <div className="text-[13px] text-ink-600 capitalize">{dayjs(monthDate).format("MMMM YYYY")}</div>
          <button type="button" onClick={() => shiftMonth(1)} disabled={isCurrent} className="w-11 h-11 -mr-2 text-ink-600 text-xl disabled:opacity-30" aria-label="Mese successivo">›</button>
        </div>
        <div className={`text-3xl font-bold nums text-center ${type === "INCOME" ? "text-brand-600" : ""}`}>{eur(total)}</div>
        <div className="text-[13px] text-center text-ink-600 mt-1">
          {delta == null ? (
            <span className="text-ink-400">nessun confronto col mese precedente</span>
          ) : (
            <>
              <span className={`font-semibold nums ${Math.abs(delta) < 0.5 ? "" : (delta > 0) === goodWhenUp ? "text-brand-600" : "text-rose-600"}`}>
                {Math.abs(delta) < 0.5 ? "→" : delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
              </span>{" "}
              <span className="text-ink-400">vs {eur(prevTotal)} del mese precedente</span>
            </>
          )}
        </div>
      </div>

      {loading && transactions.length === 0 ? (
        <div className="card p-4 text-[13px] text-ink-400">Caricamento…</div>
      ) : type === "EXPENSE" ? (
        <>
          <section className="card">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <h2 className="font-semibold">Fisse</h2>
              <span className="font-semibold nums">{eur(fixedTotal)}</span>
            </div>
            <DayGroups items={fixed} type={type} onEdit={openEdit} empty="Nessuna uscita fissa registrata questo mese." />
          </section>
          <section className="card">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <h2 className="font-semibold">Variabili</h2>
              <span className="font-semibold nums">{eur(total - fixedTotal)}</span>
            </div>
            <DayGroups items={variable} type={type} onEdit={openEdit} empty="Nessuna uscita variabile." />
          </section>
        </>
      ) : (
        <section className="card">
          <DayGroups items={transactions} type={type} onEdit={openEdit} empty="Nessuna entrata questo mese." />
        </section>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => downloadTransactionsCsv(transactions, `${TITLES[type].toLowerCase()}_${filters.year}-${String(filters.month).padStart(2, "0")}.csv`)}
          disabled={transactions.length === 0}
          className="min-h-[44px] px-4 text-[13px] text-ink-600 border border-card-line rounded-lg disabled:opacity-40"
        >
          Esporta CSV
        </button>
      </div>

    </div>
  );
}
