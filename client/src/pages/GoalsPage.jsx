import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useGoalStore } from "../store/goalStore.js";
import { useRecurringStore } from "../store/recurringStore.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";
import AllocateModal from "../components/AllocateModal.jsx";
import { useTaxStore } from "../store/taxStore.js";
import { useNavigate } from "react-router-dom";

// Obiettivi: card con barra progresso, quota mensile, stato colorato,
// versa/preleva, "Distribuisci". Wizard nuovo obiettivo: nome → importo → data
// → "servono N €/mese".

const KIND_LABELS = { GOAL: "Obiettivo", SINKING: "Spesa periodica", BUFFER: "Cuscinetto" };
const STATUS = {
  ON_TRACK: { label: "In linea", cls: "bg-brand-50 text-brand-700", bar: "bg-brand-500" },
  AHEAD: { label: "In anticipo", cls: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  BEHIND: { label: "In ritardo", cls: "bg-rose-50 text-rose-700", bar: "bg-rose-500" },
  DONE: { label: "Raggiunto", cls: "bg-ink-900 text-white", bar: "bg-ink-900" },
};
const ICONS = ["🎯", "🏖️", "🏠", "🚗", "🎁", "🛡️", "💍", "🎓", "🐾", "✈️"];

function monthsLabel(n) {
  if (n == null) return "";
  return n === 1 ? "1 mese" : `${n} mesi`;
}

function GoalWizard({ initial, onClose }) {
  const createGoal = useGoalStore((s) => s.createGoal);
  const updateGoal = useGoalStore((s) => s.updateGoal);
  const rules = useRecurringStore((s) => s.rules);
  const fetchRules = useRecurringStore((s) => s.fetchRules);
  const isEdit = Boolean(initial?.id);
  const [step, setStep] = useState(isEdit ? 3 : 0);
  const [form, setForm] = useState({
    kind: initial?.kind || "GOAL",
    name: initial?.name || "",
    icon: initial?.icon || "🎯",
    targetAmount: initial?.targetAmount ?? "",
    targetDate: initial?.targetDate ? String(initial.targetDate).slice(0, 10) : "",
    priority: initial?.priority || 2,
    personal: initial?.personal || false,
    linkedRecurringRuleId: initial?.linkedRecurringRuleId || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { fetchRules(); }, [fetchRules]);
  const linkable = rules.filter((r) => r.active && r.type === "EXPENSE" && r.monthsPerOccurrence > 1);
  const linkedRule = linkable.find((r) => r.id === form.linkedRecurringRuleId);

  // Anteprima "servono N €/mese".
  const months = form.targetDate ? Math.max(1, Math.ceil(dayjs(form.targetDate).diff(dayjs(), "day") / 30.4375)) : null;
  const quota = linkedRule
    ? linkedRule.monthlyEquivalent
    : months && Number(form.targetAmount) > 0
      ? Number(form.targetAmount) / months
      : null;

  const submit = async () => {
    setSaving(true);
    setError("");
    const payload = {
      kind: form.kind,
      name: form.name.trim(),
      icon: form.icon,
      priority: Number(form.priority),
      personal: form.personal,
      targetAmount: form.targetAmount === "" ? undefined : Number(form.targetAmount),
      targetDate: form.kind === "BUFFER" ? null : form.targetDate || null,
      linkedRecurringRuleId: form.kind === "SINKING" ? form.linkedRecurringRuleId || null : null,
    };
    try {
      if (isEdit) await updateGoal(initial.id, payload);
      else await createGoal(payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Errore salvataggio");
      setSaving(false);
    }
  };

  const canNext = [
    () => form.name.trim() && form.kind,
    () => (form.kind === "SINKING" && form.linkedRecurringRuleId) || Number(form.targetAmount) > 0,
    () => form.kind === "BUFFER" || (form.kind === "SINKING" && form.linkedRecurringRuleId) || form.targetDate,
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{isEdit ? "Modifica obiettivo" : "Nuovo obiettivo"}</h2>
          {!isEdit && <span className="text-xs text-ink-400">passo {Math.min(step, 2) + 1} di 3</span>}
        </div>
        {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        {(step === 0 || isEdit) && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-ink-600 mb-1">Tipo</label>
              <Segmented
                size="sm" value={form.kind} onChange={(v) => set("kind", v)}
                options={[
                  { value: "GOAL", label: "Traguardo con data" },
                  { value: "SINKING", label: "Spesa periodica" },
                  { value: "BUFFER", label: "Cuscinetto" },
                ]}
              />
              <p className="text-[11px] text-ink-400 mt-1">
                {form.kind === "GOAL" && "Es. Vacanze 3.000 € entro agosto."}
                {form.kind === "SINKING" && "Spesa grossa che torna (mutuo semestrale, bollo, assicurazione): la spalmi ogni mese."}
                {form.kind === "BUFFER" && "Riserva senza data: fondo agosto, emergenze."}
              </p>
            </div>
            {form.kind === "SINKING" && (
              <div>
                <label className="block text-xs text-ink-600 mb-1">Collega a una ricorrenza</label>
                <Segmented
                  size="sm" value={form.linkedRecurringRuleId} onChange={(v) => { set("linkedRecurringRuleId", v); const r = linkable.find((x) => x.id === v); if (r && !form.name) set("name", r.description || r.category); }}
                  options={[{ value: "", label: "Nessuna" }, ...linkable.map((r) => ({ value: r.id, label: `${r.description || r.category} · ${eur(r.amount)}` }))]}
                />
                {linkable.length === 0 && <p className="text-[11px] text-ink-400 mt-1">Nessuna ricorrenza semestrale/annuale: creala in Ricorrenze.</p>}
              </div>
            )}
            <div>
              <label className="block text-xs text-ink-600 mb-1">Nome</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="es. Vacanze" className="w-full px-2 py-2 border border-card-line rounded" />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Icona</label>
              <Segmented size="sm" value={form.icon} onChange={(v) => set("icon", v)} options={ICONS.map((i) => ({ value: i, label: i }))} />
            </div>
          </div>
        )}

        {(step === 1 || isEdit) && (
          <div className="space-y-3">
            {!(form.kind === "SINKING" && linkedRule) && (
              <div>
                <label className="block text-xs text-ink-600 mb-1">Importo da raggiungere €</label>
                <input type="number" step="0.01" min="0" value={form.targetAmount} onChange={(e) => set("targetAmount", e.target.value)} className="w-full px-2 py-2 border border-card-line rounded nums" />
              </div>
            )}
            {linkedRule && form.kind === "SINKING" && (
              <p className="text-sm text-ink-600">Importo dalla ricorrenza: <span className="font-semibold nums">{eur(linkedRule.amount)}</span>, prossima il {dayjs(linkedRule.nextRunAt).format("DD/MM/YYYY")}.</p>
            )}
            <div>
              <label className="block text-xs text-ink-600 mb-1">Priorità</label>
              <Segmented size="sm" value={Number(form.priority)} onChange={(v) => set("priority", v)} options={[{ value: 1, label: "Alta" }, { value: 2, label: "Media" }, { value: 3, label: "Bassa" }]} />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Visibilità</label>
              <Segmented size="sm" value={form.personal} onChange={(v) => set("personal", v)} options={[{ value: false, label: "Famiglia" }, { value: true, label: "Solo io" }]} />
            </div>
          </div>
        )}

        {(step === 2 || isEdit) && form.kind !== "BUFFER" && !(form.kind === "SINKING" && linkedRule) && (
          <div>
            <label className="block text-xs text-ink-600 mb-1">Entro quando</label>
            <input type="date" value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} className="w-full px-2 py-2 border border-card-line rounded" />
          </div>
        )}

        {(step >= 2 || isEdit) && quota != null && (
          <div className="bg-brand-50 rounded-xl p-3 text-sm">
            <div className="text-brand-700 font-semibold">Servono circa {eur(quota)} al mese</div>
            <div className="text-xs text-ink-600 mt-0.5">
              {linkedRule ? `${eur(linkedRule.amount)} ogni ${linkedRule.monthsPerOccurrence} mesi` : `${eur(form.targetAmount)} in ${monthsLabel(months)}`}
            </div>
          </div>
        )}
        {step >= 2 && form.kind === "BUFFER" && (
          <p className="text-sm text-ink-600">Un cuscinetto non ha scadenza: lo alimenti quando distribuisci un'entrata.</p>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <button type="button" onClick={step > 0 && !isEdit ? () => setStep(step - 1) : onClose} className="px-4 py-2 text-ink-600 hover:text-ink-900">
            {step > 0 && !isEdit ? "Indietro" : "Annulla"}
          </button>
          {!isEdit && step < 2 ? (
            <button type="button" disabled={!canNext[step]()} onClick={() => setStep(step + 1)} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
              Avanti
            </button>
          ) : (
            <button type="button" disabled={saving || (!isEdit && !canNext[2]())} onClick={submit} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
              {saving ? "Salvo…" : isEdit ? "Salva" : "Crea obiettivo"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalCard({ g, onEdit, onDeposit, onWithdraw, onDelete }) {
  const st = STATUS[g.status] || STATUS.ON_TRACK;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate">{g.icon ? `${g.icon} ` : ""}{g.name}</div>
          <div className="text-xs text-ink-400">
            {KIND_LABELS[g.kind]}{g.personal ? " · solo io" : ""}
            {g.dueDate ? ` · entro ${dayjs(g.dueDate).format("DD/MM/YYYY")}` : ""}
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
      </div>

      <div>
        <div className="flex justify-between text-sm">
          <span className="font-semibold nums">{eur(g.saved)}</span>
          <span className="text-ink-400 nums">di {eur(g.target)}</span>
        </div>
        <div className="mt-1 bg-paper rounded-full h-2.5">
          <div className={`${st.bar} h-2.5 rounded-full`} style={{ width: `${Math.round(g.progress * 100)}%` }} />
        </div>
      </div>

      <div className="text-xs text-ink-600 space-y-0.5">
        {g.monthlyQuota != null && g.status !== "DONE" && (
          <div>
            Quota <span className="font-semibold nums">{eur(g.monthlyQuota)}/mese</span>
            {g.monthRemaining > 0
              ? <> · questo mese mancano <span className="nums">{eur(g.monthRemaining)}</span></>
              : <> · quota del mese versata ✓</>}
          </div>
        )}
        {g.shortfall > 0 && (
          <div className="text-tax-600">
            Mancano {eur(g.remaining)} per il {dayjs(g.dueDate).format("DD/MM")}: a {eur(g.monthlyQuota)}/mese arrivi a {eur(g.target - g.shortfall)}. Per coprire tutto servono {eur(g.catchUpQuota)}/mese.
          </div>
        )}
        {g.status !== "DONE" && g.projectedDate && g.paceMonthly > 0 && (
          <div className="text-ink-400">Al ritmo attuale ({eur(g.paceMonthly)}/mese) ci arrivi il {dayjs(g.projectedDate).format("DD/MM/YYYY")}.</div>
        )}
        {g.status === "DONE" && <div className="text-ink-900 font-medium">Obiettivo raggiunto 🎉</div>}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={() => onDeposit(g)} className="px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg">Versa</button>
        <button onClick={() => onWithdraw(g)} disabled={g.saved <= 0} className="px-3 py-1.5 text-xs border border-card-line rounded-lg text-ink-600 disabled:opacity-40">Preleva</button>
        <span className="flex-1" />
        <button onClick={() => onEdit(g)} className="text-ink-400 hover:text-brand-600" title="Modifica">✎</button>
        <button onClick={() => onDelete(g)} className="text-ink-400 hover:text-rose-600" title="Elimina">✕</button>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  const { goals, summary, loading, fetchGoals, contribute, deleteGoal } = useGoalStore();
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState(null);
  const [allocateAmount, setAllocateAmount] = useState(null);
  const navigate = useNavigate();
  // Tasse: salvadanaio personale, vive qui come voce (dettaglio e trasferimenti in /tax-savings).
  const taxSummary = useTaxStore((s) => s.summary);
  const fetchTaxSummary = useTaxStore((s) => s.fetchSummary);
  const monthName = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(new Date());

  useEffect(() => { fetchGoals(); fetchTaxSummary().catch(() => {}); }, [fetchGoals, fetchTaxSummary]);

  const deposit = async (g) => {
    const raw = window.prompt(`Quanto versi su "${g.name}"?`, g.monthRemaining > 0 ? String(g.monthRemaining) : "");
    if (raw == null) return;
    const amount = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return window.alert("Importo non valido");
    try { await contribute(g.id, { amount }); } catch (err) { window.alert(err.response?.data?.error || "Versamento non riuscito"); }
  };
  const withdraw = async (g) => {
    const raw = window.prompt(`Quanto prelevi da "${g.name}"? (disponibili ${eur(g.saved)})`, String(g.saved));
    if (raw == null) return;
    const amount = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return window.alert("Importo non valido");
    const createTransaction = window.confirm("Registrare anche l'uscita reale nel bilancio? (OK = sì, Annulla = solo prelievo dal salvadanaio)");
    try {
      await contribute(g.id, { amount: -amount, createTransaction, category: "Altro", method: "TRANSFER" });
      if (createTransaction) fetchTransactions();
    } catch (err) { window.alert(err.response?.data?.error || "Prelievo non riuscito"); }
  };
  const remove = async (g) => {
    if (!window.confirm(`Eliminare "${g.name}"? I ${eur(g.saved)} parcheggiati tornano disponibili.`)) return;
    try { await deleteGoal(g.id); } catch { window.alert("Eliminazione non riuscita"); }
  };
  const distribute = () => {
    const raw = window.prompt("Importo da distribuire sugli obiettivi:");
    if (raw == null) return;
    const amount = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) return window.alert("Importo non valido");
    setAllocateAmount(amount);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Obiettivi</h1>
        <div className="flex w-full sm:w-auto gap-2">
          <button onClick={distribute} disabled={goals.length === 0} className="flex-1 sm:flex-none px-4 py-2 border border-card-line text-ink-600 rounded hover:bg-paper disabled:opacity-40">
            Distribuisci
          </button>
          <button onClick={() => { setEditing(null); setWizard(true); }} className="flex-1 sm:flex-none px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
            + Nuovo obiettivo
          </button>
        </div>
      </div>

      {summary && summary.count > 0 && (
        <div className="card p-4">
          <div className="text-[13px] text-ink-600">Parcheggiati totali</div>
          <div className="text-3xl font-bold tracking-tight nums">{eur(summary.parked)}</div>
          <div className="mt-1 text-[13px] text-ink-600">
            Quota di <span className="capitalize">{monthName}</span> <span className="font-semibold nums">{eur(summary.monthQuota)}</span> · versati{" "}
            <span className={`font-semibold nums ${summary.monthContributed > summary.monthQuota ? "text-emerald-700" : summary.behind ? "text-rose-600" : "text-brand-600"}`}>{eur(summary.monthContributed)}</span>
            {summary.monthContributed > summary.monthQuota && <span className="text-emerald-700"> · in anticipo</span>}
            {summary.behind > 0 && <span className="text-rose-600"> · {summary.behind} in ritardo</span>}
          </div>
        </div>
      )}

      {/* Tasse: salvadanaio personale */}
      <button type="button" onClick={() => navigate("/tax-savings")} className="card w-full p-4 text-left flex items-center justify-between gap-3 min-h-[64px] hover:border-brand-200">
        <div>
          <div className="font-semibold">Tasse <span className="text-[13px] font-normal text-ink-400">· personale</span></div>
          <div className="text-[13px] text-ink-400">Accantonate, non ancora trasferite · scadenze e simulatore in Tesoreria</div>
        </div>
        <span className="text-xl font-bold text-tax-600 nums shrink-0">{eur(taxSummary?.totalPending)}</span>
      </button>

      {loading && goals.length === 0 ? (
        <div className="card p-4 text-sm text-ink-400">Caricamento…</div>
      ) : goals.length === 0 ? (
        <div className="card p-6 text-center space-y-2">
          <div className="text-3xl">🎯</div>
          <p className="text-sm text-ink-600">Nessun obiettivo. Dimmi cosa vuoi (es. 3.000 € di ferie ad agosto) e ti dico quanto mettere via ogni mese.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} g={g} onEdit={(x) => { setEditing(x); setWizard(true); }} onDeposit={deposit} onWithdraw={withdraw} onDelete={remove} />
          ))}
        </div>
      )}

      {wizard && <GoalWizard initial={editing} onClose={() => { setWizard(false); setEditing(null); }} />}
      {allocateAmount != null && <AllocateModal amount={allocateAmount} onClose={() => setAllocateAmount(null)} />}
    </div>
  );
}
