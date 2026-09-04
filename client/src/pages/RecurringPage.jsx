import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useRecurringStore } from "../store/recurringStore.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS, FREQUENCY_LABELS, WEEKDAY_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";
import RecurrenceFields, { emptyRecurrence, recurrenceToPayload } from "../components/RecurrenceFields.jsx";
import AccountPicker from "../components/AccountPicker.jsx";
import { useAccountStore } from "../store/accountStore.js";

import { dialog } from "../lib/dialog.js";
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
  accountId: "",
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
      accountId: initial.accountId || "",
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
          accrualStart: initial.accrualStart ? String(initial.accrualStart).slice(0, 10) : "",
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
      accountId: form.accountId || null,
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
    <div className="space-y-3">
      <button type="button" onClick={onClose} className="min-h-[44px] text-[13px] text-ink-600 flex items-center">‹ Annulla</button>
      <form onSubmit={submit} className="card p-4 sm:p-6 w-full space-y-3">
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
        <AccountPicker value={form.accountId} onChange={(v) => set("accountId", v)} />
        <div>
          <label className="block text-xs text-ink-600 mb-1">Descrizione</label>
          <input type="text" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="es. Rata auto" className="w-full px-2 py-2 border border-card-line rounded" />
        </div>

        <div className="border-t border-card-line pt-3">
          <RecurrenceFields value={rec} onChange={setRec} startDate={form.startDate} amount={form.amount} onStartDateChange={(d) => set("startDate", d)} />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-card-line">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:text-ink-900">Annulla</button>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {saving ? "Salvo…" : "Salva"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RecurringPage({ accountId = "" } = {}) {
  const { rules, monthlyFixedExpense, monthlyFixedIncome, loading, fetchRules, updateRule, deleteRule, confirmPending, skipPending } = useRecurringStore();
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const yearRemainingExpense = useRecurringStore((s) => s.yearRemainingExpense);
  const yearRemainingIncome = useRecurringStore((s) => s.yearRemainingIncome);
  const accounts = useAccountStore((s) => s.accounts);
  const fetchAccounts = useAccountStore((s) => s.fetchAccounts);
  const accountName = (id) => accounts.find((a) => a.id === id)?.name;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => { fetchRules(); fetchAccounts().catch(() => {}); }, [fetchRules, fetchAccounts]);

  const defaultAccountId = accounts.find((a) => a.isDefault)?.id;
  const inAccount = (r) => !accountId || r.accountId === accountId || (accountId === defaultAccountId && !r.accountId);
  const visible = rules.filter((r) => (filter === "ALL" || r.type === filter) && inAccount(r));
  const pending = rules.filter((r) => r.pendingAt);

  const toggleActive = async (r) => {
    try { await updateRule(r.id, { active: !r.active }); } catch { dialog.alert({ message: "Operazione non riuscita" }); }
  };
  const remove = async (r) => {
    if (!(await dialog.confirm({ message: `Eliminare la ricorrenza "${r.description || r.category}"? Le transazioni già registrate restano.`, danger: true }))) return;
    try { await deleteRule(r.id); } catch { dialog.alert({ message: "Eliminazione non riuscita" }); }
  };
  const confirm = async (r) => {
    const raw = (await dialog.prompt({ message: `Confermi ${r.description || r.category} del ${dayjs(r.pendingAt).format("DD/MM/YYYY")}? Importo:`, defaultValue: String(r.amount), inputMode: "decimal" }));
    if (raw == null) return;
    const amount = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return dialog.alert({ message: "Importo non valido" });
    try { await confirmPending(r.id, { amount }); fetchTransactions(); } catch (err) { dialog.alert({ message: err.response?.data?.error || "Conferma non riuscita" }); }
  };

  if (showForm) return <RuleForm initial={editing} onClose={() => { setShowForm(false); setEditing(null); }} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Ricorrenze</h1>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="ml-auto px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
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
        <div className="card p-4 col-span-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-ink-600">Ancora da pagare entro fine anno</div>
            <div className="text-[11px] text-ink-400 mt-0.5">somma delle scadenze da domani al 31 dicembre · entrate fisse attese {eur(yearRemainingIncome)}</div>
          </div>
          <div className="text-xl font-bold nums text-ink-900">{eur(yearRemainingExpense)}</div>
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

      <div className="space-y-3">
        {loading && rules.length === 0 ? (
          <p className="card p-4 text-sm text-ink-400">Caricamento…</p>
        ) : visible.length === 0 ? (
          <p className="card p-4 text-sm text-ink-400">Nessuna ricorrenza. Crea la prima: rata, affitto, abbonamento, stipendio…</p>
        ) : (
          visible.map((r) => (
            <div key={r.id} className={`card p-4 ${r.active ? "" : "opacity-60"}`}>
              <button type="button" onClick={() => { setEditing(r); setShowForm(true); }} className="w-full text-left flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {r.description || r.category}
                    {!r.active && <span className="ml-2 text-[13px] text-ink-400">(sospesa)</span>}
                    {!r.autoPost && <span className="ml-2 text-[13px] text-tax-600">con conferma</span>}
                  </div>
                  <div className="text-[13px] text-ink-400">
                    {r.category} · {scheduleLabel(r)}{r.endDate ? ` · fino al ${dayjs(r.endDate).format("DD/MM/YYYY")}` : ""}
                    {accounts.length > 1 && <> · {accountName(r.accountId) || accountName(accounts.find((a) => a.isDefault)?.id) || "conto predefinito"}</>}
                  </div>
                  <div className="text-[13px] text-ink-600">
                    {r.active && r.nextRunAt
                      ? r.monthsPerOccurrence > 1 && r.nextDates?.length > 1
                        ? <>Scadenze {r.nextDates.map((d) => dayjs(d).format("D MMM")).join(" · ")}</>
                        : <>Prossima {dayjs(r.nextRunAt).format("DD/MM/YYYY")}</>
                      : "Nessuna prossima"}
                    {r.monthsPerOccurrence > 1 && <span className="text-ink-400"> · {eur(r.accrual?.monthlyQuota ?? r.monthlyEquivalent)}/mese{r.accrual?.catchUp ? " fino alla prima scadenza" : ""}{r.accrued > 0 ? `, maturati ${eur(r.accrued)}` : ""}</span>}
                  </div>
                  {r.active && r.remainingThisYear?.count > 0 && (
                    <div className="text-[13px] text-ink-400">
                      Entro fine anno: {r.remainingThisYear.count} × {eur(r.amount)} = <span className="nums">{eur(r.remainingThisYear.total)}</span>
                    </div>
                  )}
                </div>
                <span className={`shrink-0 font-bold text-lg nums ${r.type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
                  {r.type === "INCOME" ? "+" : "−"}{eur(r.amount)}
                </span>
              </button>
              <div className="flex gap-2 mt-2 text-[13px]">
                <button onClick={() => toggleActive(r)} className="chip px-3 text-[13px]">{r.active ? "Sospendi" : "Riattiva"}</button>
                <button onClick={() => { setEditing(r); setShowForm(true); }} className="chip px-3 text-[13px]">Modifica</button>
                <button onClick={() => remove(r)} className="chip px-3 text-[13px] text-rose-600">Elimina</button>
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
