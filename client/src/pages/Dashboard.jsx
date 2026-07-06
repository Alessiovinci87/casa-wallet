import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTaxStore } from "../store/taxStore.js";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import { PAY_METHOD_LABELS } from "../lib/constants.js";
import BalanceTrendChart from "../components/BalanceTrendChart.jsx";
import NotificationsToggle from "../components/NotificationsToggle.jsx";

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const MONTH_NAME = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(now);

// Previous calendar month (handles January → December rollover).
const prevDate = new Date(YEAR, MONTH - 2, 1);
const PREV_MONTH = prevDate.getMonth() + 1;
const PREV_YEAR = prevDate.getFullYear();

// Percentage change current vs previous. null = no baseline (prev was 0).
function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / prev) * 100;
}

// Colored arrow + percentage. goodWhenUp flips the green/red meaning.
function Delta({ value, goodWhenUp }) {
  if (value == null) return <span className="text-ink-400">n.d.</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const color = flat ? "text-ink-400" : up === goodWhenUp ? "text-brand-600" : "text-rose-600";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return <span className={`${color} font-medium nums`}>{arrow} {Math.abs(value).toFixed(0)}%</span>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { transactions, fetchTransactions } = useTransactionStore();
  const { summary, fetchSummary } = useTaxStore();
  // Previous month totals, fetched separately so the store keeps the current month.
  const [prev, setPrev] = useState(null);

  useEffect(() => {
    fetchTransactions({ month: MONTH, year: YEAR });
    fetchSummary();
  }, [fetchTransactions, fetchSummary]);

  useEffect(() => {
    api
      .get("/api/transactions", { params: { month: PREV_MONTH, year: PREV_YEAR } })
      .then(({ data }) => {
        let income = 0, expense = 0, tax = 0;
        for (const t of data) {
          if (t.type === "INCOME") { income += t.amount; tax += t.taxAmount || 0; }
          else { expense += t.amount; }
        }
        setPrev({ income, expense, tax });
      })
      .catch(() => setPrev(null));
  }, []);

  const { income, expense, taxSetAside } = useMemo(() => {
    let income = 0, expense = 0, taxSetAside = 0;
    for (const t of transactions) {
      if (t.type === "INCOME") {
        income += t.amount;
        // Tasse accantonate da questa entrata: non sono soldi spendibili.
        taxSetAside += t.taxAmount || 0;
      } else {
        expense += t.amount;
      }
    }
    return { income, expense, taxSetAside };
  }, [transactions]);

  // Saldo spendibile: le tasse accantonate sono escluse (non sono soldi miei).
  const saldo = income - expense - taxSetAside;
  const max = Math.max(income, expense, 1);
  const recent = transactions.slice(0, 5);

  // Previsione spesa a fine mese: media giornaliera × giorni del mese.
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
  const avgDailyExpense = dayOfMonth > 0 ? expense / dayOfMonth : 0;
  const forecastExpense = avgDailyExpense * daysInMonth;

  return (
    <div className="space-y-4">
      <NotificationsToggle />

      {/* Hero: saldo disponibile del mese (tasse accantonate escluse) */}
      <div className="bg-brand-600 text-white rounded-2xl p-6 shadow-sm">
        <div className="text-[11px] uppercase tracking-widest text-white/70">
          Disponibile a {MONTH_NAME}
        </div>
        <div className="text-4xl sm:text-5xl font-bold tracking-tight mt-1 nums">
          {eur(saldo)}
        </div>
        <div className="flex gap-6 mt-4 text-sm text-white/85">
          <button
            type="button"
            className="text-left hover:text-white transition"
            onClick={() => navigate("/transactions", { state: { filterType: "INCOME" } })}
          >
            <span className="block text-xs text-white/60">Entrate</span>
            <span className="font-semibold nums">+ {eur(income)}</span>
          </button>
          <button
            type="button"
            className="text-left hover:text-white transition"
            onClick={() => navigate("/transactions", { state: { filterType: "EXPENSE" } })}
          >
            <span className="block text-xs text-white/60">Uscite</span>
            <span className="font-semibold nums">− {eur(expense)}</span>
          </button>
          {taxSetAside > 0 && (
            <div className="text-left">
              <span className="block text-xs text-white/60">Accantonate</span>
              <span className="font-semibold nums">{eur(taxSetAside)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Salvadanaio tasse: l'ambra è il suo colore riservato */}
      <button
        type="button"
        onClick={() => navigate("/tax-savings")}
        className="card w-full p-4 flex items-center justify-between hover:border-brand-200 transition text-left"
      >
        <div>
          <div className="text-sm text-ink-600">Salvadanaio tasse</div>
          <div className="text-lg font-bold text-tax-600 nums">{eur(summary?.totalPending)}</div>
        </div>
        {(summary?.totalPending ?? 0) > 0 && (
          <span className="text-[11px] font-semibold bg-tax-50 text-tax-600 px-2.5 py-1 rounded-full">
            Da trasferire
          </span>
        )}
      </button>

      {/* Confronto con il mese precedente */}
      {prev && (
        <div className="card p-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-ink-400">Entrate vs mese prec.</div>
            <Delta value={pctChange(income, prev.income)} goodWhenUp />
          </div>
          <div>
            <div className="text-ink-400">Uscite vs mese prec.</div>
            <Delta value={pctChange(expense, prev.expense)} goodWhenUp={false} />
          </div>
          <div>
            <div className="text-ink-400">Tasse vs mese prec.</div>
            <Delta value={pctChange(taxSetAside, prev.tax)} goodWhenUp={false} />
          </div>
        </div>
      )}

      {/* Previsione spesa a fine mese */}
      <div className="card p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-600">Previsione spesa fine mese</div>
          <div className="text-xs text-ink-400 mt-0.5 nums">
            Media {eur(avgDailyExpense)}/giorno · {dayOfMonth} di {daysInMonth} giorni
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-ink-900 nums">{eur(forecastExpense)}</div>
      </div>

      <BalanceTrendChart transactions={transactions} month={MONTH} year={YEAR} />

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink-600 mb-3">Entrate vs Uscite</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-600">Entrate</span>
            <div className="flex-1 bg-paper rounded-full h-3">
              <div className="bg-brand-500 h-3 rounded-full" style={{ width: `${(income / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs nums">{eur(income)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-600">Uscite</span>
            <div className="flex-1 bg-paper rounded-full h-3">
              <div className="bg-ink-400 h-3 rounded-full" style={{ width: `${(expense / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs nums">{eur(expense)}</span>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink-600 mb-3">Ultime transazioni</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-400">Nessuna transazione questo mese.</p>
        ) : (
          <ul className="divide-y divide-card-line">
            {recent.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{t.category}</span>
                  <span className="text-ink-400 ml-2">{PAY_METHOD_LABELS[t.method]}</span>
                  {t.user?.name && <span className="text-ink-400 ml-2 text-xs">· {t.user.name}</span>}
                </div>
                <span className={`font-semibold nums ${t.type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
                  {t.type === "INCOME" ? "+ " : "− "}{eur(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
