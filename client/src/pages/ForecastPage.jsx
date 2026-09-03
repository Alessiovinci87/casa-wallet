import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";

// Prossimi 90 giorni: saldo proiettato (ricorrenze + scadenze fiscali + incassi
// attesi + quote obiettivi), giorni in rosso se il disponibile scende sotto zero.
const ForecastChart = lazy(() => import("../components/ForecastChart.jsx"));

const KIND = {
  recurring: { label: "Ricorrenza", cls: "bg-brand-50 text-brand-700" },
  deadline: { label: "Scadenza fiscale", cls: "bg-tax-50 text-tax-600" },
  collection: { label: "Incasso atteso", cls: "bg-emerald-50 text-emerald-700" },
  goal: { label: "Obiettivi", cls: "bg-paper text-ink-600" },
};

export default function ForecastPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(90);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api
      .get("/api/forecast", { params: { days } })
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.error || "Previsione non disponibile"));
  }, [days]);

  const eventsByDay = data ? data.daily.filter((d) => d.events && d.events.length) : [];
  // Timeline per settimana, con il minimo della settimana in testa.
  const weeks = [];
  for (const d of eventsByDay) {
    const start = dayjs(d.date).startOf("week");
    const k = start.format("YYYY-MM-DD");
    if (!weeks.length || weeks[weeks.length - 1].k !== k) weeks.push({ k, start, days: [] });
    weeks[weeks.length - 1].days.push(d);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Prossimi {days} giorni</h1>
        <Segmented
          size="sm"
          value={days}
          onChange={setDays}
          options={[{ value: 30, label: "30" }, { value: 60, label: "60" }, { value: 90, label: "90" }, { value: 180, label: "180" }]}
        />
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {data && (
        <>
          {/* Verdetto */}
          <div className={`rounded-2xl p-5 text-white ${data.daysNegative > 0 ? "bg-rose-600" : data.daysLow > 0 ? "bg-tax-600" : "bg-brand-600"}`}>
            <div className="text-[11px] uppercase tracking-widest text-white/70">
              {data.daysNegative > 0 ? "Attenzione" : data.daysLow > 0 ? "Margine stretto" : "Ce la fai"}
            </div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
              {data.daysNegative > 0
                ? <>Sotto zero dal {dayjs(data.firstNegative).format("D MMMM")}</>
                : data.daysLow > 0
                  ? <>Minimo {eur(data.minBalance)} il {dayjs(data.minDate).format("D MMMM")}</>
                  : <>Minimo {eur(data.minBalance)} il {dayjs(data.minDate).format("D MMMM")}</>}
            </div>
            <div className="mt-2 text-sm text-white/85 nums">
              Base: Disponibile reale di oggi prima delle fisse del mese ({eur(data.startBalance)}, le fisse rientrano come eventi) → tra {days} giorni {eur(data.endBalance)}
              {data.daysNegative > 0 && <> · minimo {eur(data.minBalance)} il {dayjs(data.minDate).format("D/M")}</>}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-semibold text-ink-600 mb-2">Saldo proiettato</h2>
            <Suspense fallback={<div className="h-60 animate-pulse bg-paper rounded" />}>
              <ForecastChart daily={data.daily} threshold={data.threshold} />
            </Suspense>
            <p className="text-[11px] text-ink-400 mt-2">{data.disclaimer}</p>
          </div>

          {/* Totali per tipo */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {[
              ["Uscite fisse", data.totals.recurringOut],
              ["Entrate fisse", data.totals.recurringIn],
              ["Scadenze (scoperte)", data.totals.deadlines],
              ["Incassi attesi", data.totals.collections],
              ["Quote obiettivi", data.totals.goals],
            ].map(([l, v]) => (
              <div key={l} className="card p-3">
                <div className="text-ink-400">{l}</div>
                <div className={`font-semibold nums ${v < 0 ? "text-ink-900" : "text-brand-600"}`}>{v > 0 ? "+" : ""}{eur(v)}</div>
              </div>
            ))}
          </div>

          {/* Timeline eventi, per settimana */}
          <div className="space-y-3">
            {eventsByDay.length === 0 ? (
              <p className="card p-4 text-sm text-ink-400">Nessun evento previsto. Aggiungi ricorrenze e scadenze per una previsione utile.</p>
            ) : (
              weeks.map((w) => (
              <div key={w.k} className="card divide-y divide-card-line">
                <div className="px-3 py-2 text-[13px] font-semibold text-ink-600 flex justify-between">
                  <span>Settimana {w.start.format("D MMM")} – {w.start.add(6, "day").format("D MMM")}</span>
                  <span className={`nums ${Math.min(...w.days.map((d) => d.balance)) < 0 ? "text-rose-600" : ""}`}>min {eur(Math.min(...w.days.map((d) => d.balance)))}</span>
                </div>
              {w.days.map((d) => (
                <div key={d.date} className={`p-3 ${d.flag === "NEGATIVE" ? "bg-rose-50/60" : d.flag === "LOW" ? "bg-tax-50/40" : ""}`}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-ink-900">{dayjs(d.date).format("ddd D MMMM")}</span>
                    <span className={`nums font-semibold ${d.balance < 0 ? "text-rose-600" : "text-ink-600"}`}>
                      saldo {eur(d.balance)}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {d.events.map((e, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${KIND[e.kind]?.cls}`}>{KIND[e.kind]?.label}</span>
                          <span className="truncate">{e.label}{e.estimated ? " (stima)" : ""}</span>
                        </div>
                        <span className={`shrink-0 nums font-medium ${d.flag === "NEGATIVE" && e.amount < 0 ? "text-rose-600" : e.amount < 0 ? "text-ink-900" : "text-brand-600"}`}>
                          {e.amount > 0 ? "+" : e.amount < 0 ? "−" : ""}{eur(Math.abs(e.amount))}
                          {e.kind === "deadline" && e.coveredByFund > 0 && (
                            <span className="text-[10px] text-ink-400 ml-1">({eur(e.coveredByFund)} dal fondo)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <button onClick={() => navigate("/movements?tab=recurring")} className="px-3 py-1.5 border border-card-line rounded-lg text-ink-600">Ricorrenze</button>
            <button onClick={() => navigate("/treasury")} className="px-3 py-1.5 border border-card-line rounded-lg text-ink-600">Scadenze</button>
            <button onClick={() => navigate("/goals")} className="px-3 py-1.5 border border-card-line rounded-lg text-ink-600">Obiettivi</button>
          </div>
        </>
      )}
    </div>
  );
}
