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
  if (value == null) return <span className="text-slate-400">n.d.</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const color = flat ? "text-slate-400" : up === goodWhenUp ? "text-emerald-600" : "text-rose-600";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return <span className={`${color} font-medium`}>{arrow} {Math.abs(value).toFixed(0)}%</span>;
}

function Card({ label, value, accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white rounded-xl p-3 sm:p-4 shadow-sm text-center sm:text-left w-full hover:shadow-md hover:ring-1 hover:ring-emerald-200 transition"
    >
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-xl font-bold mt-1 break-words ${accent}`}>{value}</div>
    </button>
  );
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Riepilogo {String(MONTH).padStart(2, "0")}/{YEAR}</h1>

      <NotificationsToggle />

      {/* Saldo mese in evidenza (tasse accantonate escluse) */}
      <div className="bg-white rounded-xl p-6 shadow-sm text-center">
        <div className="text-sm text-slate-500">Saldo mese</div>
        <div className={`text-4xl sm:text-5xl font-bold mt-1 ${saldo >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {eur(saldo)}
        </div>
        {taxSetAside > 0 && (
          <div className="text-xs text-slate-400 mt-2">
            {eur(taxSetAside)} accantonati per le tasse (esclusi dal saldo)
          </div>
        )}
      </div>

      {/* Dettaglio in riga orizzontale — clic per lo storico */}
      <div className="grid grid-cols-3 gap-3">
        <Card label="Entrate mese" value={eur(income)} accent="text-emerald-600"
          onClick={() => navigate("/transactions", { state: { filterType: "INCOME" } })} />
        <Card label="Uscite mese" value={eur(expense)} accent="text-rose-600"
          onClick={() => navigate("/transactions", { state: { filterType: "EXPENSE" } })} />
        <Card label="Tasse" value={eur(summary?.totalPending)} accent="text-amber-600"
          onClick={() => navigate("/tax-savings")} />
      </div>

      {/* Confronto con il mese precedente */}
      {prev && (
        <div className="bg-white rounded-xl p-3 shadow-sm grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-slate-400">Entrate vs mese prec.</div>
            <Delta value={pctChange(income, prev.income)} goodWhenUp />
          </div>
          <div>
            <div className="text-slate-400">Uscite vs mese prec.</div>
            <Delta value={pctChange(expense, prev.expense)} goodWhenUp={false} />
          </div>
          <div>
            <div className="text-slate-400">Tasse vs mese prec.</div>
            <Delta value={pctChange(taxSetAside, prev.tax)} goodWhenUp={false} />
          </div>
        </div>
      )}

      {/* Previsione spesa a fine mese */}
      <div className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-600">Previsione spesa fine mese</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Media {eur(avgDailyExpense)}/giorno · {dayOfMonth} di {daysInMonth} giorni
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-rose-600">{eur(forecastExpense)}</div>
      </div>

      <BalanceTrendChart transactions={transactions} month={MONTH} year={YEAR} />

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Entrate vs Uscite</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-slate-500">Entrate</span>
            <div className="flex-1 bg-slate-100 rounded h-4">
              <div className="bg-emerald-500 h-4 rounded" style={{ width: `${(income / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs">{eur(income)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-slate-500">Uscite</span>
            <div className="flex-1 bg-slate-100 rounded h-4">
              <div className="bg-rose-500 h-4 rounded" style={{ width: `${(expense / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs">{eur(expense)}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600 mb-3">Ultime transazioni</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">Nessuna transazione questo mese.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{t.category}</span>
                  <span className="text-slate-400 ml-2">{PAY_METHOD_LABELS[t.method]}</span>
                </div>
                <span className={t.type === "INCOME" ? "text-emerald-600" : "text-rose-600"}>
                  {t.type === "INCOME" ? "+" : "−"}{eur(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
