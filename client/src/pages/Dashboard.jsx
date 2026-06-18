import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTaxStore } from "../store/taxStore.js";
import { eur } from "../lib/format.js";
import { PAY_METHOD_LABELS } from "../lib/constants.js";

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

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

  useEffect(() => {
    fetchTransactions({ month: MONTH, year: YEAR });
    fetchSummary();
  }, [fetchTransactions, fetchSummary]);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Riepilogo {String(MONTH).padStart(2, "0")}/{YEAR}</h1>

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
