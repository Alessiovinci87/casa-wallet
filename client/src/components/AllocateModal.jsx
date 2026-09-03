import { useEffect, useState } from "react";
import { useGoalStore } from "../store/goalStore.js";
import { eur } from "../lib/format.js";

const KIND_LABELS = { GOAL: "Obiettivo", SINKING: "Spesa periodica", BUFFER: "Cuscinetto" };

// "Distribuisci": l'app propone il riparto di un importo sugli obiettivi attivi
// (prima le spese periodiche in scadenza, poi gli obiettivi, poi i cuscinetti);
// l'utente conferma o modifica. `incomeTransactionId` → netto post-tasse
// dell'entrata; altrimenti `amount`.
export default function AllocateModal({ amount, incomeTransactionId, onClose, onDone }) {
  const propose = useGoalStore((s) => s.propose);
  const confirmAllocation = useGoalStore((s) => s.confirmAllocation);
  const [proposal, setProposal] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    propose(incomeTransactionId ? { incomeTransactionId } : { amount })
      .then((p) => {
        setProposal(p);
        setRows(p.allocations.map((a) => ({ ...a, amount: String(a.amount) })));
      })
      .catch((err) => setError(err.response?.data?.error || "Proposta non disponibile"));
  }, [amount, incomeTransactionId, propose]);

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const base = proposal?.amount ?? amount ?? 0;
  const left = Number((base - total).toFixed(2));

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const allocations = rows.map((r) => ({ goalId: r.goalId, amount: Number(r.amount) || 0 })).filter((r) => r.amount > 0);
      if (allocations.length === 0) throw new Error("Nessun importo da versare");
      await confirmAllocation(allocations, { note: incomeTransactionId ? "Distribuisci entrata" : "Distribuisci" });
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Errore");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold">Distribuisci sugli obiettivi</h2>
        <p className="text-sm text-ink-600 mt-1">
          {proposal?.source
            ? <>Netto dopo le tasse: <span className="font-semibold nums">{eur(base)}</span> <span className="text-ink-400">(lordo {eur(proposal.source.gross)} − tasse {eur(proposal.source.tax)})</span></>
            : <>Importo: <span className="font-semibold nums">{eur(base)}</span></>}
        </p>

        {error && <div className="mt-3 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        {!proposal && !error ? (
          <p className="mt-4 text-sm text-ink-400">Calcolo la proposta…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400">Nessun obiettivo attivo da alimentare: tutto resta disponibile.</p>
        ) : (
          <ul className="mt-4 divide-y divide-card-line">
            {rows.map((r, i) => (
              <li key={r.goalId} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.icon ? `${r.icon} ` : ""}{r.name}</div>
                  <div className="text-[11px] text-ink-400">
                    {KIND_LABELS[r.kind]}
                    {r.monthRemainingBefore != null && ` · quota del mese ancora da versare ${eur(r.monthRemainingBefore)}`}
                  </div>
                </div>
                <input
                  type="number" step="0.01" min="0"
                  value={r.amount}
                  onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  className="w-28 px-2 py-1.5 border border-card-line rounded nums text-right"
                />
              </li>
            ))}
          </ul>
        )}

        {proposal && rows.length > 0 && (
          <div className={`mt-3 text-sm flex justify-between ${left < 0 ? "text-rose-600" : "text-ink-600"}`}>
            <span>Resta disponibile</span>
            <span className="font-semibold nums">{eur(left)}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:text-ink-900">
            {rows.length === 0 ? "Chiudi" : "Non ora"}
          </button>
          {rows.length > 0 && (
            <button
              type="button" disabled={saving || left < 0}
              onClick={submit}
              className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Verso…" : `Parcheggia ${eur(total)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
