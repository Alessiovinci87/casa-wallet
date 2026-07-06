import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useAnalyticsStore } from "../store/analyticsStore.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";

const PRESETS = {
  month: { label: "Mese corrente", range: () => ({ from: dayjs().startOf("month").format("YYYY-MM-DD"), to: dayjs().endOf("month").format("YYYY-MM-DD") }) },
  q: { label: "Ultimi 3 mesi", range: () => ({ from: dayjs().subtract(3, "month").format("YYYY-MM-DD"), to: dayjs().format("YYYY-MM-DD") }) },
  year: { label: "Anno", range: () => ({ from: dayjs().startOf("year").format("YYYY-MM-DD"), to: dayjs().endOf("year").format("YYYY-MM-DD") }) },
  custom: { label: "Personalizzato", range: () => ({}) },
};

export default function AnalyticsPage() {
  const { byCategory, byStore, topProducts, storeComparison, trend, loading, fetchAll, fetchTrend, clearTrend } = useAnalyticsStore();
  const [preset, setPreset] = useState("q");
  const [custom, setCustom] = useState({ from: "", to: "" });

  useEffect(() => {
    const range = preset === "custom" ? custom : PRESETS[preset].range();
    fetchAll(range);
  }, [preset, custom, fetchAll]);

  const catTotal = byCategory.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Analisi spese</h1>
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Segmented
            size="sm"
            value={preset}
            onChange={setPreset}
            options={Object.entries(PRESETS).map(([k, p]) => ({ value: k, label: p.label }))}
          />
          {preset === "custom" && (
            <>
              <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="px-2 py-1 border border-card-line rounded" />
              <span>→</span>
              <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="px-2 py-1 border border-card-line rounded" />
            </>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-ink-400">Caricamento…</p>}

      {/* Spesa per categoria */}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">Spesa per categoria</h2>
        {byCategory.length === 0 ? (
          <p className="text-sm text-ink-400">Nessun dato nel periodo.</p>
        ) : (
          <div className="space-y-2">
            {byCategory.map((c) => {
              const pct = catTotal ? (c.total / catTotal) * 100 : 0;
              return (
                <div key={c.category} className="text-sm">
                  <div className="flex justify-between mb-0.5">
                    <span>{c.category} <span className="text-ink-400">({c.count})</span></span>
                    <span className="font-medium nums">{eur(c.total)} · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-paper rounded">
                    <div className="h-2 bg-brand-500 rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Spesa per negozio */}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">Spesa per negozio</h2>
        {byStore.length === 0 ? (
          <p className="text-sm text-ink-400">Nessun dato nel periodo.</p>
        ) : (
          <div className="divide-y divide-card-line text-sm">
            {byStore.map((s) => (
              <div key={s.store ?? "—"} className="py-2 flex justify-between">
                <span>{s.store ?? "Sconosciuto"} <span className="text-ink-400">· {s.receiptCount} scontrini</span></span>
                <span className="font-medium nums">{eur(s.total)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Dove conviene comprare (confronto prezzo medio per categoria tra negozi) */}
      {storeComparison.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-1">Dove conviene comprare</h2>
          <p className="text-xs text-ink-400 mb-3">
            Prezzo unitario medio per categoria nei vari negozi. In verde il più conveniente.
          </p>
          <div className="space-y-4">
            {storeComparison.map((c) => (
              <div key={c.category}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium">{c.category}</span>
                  <span className="text-brand-600 text-xs">
                    Conviene: <span className="font-semibold">{c.cheapest}</span>
                  </span>
                </div>
                <div className="divide-y divide-card-line text-sm">
                  {c.stores.map((s, i) => (
                    <div
                      key={s.store}
                      className={`py-1 flex justify-between ${i === 0 ? "text-brand-600 font-medium" : "text-ink-600"}`}
                    >
                      <span>{i === 0 ? "✓ " : ""}{s.store} <span className="text-ink-400 font-normal">· {s.count} acquisti</span></span>
                      <span className="nums">{eur(s.avgUnitPrice)}/u</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Top prodotti */}
      <section className="card p-4">
        <h2 className="font-semibold mb-3">Prodotti su cui spendi di più</h2>
        {topProducts.length === 0 ? (
          <p className="text-sm text-ink-400">Nessun dato nel periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-ink-400 text-left">
                <tr>
                  <th className="py-1">Prodotto</th>
                  <th>Categoria</th>
                  <th className="text-right">Totale</th>
                  <th className="text-right">Volte</th>
                  <th className="text-right">Prezzo medio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-line">
                {topProducts.map((p) => (
                  <tr key={p.canonicalName}>
                    <td className="py-1.5 capitalize">{p.canonicalName}</td>
                    <td className="text-ink-600">{p.category}</td>
                    <td className="text-right font-medium nums">{eur(p.totalSpent)}</td>
                    <td className="text-right nums">{p.timesBought}</td>
                    <td className="text-right nums">{p.avgPrice != null ? eur(p.avgPrice) : "—"}</td>
                    <td className="text-right">
                      <button onClick={() => fetchTrend(p.canonicalName)} className="text-brand-600 hover:underline text-xs">trend</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Trend prezzo prodotto */}
      {trend && (
        <section className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold capitalize">Andamento prezzo · {trend.canonicalName}</h2>
            <button onClick={clearTrend} className="text-ink-400 hover:text-ink-900 text-sm">✕ chiudi</button>
          </div>
          {trend.rows.length === 0 ? (
            <p className="text-sm text-ink-400">Nessuno storico per questo prodotto.</p>
          ) : (
            <PriceTrend rows={trend.rows} />
          )}
        </section>
      )}
    </div>
  );
}

// Simple price-over-time view: a sparkline-like bar per purchase + table.
function PriceTrend({ rows }) {
  const prices = rows.map((r) => r.unitPrice ?? r.totalPrice ?? 0);
  const max = Math.max(...prices, 0.01);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const delta = first ? ((last - first) / first) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1 h-24">
        {rows.map((r, i) => {
          const v = r.unitPrice ?? r.totalPrice ?? 0;
          return (
            <div
              key={i}
              className="flex-1 bg-brand-400 rounded-t"
              style={{ height: `${(v / max) * 100}%` }}
              title={`${dayjs(r.date).format("DD/MM/YY")} · ${eur(v)}${r.store ? " · " + r.store : ""}`}
            />
          );
        })}
      </div>
      <p className={`text-sm nums ${delta > 0 ? "text-rose-600" : delta < 0 ? "text-brand-600" : "text-ink-600"}`}>
        Variazione dal primo all'ultimo acquisto: {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
      </p>
      <div className="divide-y divide-card-line text-sm">
        {rows.map((r, i) => (
          <div key={i} className="py-1 flex justify-between">
            <span className="text-ink-600">{dayjs(r.date).format("DD/MM/YYYY")}{r.store ? ` · ${r.store}` : ""}</span>
            <span className="font-medium nums">{eur(r.unitPrice ?? r.totalPrice ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
