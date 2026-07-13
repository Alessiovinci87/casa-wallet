import { useEffect, useState } from "react";
import api from "../lib/api.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import Segmented from "./Segmented.jsx";

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
export default function TransactionForm({ initial, onClose }) {
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
  }));
  const [ocrBusy, setOcrBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
    };
    try {
      if (isEdit) await updateTransaction(initial.id, payload);
      else await addTransaction(payload);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Errore salvataggio");
    }
  };

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

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:text-ink-900">
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
