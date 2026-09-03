import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";
import { useAccountStore } from "../store/accountStore.js";

// "Dove vanno i soldi": resoconto delle uscite del mese (o dell'anno) per
// negozio, categoria e cosa hai comprato. Somma TUTTI i movimenti: inseriti a
// mano, importati dall'estratto, scontrini fotografati, ricorrenze.

const now = dayjs();

function Bars({ rows, labelKey, total, onPick }) {
  if (!rows.length) return <p className="p-4 text-[13px] text-ink-400">Niente da mostrare in questo periodo.</p>;
  const max = rows[0].total || 1;
  return (
    <ul className="divide-y divide-card-line">
      {rows.map((r) => (
        <li key={r[labelKey]} className="px-4 py-2.5">
          <button type="button" onClick={() => onPick?.(r)} className="w-full text-left">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium">{r[labelKey]}{r.category && labelKey !== "category" ? <span className="text-ink-400 font-normal"> · {r.category}</span> : null}</span>
              <span className="shrink-0 nums font-semibold">{eur(r.total)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-paper overflow-hidden"><div className="h-full bg-brand-600" style={{ width: `${Math.max(2, (r.total / max) * 100)}%` }} /></div>
              <span className="text-[13px] text-ink-400 nums w-24 text-right">{total ? Math.round((r.total / total) * 100) : 0}% · {r.count}×</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SpendingPage() {
  const navigate = useNavigate();
  const accounts = useAccountStore((s) => s.accounts);
  const accountsLoaded = useAccountStore((s) => s.loaded);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  const [period, setPeriod] = useState({ mode: "month", month: now.month(), year: now.year() });
  const [accountId, setAccountId] = useState("");
  const [view, setView] = useState("merchant");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!accountsLoaded) fetchAccounts().catch(() => {}); }, [accountsLoaded, fetchAccounts]);

  const start = period.mode === "month" ? dayjs(new Date(period.year, period.month, 1)) : dayjs(new Date(period.year, 0, 1));
  const end = period.mode === "month" ? start.endOf("month") : start.endOf("year");
  useEffect(() => {
    setLoading(true);
    api.get("/api/analytics/spending", { params: { from: start.format("YYYY-MM-DD"), to: end.format("YYYY-MM-DDT23:59:59"), ...(accountId && { accountId }) } })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, accountId]);

  const shift = (n) => setPeriod((p) => {
    if (p.mode === "year") return { ...p, year: p.year + n };
    const d = dayjs(new Date(p.year, p.month, 1)).add(n, "month");
    return { ...p, month: d.month(), year: d.year() };
  });
  const isCurrent = period.mode === "month" ? period.month === now.month() && period.year === now.year() : period.year === now.year();
  const label = period.mode === "month" ? start.format("MMMM YYYY") : String(period.year);

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Dove vanno i soldi</h1>
      <div className="flex flex-wrap gap-2 items-center">
        <Segmented size="sm" value={period.mode} onChange={(m) => setPeriod((p) => ({ ...p, mode: m }))} options={[{ value: "month", label: "Mese" }, { value: "year", label: "Anno" }]} />
        {accounts.length > 1 && (
          <Segmented size="sm" value={accountId} onChange={setAccountId} options={[{ value: "", label: "Tutti i conti" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} className="w-11 h-11 -ml-2 text-ink-600 text-xl" aria-label="Periodo precedente">‹</button>
          <div className="text-[13px] text-ink-600 capitalize">{label}</div>
          <button type="button" onClick={() => shift(1)} disabled={isCurrent} className="w-11 h-11 -mr-2 text-ink-600 text-xl disabled:opacity-30" aria-label="Periodo successivo">›</button>
        </div>
        <div className="text-3xl font-bold nums text-center">{data ? eur(data.total) : "…"}</div>
        {data && (
          <div className="text-[13px] text-center text-ink-600 mt-1">
            {data.count} uscite · fisse {eur(data.fixed)} · variabili {eur(data.variable)}
          </div>
        )}
        {data && data.withoutMerchant.count > 0 && (
          <p className="text-[13px] text-tax-600 text-center mt-1">
            {eur(data.withoutMerchant.total)} in {data.withoutMerchant.count} movimenti senza "Dove": aprili e aggiungilo per un resoconto completo.
          </p>
        )}
      </div>

      <Segmented
        value={view}
        onChange={setView}
        options={[{ value: "merchant", label: "Dove" }, { value: "category", label: "Categoria" }, { value: "what", label: "Cosa" }]}
        className="[&>button]:flex-1"
      />

      <div className="card">
        {loading && !data ? (
          <p className="p-4 text-[13px] text-ink-400">Caricamento…</p>
        ) : !data ? (
          <p className="p-4 text-[13px] text-rose-600">Resoconto non disponibile.</p>
        ) : view === "merchant" ? (
          <Bars rows={data.byMerchant} labelKey="merchant" total={data.total} />
        ) : view === "category" ? (
          <Bars rows={data.byCategory} labelKey="category" total={data.total} />
        ) : (
          <Bars rows={data.byWhat} labelKey="what" total={data.total} />
        )}
      </div>

      <p className="text-[13px] text-ink-400">
        Il resoconto somma tutto: spese a mano, estratto conto importato, scontrini e ricorrenze. Per i prodotti dentro gli scontrini vedi <button type="button" onClick={() => navigate("/analytics")} className="underline text-brand-600">Analisi</button>.
      </p>
    </div>
  );
}
