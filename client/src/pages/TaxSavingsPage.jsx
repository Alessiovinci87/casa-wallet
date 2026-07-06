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

      <div className="bg-tax-50 border border-card-line rounded-xl p-6 text-center">
        <div className="text-sm text-tax-600">Da accantonare (non trasferito)</div>
        <div className="text-4xl font-bold text-tax-600 mt-2 nums">{eur(summary?.totalPending)}</div>
      </div>

      <div className="card divide-y divide-card-line">
        {!items || items.length === 0 ? (
          <p className="p-4 text-sm text-ink-400">Nessun accantonamento.</p>
        ) : (
          items.map((it) => (
            <div key={it.id} className="p-3 flex items-center justify-between text-sm">
              <div>
                <span className="font-medium">{dayjs().month(it.month - 1).format("MMMM")} {it.year}</span>
                <span className="text-tax-600 ml-2 nums">{eur(it.amount)}</span>
              </div>
              {it.transferred ? (
                <span className="text-brand-600 text-xs">
                  Trasferito{it.transferredAt ? ` · ${dayjs(it.transferredAt).format("DD/MM/YYYY")}` : ""}
                </span>
              ) : (
                <button
                  onClick={() => markTransferred(it.id)}
                  className="px-3 py-1 bg-tax-600 text-white rounded text-xs hover:opacity-90"
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
