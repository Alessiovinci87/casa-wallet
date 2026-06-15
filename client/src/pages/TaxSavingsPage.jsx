import { useEffect } from "react";
import dayjs from "dayjs";
import { useTaxStore } from "../store/taxStore.js";
import { eur } from "../lib/format.js";

export default function TaxSavingsPage() {
  const { summary, items, fetchSummary, markTransferred } = useTaxStore();

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Salvadanaio tasse</h1>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <div className="text-sm text-amber-700">Da accantonare (non trasferito)</div>
        <div className="text-4xl font-bold text-amber-700 mt-2">{eur(summary?.totalPending)}</div>
      </div>

      <div className="bg-white rounded-xl shadow-sm divide-y divide-slate-100">
        {!items || items.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Nessun accantonamento.</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="p-3 flex items-center justify-between text-sm">
              <div>
                <span className="font-medium">{dayjs().month(it.month - 1).format("MMMM")} {it.year}</span>
                <span className="text-slate-400 ml-2">{eur(it.amount)}</span>
              </div>
              {it.transferred ? (
                <span className="text-emerald-600 text-xs">
                  Trasferito{it.transferredAt ? ` · ${dayjs(it.transferredAt).format("DD/MM/YYYY")}` : ""}
                </span>
              ) : (
                <button
                  onClick={() => markTransferred(it.id)}
                  className="px-3 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700"
                >
                  Segna come trasferito
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
