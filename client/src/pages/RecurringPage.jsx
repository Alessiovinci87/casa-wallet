import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useRecurringStore } from "../store/recurringStore.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS, FREQUENCY_LABELS, WEEKDAY_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";
import RecurrenceFields, { emptyRecurrence, recurrenceToPayload } from "../components/RecurrenceFields.jsx";

// Ricorrenze: entrate/uscite fisse della famiglia. Lista con prossimo addebito,
// importo mensile equivalente, totali fisse/mese, attiva/disattiva, modifica,
// conferma/salta per le regole con conferma manuale.

function scheduleLabel(r) {
  const freq = FREQUENCY_LABELS[r.frequency] || r.frequency;
  if (r.frequency === "WEEKLY") {
    return r.weekday != null ? `${freq} · ${WEEKDAY_LABELS[r.weekday]}` : freq;
  }
  const day = r.dayOfMonth ?? dayjs(r.startDate).date();
  return `${freq} · il ${day === 31 ? "ultimo del mese" : day}`;
}

const emptyRule = {
  type: "EXPENSE",
  amount: "",
  category: "",
  method: "CARD",
  description: "",
  startDate: new Date().toISOString().slice(0, 10),
};

function RuleForm({ initial, onClose }) {
  const createRule = useRecurringStore((s) => s.createRule);
  const updateRule = useRecurringStore((s) => s.updateRule);
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    ...emptyRule,
    ...(initial && {
      type: initial.type,
      amount: initial.amount,
      category: initial.category,
      method: initial.method,
      description: initial.description || "",
      startDate: String(initial.startDate).slice(0, 10),
    }),
  }));
  const [rec, setRec] = useState(() =>
    initial
      ? {
          frequency: initial.frequency,
          dayOfMonth: initial.dayOfMonth ?? "",
          weekday: initial.weekday ?? "",
          endDate: initial.endDate ? String(initial.endDate).slice(0, 10) : "",
          autoPost: initial.autoPost,
        }
      : emptyRecurrence
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.category) return setError("Scegli una categoria");
    setSaving(true);
    setError("");
    const payload = {
      type: form.type,
      amount: Number(form.amount),
      category: form.category,
      method: form.method,
      description: form.description || null,
      startDate: new Date(form.startDate).toISOString(),
      ...recurrenceToPayload(rec),
    };
    try {
      if (isEdit) await updateRule(initial.id, payload);
      else await createRule(payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Errore salvataggio");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <form onSubmit={submit} className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-3">
        <h2 className="text-lg font-semibold">{isEdit ? "Modifica ricorrenza" : "Nuova ricorrenza"}</h2>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        <div>
          <label className="block text-xs text-ink-600 mb-1">Tipo</label>
          <Segmented
            value={form.type}
            onChange={(v) => { set("type", v); if (!CATEGORIES[v].includes(form.category)) set("category", ""); }}
            options={[{ value: "EXPENSE", label: "Uscita" }, { value: "INCOME", label: "Entrata" }]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Importo €</label>
            <input type="number" step="0.01" min="0" required value={form.amount} onChange={(e) => set("amount", e.target.value)} className="w-full px-2 py-2 border border-card-line rounded nums" />
          </div>
          <div>
            <label className="block text-xs text-ink-600 mb-1">{isEdit ? "Inizio" : "Prima data"}</label>
            <input type="date" required value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className="w-full px-2 py-2 border border-card-line rounded" />
          </div>
        </div>
        <div>
          <label className="block text-xs text-ink-600 mb-1">Categoria</label>
          <Segmented size="sm" value={form.category} onChange={(v) => set("category", v)} options={CATEGORIES[form.type].map((c) => ({ value: c, label: c }))} />
        </div>
        <div>
          <label className="block text-xs text-ink-600 mb-1">Metodo</label>
          <Segmented size="sm" value={form.method} onChange={(v) => set("method", v)} options={PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }))} />
        </div>
        <div>
          <label className="block text-xs text-ink-600 mb-1">Descrizione</label>
          <input type="text" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="es. Rata auto" className="w-full px-2 py-2 border border-card-line rounded" />
        </div>

        <div className="border-t border-card-line pt-3">
          <RecurrenceFields value={rec} onChange={setRec} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:text-ink-900">Annulla</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Salvo…" : "Salva"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RecurringPage() {
  const { rules, monthlyFixedExpense, monthlyFixedIncome, loading, fetchRules, updateRule, deleteRule, confirmPending, skipPending } = useRecurringStore();
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const visible = rules.filter((r) => filter === "ALL" || r.type === filter);
  const pending = rules.filter((r) => r.pendingAt);

  const toggleActive = async (r) => {
    try { await updateRule(r.id, { active: !r.active }); } catch { window.alert("Operazione non riuscita"); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Eliminare la ricorrenza "${r.description || r.category}"? Le transazioni già registrate restano.`)) return;
    try { await deleteRule(r.id); } catch { window.alert("Eliminazione non riuscita"); }
  };
  const confirm = async (r) => {
    const raw = window.prompt(`Confermi ${r.description || r.category} del ${dayjs(r.pendingAt).format("DD/MM/YYYY")}? Importo:`, String(r.amount));
    if (raw == null) return;
    const amount = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return window.alert("Importo non valido");
    try { await confirmPending(r.id, { amount }); fetchTransactions(); } catch (err) { window.alert(err.response?.data?.error || "Conferma non riuscita"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Ricorrenze</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
          + Nuova ricorrenza
        </button>
      </div>

      {/* Totali fisse/mese */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-xs text-ink-600">Uscite fisse / mese</div>
          <div className="text-xl font-bold nums text-ink-900">{eur(monthlyFixedExpense)}</div>
          <div className="text-[11px] text-ink-400 mt-0.5">equivalente mensile, incluse semestrali/annuali</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-ink-600">Entrate fisse / mese</div>
          <div className="text-xl font-bold nums text-brand-600">{eur(monthlyFixedIncome)}</div>
          <div className="text-[11px] text-ink-400 mt-0.5">netto fisso: {eur(monthlyFixedIncome - monthlyFixedExpense)}</div>
        </div>
      </div>

      {/* In attesa di conferma */}
      {pending.length > 0 && (
        <div className="card p-4 border-tax-600/30 bg-tax-50/40">
          <h2 className="text-sm font-semibold text-tax-600 mb-2">Da confermare</h2>
          <ul className="divide-y divide-card-line">
            {pending.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                <div>
                  <div className="font-medium">{r.description || r.category}</div>
                  <div className="text-xs text-ink-400">{dayjs(r.pendingAt).format("DD/MM/YYYY")} · {eur(r.amount)}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => confirm(r)} className="px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg">Conferma</button>
                  <button onClick={() => skipPending(r.id)} className="px-3 py-1.5 text-xs border border-card-line rounded-lg text-ink-600">Salta</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Segmented
        size="sm"
        value={filter}
        onChange={setFilter}
        options={[{ value: "ALL", label: "Tutte" }, { value: "EXPENSE", label: "Uscite" }, { value: "INCOME", label: "Entrate" }]}
      />

      <div className="card divide-y divide-card-line">
        {loading && rules.length === 0 ? (
          <p className="p-4 text-sm text-ink-400">Caricamento…</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-ink-400">Nessuna ricorrenza. Crea la prima: rata, affitto, abbonamento, stipendio…</p>
        ) : (
          visible.map((r) => (
            <div key={r.id} className={`p-3 flex items-center justify-between gap-3 ${r.active ? "" : "opacity-50"}`}>
              <div className="text-sm min-w-0">
                <div className="font-medium truncate">
                  {r.description || r.category}
                  {!r.active && <span className="ml-2 text-xs text-ink-400">(sospesa)</span>}
                  {!r.autoPost && <span className="ml-2 text-[10px] uppercase tracking-wide text-tax-600">conferma</span>}
                </div>
                <div className="text-xs text-ink-400">
                  {r.category} · {scheduleLabel(r)}
                  {r.endDate ? ` · fino al ${dayjs(r.endDate).format("DD/MM/YYYY")}` : ""}
                </div>
                <div className="text-xs text-ink-600 mt-0.5">
                  {r.active && r.nextRunAt ? <>Prossima: <span className="font-medium">{dayjs(r.nextRunAt).format("DD/MM/YYYY")}</span></> : "Nessuna prossima"}
                  {r.monthsPerOccurrence > 1 && <span className="ml-2 text-ink-400">≈ {eur(r.monthlyEquivalent)}/mese</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-semibold nums ${r.type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
                  {r.type === "INCOME" ? "+" : "−"}{eur(r.amount)}
                </span>
                <button onClick={() => toggleActive(r)} className="text-ink-400 hover:text-brand-600 text-xs" title={r.active ? "Sospendi" : "Riattiva"}>
                  {r.active ? "⏸" : "▶"}
                </button>
                <button onClick={() => { setEditing(r); setShowForm(true); }} className="text-ink-400 hover:text-brand-600" title="Modifica">✎</button>
                <button onClick={() => remove(r)} className="text-ink-400 hover:text-rose-600" title="Elimina">✕</button>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && <RuleForm initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} />}
    </div>
  );
}
