import { useEffect, useState } from "react";
import api from "../lib/api.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import AccountPicker from "./AccountPicker.jsx";
import Segmented from "./Segmented.jsx";
import RecurrenceFields, { emptyRecurrence, recurrenceToPayload } from "./RecurrenceFields.jsx";
import { useRecurringStore } from "../store/recurringStore.js";
import { useGoalStore } from "../store/goalStore.js";
import AllocateModal from "./AllocateModal.jsx";

const empty = {
  amount: "",
  type: "EXPENSE",
  category: "",
  method: "CARD",
  description: "",
  date: new Date().toISOString().slice(0, 10),
  taxPercent: "",
};

// Modal form to create OR edit a transaction. `initial` pre-fills fields
// (from OCR, or an existing transaction to edit when it carries an `id`).
export default function TransactionForm({ initial, onClose, onDelete }) {
  const addTransaction = useTransactionStore((s) => s.addTransaction);
  const updateTransaction = useTransactionStore((s) => s.updateTransaction);
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    ...empty,
    ...initial,
    amount: initial?.amount ?? "",
    date: initial?.date ? String(initial.date).slice(0, 10) : empty.date,
    taxPercent: initial?.taxPercent ?? "",
    description: initial?.description ?? "",
    accountId: initial?.accountId ?? initial?.account?.id ?? "",
  }));
  const [ocrBusy, setOcrBusy] = useState(false);
  // "Ripeti": in creazione la transazione diventa una regola ricorrente
  // (la prima occorrenza nasce subito con postFirst, le altre dal cron).
  const [repeat, setRepeat] = useState(false);
  const [recurrence, setRecurrence] = useState(emptyRecurrence);
  const createRule = useRecurringStore((s) => s.createRule);
  // Dopo un'entrata: proponi il riparto del netto post-tasse sugli obiettivi.
  const goals = useGoalStore((s) => s.goals);
  const goalsLoaded = useGoalStore((s) => s.loaded);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);
  const [allocateFor, setAllocateFor] = useState(null); // transactionId
  useEffect(() => {
    if (!isEdit && form.type === "INCOME" && !goalsLoaded) fetchGoals().catch(() => {});
  }, [form.type, isEdit, goalsLoaded, fetchGoals]);
  const hasGoals = goals.some((g) => g.active && g.status !== "DONE");
  const [error, setError] = useState("");
  // Riconciliazione: fatture EMESSE per riconoscere un'entrata come incasso.
  const [pendingInvoices, setPendingInvoices] = useState(null); // null = non ancora caricate
  const [collecting, setCollecting] = useState(false);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Al primo passaggio su "Entrata" carica le fatture in attesa (una volta sola).
  useEffect(() => {
    if (isEdit || form.type !== "INCOME" || pendingInvoices !== null) return;
    api
      .get("/api/invoices", { params: { status: "EMESSA" } })
      .then(({ data }) => setPendingInvoices(Array.isArray(data) ? data : []))
      .catch(() => setPendingInvoices([]));
  }, [form.type, isEdit, pendingInvoices]);

  // Una fattura "corrisponde" se il netto da incassare è entro l'1% (min 1 cent).
  const amountNum = Number(form.amount);
  const matchedInvoice =
    !isEdit && form.type === "INCOME" && Number.isFinite(amountNum) && amountNum > 0 && pendingInvoices
      ? pendingInvoices.find(
          (inv) => Math.abs(inv.netToPay - amountNum) <= Math.max(0.01, inv.netToPay * 0.01)
        )
      : null;

  const collectMatched = async () => {
    setCollecting(true);
    setError("");
    try {
      const { data } = await api.put(`/api/invoices/${matchedInvoice.id}/collect`, {
        method: form.method,
        date: new Date(form.date).toISOString(),
        ...(form.taxPercent !== "" && { taxPercent: Number(form.taxPercent) }),
      });
      await fetchTransactions();
      if (hasGoals && data?.transaction?.id) setAllocateFor(data.transaction.id);
      else onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Registrazione incasso fallita");
      setCollecting(false);
    }
  };

  // Prefill % tasse dal profilo fiscale: solo in creazione, solo se il campo è
  // vuoto — mai sovrascrivere una scelta dell'utente o una modifica.
  const fiscalProfile = useTreasuryStore((s) => s.fiscalProfile);
  const fetchFiscalProfile = useTreasuryStore((s) => s.fetchFiscalProfile);
  useEffect(() => {
    fetchFiscalProfile(); // cached: no-op dopo la prima chiamata
  }, [fetchFiscalProfile]);
  useEffect(() => {
    if (!isEdit && form.type === "INCOME" && form.taxPercent === "" && fiscalProfile?.defaultTaxPercent != null) {
      set("taxPercent", fiscalProfile.defaultTaxPercent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type, fiscalProfile]);

  const handleOcr = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("images", file);
      const { data } = await api.post("/api/ocr/parse", fd);
      setForm((f) => ({
        ...f,
        amount: data.amount ?? f.amount,
        type: data.type ?? f.type,
        description: data.description ?? f.description,
        date: data.date ? String(data.date).slice(0, 10) : f.date,
        method: data.method ?? f.method,
      }));
    } catch {
      setError("OCR non riuscito");
    } finally {
      setOcrBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.category) {
      setError("Scegli una categoria");
      return;
    }
    const payload = {
      amount: Number(form.amount),
      type: form.type,
      category: form.category,
      method: form.method,
      description: form.description || null,
      date: new Date(form.date).toISOString(),
      taxPercent: form.type === "INCOME" && form.taxPercent ? Number(form.taxPercent) : null,
      accountId: form.accountId || null,
    };
    try {
      if (isEdit) await updateTransaction(initial.id, payload);
      else if (repeat) {
        await createRule({
          type: payload.type,
          amount: payload.amount,
          category: payload.category,
          method: payload.method,
          description: payload.description,
          accountId: payload.accountId,
          startDate: payload.date,
          postFirst: true,
          ...recurrenceToPayload(recurrence),
        });
        await fetchTransactions();
      } else {
        const created = await addTransaction(payload);
        if (payload.type === "INCOME" && hasGoals && created?.id) {
          setAllocateFor(created.id);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Errore salvataggio");
    }
  };

  if (allocateFor) {
    return <AllocateModal incomeTransactionId={allocateFor} onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <form onSubmit={handleSubmit} className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "Modifica transazione" : "Nuova transazione"}</h2>
          <label className="text-sm text-brand-600 cursor-pointer hover:underline">
            {ocrBusy ? "Analisi…" : "📷 Foto"}
            <input type="file" accept="image/*" className="hidden" onChange={handleOcr} disabled={ocrBusy} />
          </label>
        </div>

        {error && <div className="mb-3 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        <div>
          <label className="block text-xs text-ink-600 mb-1">Tipo</label>
          <Segmented
            value={form.type}
            onChange={(v) => {
              // Cambiando tipo, la categoria selezionata potrebbe non esistere più.
              set("type", v);
              if (!CATEGORIES[v].includes(form.category)) set("category", "");
            }}
            options={[
              { value: "EXPENSE", label: "Uscita" },
              { value: "INCOME", label: "Entrata" },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Importo €</label>
            <input
              type="number" step="0.01" min="0" required
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              className="w-full px-2 py-2 border border-card-line rounded nums"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-600 mb-1">Data</label>
            <input
              type="date" required
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className="w-full px-2 py-2 border border-card-line rounded"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs text-ink-600 mb-1">Categoria</label>
          <Segmented
            size="sm"
            value={form.category}
            onChange={(v) => set("category", v)}
            options={CATEGORIES[form.type].map((c) => ({ value: c, label: c }))}
          />
          {!form.category && (
            <p className="text-[11px] text-ink-400 mt-1">Scegli una categoria</p>
          )}
        </div>

        <div className="mt-3">
          <label className="block text-xs text-ink-600 mb-1">Metodo</label>
          <Segmented
            size="sm"
            value={form.method}
            onChange={(v) => set("method", v)}
            options={PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }))}
          />
        </div>
        <div className="mt-3">
          <AccountPicker value={form.accountId} onChange={(v) => set("accountId", v)} />
        </div>

        {/* Riconciliazione: l'importo coincide con una fattura in attesa */}
        {matchedInvoice && (
          <div className="mt-3 bg-brand-50 rounded-xl p-3 text-sm">
            <div className="font-semibold text-brand-700">
              È l'incasso della fattura n. {matchedInvoice.numero}?
            </div>
            <div className="text-xs text-ink-600 mt-0.5">
              {matchedInvoice.customerName} · netto <span className="nums">{Number(matchedInvoice.netToPay).toFixed(2)}€</span>.
              Registrandola come incasso, la fattura risulta incassata e l'accantonamento tasse parte in automatico.
            </div>
            <button
              type="button"
              disabled={collecting}
              onClick={collectMatched}
              className="mt-2 px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {collecting ? "Registro…" : "Registra come incasso fattura"}
            </button>
          </div>
        )}

        {form.type === "INCOME" && (
          <div className="mt-3">
            <label className="block text-xs text-ink-600 mb-1">% tasse da accantonare</label>
            <input
              type="number" step="1" min="0" max="100"
              value={form.taxPercent}
              onChange={(e) => set("taxPercent", e.target.value)}
              className="w-full px-2 py-2 border border-card-line rounded"
            />
          </div>
        )}

        <div className="mt-3">
          <label className="block text-xs text-ink-600 mb-1">Descrizione</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="w-full px-2 py-2 border border-card-line rounded"
          />
        </div>

        {!isEdit && (
          <div className="mt-4 border-t border-card-line pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Ripeti</span>
              <Segmented
                size="sm"
                value={repeat}
                onChange={setRepeat}
                options={[
                  { value: false, label: "No" },
                  { value: true, label: "Sì" },
                ]}
              />
            </div>
            {repeat && (
              <div className="mt-3">
                <RecurrenceFields value={recurrence} onChange={setRecurrence} startDate={form.date} amount={form.amount} />
                {form.type === "INCOME" && form.taxPercent !== "" && (
                  <p className="text-[11px] text-tax-600 mt-2">
                    Le entrate ricorrenti non accantonano tasse in automatico: la % va applicata a mano.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          {isEdit && onDelete && (
            <button type="button" onClick={onDelete} className="mr-auto px-3 py-2 min-h-[44px] text-rose-600 hover:bg-rose-50 rounded">
              Elimina
            </button>
          )}
          <button type="button" onClick={onClose} className="px-4 py-2 min-h-[44px] text-ink-600 hover:text-ink-900">
            Annulla
          </button>
          <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">
            Salva
          </button>
        </div>
      </form>
    </div>
  );
}
