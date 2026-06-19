import { useEffect, useState } from "react";
import { useBudgetStore } from "../store/budgetStore.js";
import { CATEGORIES } from "../lib/constants.js";
import { eur } from "../lib/format.js";

// Color of the progress bar by usage: green < 80%, amber 80–100%, red > 100%.
function barColor(percent, over) {
  if (over || percent > 100) return "bg-rose-500";
  if (percent >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

function BudgetRow({ b, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(b.amount);

  const save = async () => {
    await onSave(b.category, Number(amount));
    setEditing(false);
  };

  const warn = b.percent >= 80;

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{b.category}</span>
        <div className="flex items-center gap-3 text-sm">
          {editing ? (
            <>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-24 px-2 py-1 border border-slate-300 rounded"
              />
              <button onClick={save} className="text-emerald-600 hover:underline">Salva</button>
              <button onClick={() => { setEditing(false); setAmount(b.amount); }} className="text-slate-400">Annulla</button>
            </>
          ) : (
            <>
              <span className="text-slate-500">{eur(b.spent)} / {eur(b.amount)}</span>
              <button onClick={() => setEditing(true)} className="text-slate-300 hover:text-emerald-600" title="Modifica">✎</button>
              <button onClick={() => onRemove(b.id)} className="text-slate-300 hover:text-rose-600" title="Elimina">✕</button>
            </>
          )}
        </div>
      </div>

      <div className="bg-slate-100 rounded h-3 overflow-hidden">
        <div
          className={`h-3 rounded ${barColor(b.percent, b.over)}`}
          style={{ width: `${Math.min(b.percent, 100)}%` }}
        />
      </div>

      <div className={`text-xs ${warn ? "text-rose-600 font-medium" : "text-slate-400"}`}>
        {b.over
          ? `Budget superato di ${eur(b.spent - b.amount)} (${b.percent}%)`
          : warn
            ? `Attenzione: hai usato il ${b.percent}% del budget`
            : `${b.percent}% utilizzato`}
      </div>
    </div>
  );
}

export default function BudgetsPage() {
  const { budgets, loading, fetchBudgets, saveBudget, removeBudget } = useBudgetStore();
  const [category, setCategory] = useState(CATEGORIES.EXPENSE[0]);
  const [amount, setAmount] = useState("");

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const add = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    await saveBudget(category, Number(amount));
    setAmount("");
  };

  // Categories that don't have a budget yet (avoid duplicate selects).
  const usedCategories = new Set(budgets.map((b) => b.category));
  const available = CATEGORIES.EXPENSE.filter((c) => !usedCategories.has(c));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Budget per categoria</h1>
      <p className="text-sm text-slate-500">
        Imposta un tetto di spesa mensile per categoria. La barra mostra la spesa del mese corrente.
      </p>

      {available.length > 0 && (
        <form onSubmit={add} className="bg-white rounded-xl p-3 shadow-sm flex flex-wrap gap-3 text-sm items-center">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-2 py-1 border border-slate-300 rounded">
            {available.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="number"
            placeholder="Importo €"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 px-2 py-1 border border-slate-300 rounded"
          />
          <button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700">
            Aggiungi
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Caricamento…</p>
      ) : budgets.length === 0 ? (
        <p className="text-sm text-slate-400">Nessun budget impostato.</p>
      ) : (
        <div className="space-y-3">
          {budgets.map((b) => (
            <BudgetRow key={b.id} b={b} onSave={saveBudget} onRemove={removeBudget} />
          ))}
        </div>
      )}
    </div>
  );
}
