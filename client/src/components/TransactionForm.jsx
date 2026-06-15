import { useState } from "react";
import api from "../lib/api.js";
import { useTransactionStore } from "../store/transactionStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";

const empty = {
  amount: "",
  type: "EXPENSE",
  category: "",
  method: "CARD",
  description: "",
  date: new Date().toISOString().slice(0, 10),
  taxPercent: "",
};

// Modal form to create a transaction. `initial` pre-fills fields (e.g. from OCR).
export default function TransactionForm({ initial, onClose }) {
  const addTransaction = useTransactionStore((s) => s.addTransaction);
  const [form, setForm] = useState({ ...empty, ...initial });
  const [ocrBusy, setOcrBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleOcr = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", file);
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
    try {
      await addTransaction({
        amount: Number(form.amount),
        type: form.type,
        category: form.category,
        method: form.method,
        description: form.description || null,
        date: new Date(form.date).toISOString(),
        taxPercent: form.type === "INCOME" && form.taxPercent ? Number(form.taxPercent) : null,
      });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Errore salvataggio");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Nuova transazione</h2>
          <label className="text-sm text-emerald-600 cursor-pointer hover:underline">
            {ocrBusy ? "Analisi…" : "📷 Foto"}
            <input type="file" accept="image/*" className="hidden" onChange={handleOcr} disabled={ocrBusy} />
          </label>
        </div>

        {error && <div className="mb-3 text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Tipo</label>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded"
            >
              <option value="EXPENSE">Uscita</option>
              <option value="INCOME">Entrata</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Importo €</label>
            <input
              type="number" step="0.01" min="0" required
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Categoria</label>
          <select
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            required
            className="w-full px-2 py-2 border border-slate-300 rounded"
          >
            <option value="">— seleziona —</option>
            {CATEGORIES[form.type].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Metodo</label>
            <select
              value={form.method}
              onChange={(e) => set("method", e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded"
            >
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Data</label>
            <input
              type="date" required
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded"
            />
          </div>
        </div>

        {form.type === "INCOME" && (
          <div className="mt-3">
            <label className="block text-xs text-slate-500 mb-1">% tasse da accantonare</label>
            <input
              type="number" step="1" min="0" max="100"
              value={form.taxPercent}
              onChange={(e) => set("taxPercent", e.target.value)}
              className="w-full px-2 py-2 border border-slate-300 rounded"
            />
          </div>
        )}

        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Descrizione</label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="w-full px-2 py-2 border border-slate-300 rounded"
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-500 hover:text-slate-800">
            Annulla
          </button>
          <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
            Salva
          </button>
        </div>
      </form>
    </div>
  );
}
