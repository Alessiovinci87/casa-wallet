import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useShoppingListStore } from "../store/shoppingListStore.js";
import { eur } from "../lib/format.js";

// Urgency styling from daysRemaining.
function urgency(p) {
  if (p.daysRemaining == null) return { ring: "border-amber-300 bg-amber-50", label: "ricorrente" };
  if (p.daysRemaining < 0) return { ring: "border-rose-300 bg-rose-50", label: `in ritardo di ${-p.daysRemaining}g` };
  if (p.daysRemaining <= 3) return { ring: "border-amber-300 bg-amber-50", label: `tra ${p.daysRemaining}g` };
  return { ring: "border-card-line bg-white", label: `tra ${p.daysRemaining}g` };
}

function ProductCard({ p, onDismiss, onAlways }) {
  const u = urgency(p);
  return (
    <div className={`rounded-xl p-3 border ${u.ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium capitalize">{p.canonicalName}</div>
          <div className="text-ink-600 text-xs nums">
            {p.category}
            {p.timesBought > 0 && ` · comprato ${p.timesBought}×`}
            {p.avgIntervalDays != null && ` · ogni ~${p.avgIntervalDays}g`}
          </div>
          {p.lastPurchase && (
            <div className="text-ink-400 text-xs nums">
              ultimo: {dayjs(p.lastPurchase).format("DD/MM/YY")}
              {p.lastStore ? ` · ${p.lastStore}` : ""}
              {p.avgPrice != null ? ` · ~${eur(p.avgPrice)}` : ""}
            </div>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${p.isDue ? "bg-rose-600 text-white" : "bg-paper text-ink-600"}`}>
          {u.label}
        </span>
      </div>
      <div className="flex gap-3 mt-2 text-xs">
        <button onClick={() => onDismiss(p.canonicalName)} className="text-ink-400 hover:text-rose-600">Rimuovi</button>
        {!p.isRecurring && (
          <button onClick={() => onAlways(p.canonicalName)} className="text-brand-600 hover:underline">Compro sempre</button>
        )}
      </div>
    </div>
  );
}

export default function ShoppingListPage() {
  const { list, recurring, loading, fetchList, fetchRecurring, dismiss, setRecurring, removeRecurring } =
    useShoppingListStore();
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetchList();
    fetchRecurring();
  }, [fetchList, fetchRecurring]);

  const due = list.filter((p) => p.isDue);
  const upcoming = list.filter((p) => !p.isDue && p.avgIntervalDays != null);
  const notPredictable = list.filter((p) => !p.isDue && p.avgIntervalDays == null);

  const markAlways = (canonicalName) => setRecurring({ canonicalName, alwaysBuy: true });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Lista della spesa</h1>
      {loading && <p className="text-sm text-ink-400">Caricamento…</p>}

      {/* Da ricomprare */}
      <section>
        <h2 className="font-semibold mb-2">Da ricomprare ({due.length})</h2>
        {due.length === 0 ? (
          <p className="text-sm text-ink-400">Niente da ricomprare per ora. 🎉</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {due.map((p) => <ProductCard key={p.canonicalName} p={p} onDismiss={dismiss} onAlways={markAlways} />)}
          </div>
        )}
      </section>

      {/* In arrivo */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">In arrivo</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {upcoming.map((p) => <ProductCard key={p.canonicalName} p={p} onDismiss={dismiss} onAlways={markAlways} />)}
          </div>
        </section>
      )}

      {/* Ricorrenti fissi */}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">Prodotti ricorrenti fissi</h2>
        <div className="flex gap-2 mb-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome prodotto (es. caffè macinato)"
            className="flex-1 px-2 py-1 border border-card-line rounded text-sm"
          />
          <button
            onClick={() => { if (newName.trim()) { setRecurring({ canonicalName: newName.trim().toLowerCase(), alwaysBuy: true }); setNewName(""); } }}
            className="px-3 py-1 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
          >Aggiungi</button>
        </div>
        {recurring.length === 0 ? (
          <p className="text-sm text-ink-400">Nessun prodotto ricorrente.</p>
        ) : (
          <div className="divide-y divide-card-line text-sm">
            {recurring.map((r) => (
              <div key={r.id} className="py-2 flex items-center justify-between gap-2">
                <span className="capitalize flex-1">{r.canonicalName} {r.alwaysBuy && <span className="text-xs text-brand-600">(sempre)</span>}</span>
                <label className="text-xs text-ink-600 flex items-center gap-1">
                  ogni
                  <input
                    type="number" min="1"
                    defaultValue={r.intervalDays ?? ""}
                    placeholder="auto"
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== (r.intervalDays ?? null)) setRecurring({ canonicalName: r.canonicalName, alwaysBuy: r.alwaysBuy, intervalDays: v });
                    }}
                    className="w-16 px-1 py-0.5 border border-card-line rounded nums"
                  />
                  g
                </label>
                <button onClick={() => removeRecurring(r.canonicalName)} className="text-ink-400 hover:text-rose-600" title="Rimuovi">✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Non ancora prevedibili */}
      {notPredictable.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2 text-ink-600">Non ancora prevedibili</h2>
          <p className="text-xs text-ink-400 mb-2">Comprati una sola volta: servono almeno 2 acquisti per stimare la frequenza.</p>
          <div className="flex flex-wrap gap-2">
            {notPredictable.map((p) => (
              <span key={p.canonicalName} className="text-xs bg-paper text-ink-600 rounded-full px-3 py-1 capitalize">
                {p.canonicalName}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
