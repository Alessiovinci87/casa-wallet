import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTaxStore } from "../store/taxStore.js";
import { useShoppingListStore } from "../store/shoppingListStore.js";
import { eur } from "../lib/format.js";

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();

// Quick mobile-first overview: month balance, taxes set aside, and the products
// due to rebuy — meant for a fast glance, with links to the full pages.
export default function SummaryPage() {
  const { transactions, fetchTransactions } = useTransactionStore();
  const { summary, fetchSummary } = useTaxStore();
  const { list, fetchList } = useShoppingListStore();

  useEffect(() => {
    fetchTransactions({ month: MONTH, year: YEAR });
    fetchSummary();
    fetchList();
  }, [fetchTransactions, fetchSummary, fetchList]);

  const saldo = useMemo(() => {
    let income = 0, expense = 0, tax = 0;
    for (const t of transactions) {
      if (t.type === "INCOME") { income += t.amount; tax += t.taxAmount || 0; }
      else { expense += t.amount; }
    }
    return income - expense - tax;
  }, [transactions]);

  const due = useMemo(() => list.filter((i) => i.isDue), [list]);

  return (
    <div className="space-y-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold">Riepilogo rapido</h1>

      {/* Saldo mese */}
      <Link to="/" className="block card p-5 text-center">
        <div className="text-sm text-ink-600">Saldo mese {String(MONTH).padStart(2, "0")}/{YEAR}</div>
        <div className={`text-4xl font-bold mt-1 nums ${saldo >= 0 ? "text-brand-600" : "text-ink-900"}`}>
          {eur(saldo)}
        </div>
      </Link>

      {/* Tasse accantonate */}
      <Link to="/tax-savings" className="block card p-4 flex items-center justify-between">
        <span className="text-sm text-ink-600">Tasse accantonate</span>
        <span className="text-xl font-bold text-tax-600 nums">{eur(summary?.totalPending)}</span>
      </Link>

      {/* Prodotti da ricomprare */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-ink-600">Da ricomprare</span>
          <Link to="/shopping-list" className="text-brand-600 text-xs hover:underline">
            lista completa →
          </Link>
        </div>
        {due.length === 0 ? (
          <p className="text-sm text-ink-400">Niente da ricomprare al momento. 🎉</p>
        ) : (
          <ul className="divide-y divide-card-line">
            {due.map((i) => (
              <li key={i.canonicalName} className="py-2 flex items-center justify-between text-sm">
                <span className="capitalize">{i.canonicalName}</span>
                <span className="text-ink-400 text-xs">
                  {i.category}{i.lastStore ? ` · ${i.lastStore}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
