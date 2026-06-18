import { useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useReceiptStore } from "../store/receiptStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS, PRODUCT_CATEGORIES } from "../lib/constants.js";

let nextId = 1;
const newId = () => nextId++;

const todayISO = () => dayjs().format("YYYY-MM-DD");

export default function OcrPage() {
  const navigate = useNavigate();
  const { parse, save, parsing, saving } = useReceiptStore();

  const [longMode, setLongMode] = useState(false);
  const [shots, setShots] = useState([]); // [{ id, file, url }]
  const [phase, setPhase] = useState("capture"); // capture | confirm
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // --- capture ---
  const addFiles = (fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    const mapped = picked.map((file) => ({ id: newId(), file, url: URL.createObjectURL(file) }));
    setShots((prev) => (longMode ? [...prev, ...mapped] : mapped.slice(0, 1)));
    setError("");
  };

  const removeShot = (id) =>
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });

  const analyze = async () => {
    if (shots.length === 0) return;
    setError("");
    try {
      const data = await parse(shots.map((s) => s.file));
      setDraft({
        store: data.store ?? "",
        total: data.total ?? 0,
        date: data.date ? dayjs(data.date).format("YYYY-MM-DD") : todayISO(),
        method: data.method && PAY_METHODS.includes(data.method) ? data.method : "CARD",
        category: "Spesa",
        items: (data.items || []).map((it) => ({
          clientId: newId(),
          rawName: it.rawName ?? it.canonicalName ?? "",
          canonicalName: it.canonicalName ?? it.rawName ?? "",
          category: PRODUCT_CATEGORIES.includes(it.category) ? it.category : "Altro",
          quantity: it.quantity ?? 1,
          totalPrice: it.totalPrice ?? 0,
        })),
      });
      setPhase("confirm");
    } catch {
      setError("Analisi non riuscita. Riprova o controlla la foto.");
    }
  };

  // --- confirm: draft editing ---
  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (clientId, k, v) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => (it.clientId === clientId ? { ...it, [k]: v } : it)),
    }));
  const removeItem = (clientId) =>
    setDraft((d) => ({ ...d, items: d.items.filter((it) => it.clientId !== clientId) }));
  const addItem = () =>
    setDraft((d) => ({
      ...d,
      items: [
        ...d.items,
        { clientId: newId(), rawName: "", canonicalName: "", category: "Altro", quantity: 1, totalPrice: 0 },
      ],
    }));

  const confirm = async () => {
    setError("");
    try {
      await save({
        store: draft.store || null,
        total: Number(draft.total) || 0,
        date: draft.date,
        method: draft.method,
        category: draft.category,
        items: draft.items.map((it) => ({
          rawName: it.rawName,
          canonicalName: (it.canonicalName || it.rawName || "").trim().toLowerCase(),
          category: it.category,
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.quantity) ? Number(it.totalPrice) / Number(it.quantity) : null,
          totalPrice: Number(it.totalPrice) || 0,
        })),
      });
      shots.forEach((s) => URL.revokeObjectURL(s.url));
      setSuccess(true);
      setTimeout(() => navigate("/transactions"), 900);
    } catch {
      setError("Salvataggio non riuscito.");
    }
  };

  const cancel = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.url));
    setShots([]);
    setDraft(null);
    setPhase("capture");
    setError("");
  };

  if (success) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="text-4xl mb-2">✅</div>
        <p className="text-lg font-semibold">Spesa registrata!</p>
        <p className="text-sm text-slate-500">Reindirizzamento…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-bold">Nuova spesa da scontrino</h1>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {phase === "capture" && (
        <div className="space-y-4">
          {/* Long-receipt toggle (set BEFORE shooting) */}
          <label className="flex items-center gap-3 bg-white rounded-xl p-3 shadow-sm cursor-pointer">
            <input
              type="checkbox"
              checked={longMode}
              onChange={(e) => {
                setLongMode(e.target.checked);
                if (!e.target.checked && shots.length > 1) setShots((p) => p.slice(0, 1));
              }}
              className="h-4 w-4 accent-emerald-600"
            />
            <span className="text-sm">
              <b>Scontrino lungo</b> — più foto per un unico scontrino
            </span>
          </label>

          {longMode && (
            <p className="text-xs text-slate-500 bg-amber-50 rounded p-2">
              Fotografa lo scontrino dall'alto verso il basso, sovrapponendo leggermente le sezioni.
            </p>
          )}

          {/* Capture buttons */}
          <div className="flex gap-3">
            <label className="flex-1 text-center px-4 py-3 bg-emerald-600 text-white rounded-lg cursor-pointer hover:bg-emerald-700">
              📷 Scatta foto
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </label>
            <label className="flex-1 text-center px-4 py-3 bg-white border border-slate-300 rounded-lg cursor-pointer hover:border-emerald-400">
              🖼️ Carica da galleria
              <input
                type="file"
                accept="image/*"
                multiple={longMode}
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </label>
          </div>

          {/* Preview grid */}
          {shots.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {shots.map((s, i) => (
                <div key={s.id} className="relative">
                  <img src={s.url} alt={`foto ${i + 1}`} className="w-full h-28 object-cover rounded-lg border border-slate-200" />
                  <button
                    onClick={() => removeShot(s.id)}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs"
                    title="Rimuovi"
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {shots.length > 0 && (
            <button
              onClick={analyze}
              disabled={parsing}
              className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              {parsing ? "Analisi…" : `Analizza ${shots.length > 1 ? `(${shots.length} foto)` : ""}`}
            </button>
          )}
        </div>
      )}

      {phase === "confirm" && draft && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Controlla e correggi prima di registrare. Il saldo verrà scalato una sola volta.</p>

          {/* Header fields */}
          <div className="bg-white rounded-xl p-4 shadow-sm grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-1">
              <span className="text-slate-500">Totale €</span>
              <input type="number" step="0.01" value={draft.total} onChange={(e) => setField("total", e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded" />
            </label>
            <label className="col-span-1">
              <span className="text-slate-500">Data</span>
              <input type="date" value={draft.date} onChange={(e) => setField("date", e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded" />
            </label>
            <label className="col-span-2">
              <span className="text-slate-500">Negozio</span>
              <input value={draft.store} onChange={(e) => setField("store", e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded" />
            </label>
            <label className="col-span-1">
              <span className="text-slate-500">Metodo</span>
              <select value={draft.method} onChange={(e) => setField("method", e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded">
                {PAY_METHODS.map((m) => <option key={m} value={m}>{PAY_METHOD_LABELS[m]}</option>)}
              </select>
            </label>
            <label className="col-span-1">
              <span className="text-slate-500">Categoria spesa</span>
              <select value={draft.category} onChange={(e) => setField("category", e.target.value)} className="w-full px-2 py-1 border border-slate-300 rounded">
                {CATEGORIES.EXPENSE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Prodotti ({draft.items.length})</h2>
              <button onClick={addItem} className="text-sm text-emerald-600 hover:underline">+ Aggiungi riga</button>
            </div>
            {draft.items.map((it) => (
              <div key={it.clientId} className="flex gap-2 items-center text-sm">
                <input
                  value={it.rawName}
                  onChange={(e) => setItem(it.clientId, "rawName", e.target.value)}
                  placeholder="Prodotto"
                  className="flex-1 px-2 py-1 border border-slate-300 rounded"
                />
                <select
                  value={it.category}
                  onChange={(e) => setItem(it.clientId, "category", e.target.value)}
                  className="px-1 py-1 border border-slate-300 rounded w-32"
                >
                  {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input
                  type="number" step="1" min="0"
                  value={it.quantity}
                  onChange={(e) => setItem(it.clientId, "quantity", e.target.value)}
                  className="w-14 px-1 py-1 border border-slate-300 rounded"
                  title="Quantità"
                />
                <input
                  type="number" step="0.01" min="0"
                  value={it.totalPrice}
                  onChange={(e) => setItem(it.clientId, "totalPrice", e.target.value)}
                  className="w-20 px-1 py-1 border border-slate-300 rounded"
                  title="Prezzo €"
                />
                <button onClick={() => removeItem(it.clientId)} className="text-slate-300 hover:text-rose-600" title="Elimina">✕</button>
              </div>
            ))}
            {draft.items.length === 0 && <p className="text-xs text-slate-400">Nessun prodotto. Aggiungine uno o registra solo il totale.</p>}
          </div>

          <div className="flex gap-3">
            <button onClick={confirm} disabled={saving} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {saving ? "Salvataggio…" : "Conferma e registra spesa"}
            </button>
            <button onClick={cancel} disabled={saving} className="px-4 py-2 bg-white border border-slate-300 rounded hover:bg-slate-50">
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
