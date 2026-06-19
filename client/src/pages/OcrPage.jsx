import { useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useReceiptStore } from "../store/receiptStore.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS, PRODUCT_CATEGORIES } from "../lib/constants.js";
import { eur } from "../lib/format.js";

// A line has no usable price yet (OCR returned null, or the user cleared it).
const missingPrice = (it) => it.totalPrice == null || it.totalPrice === "";

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
        // Server warning when items don't reconcile with the printed total.
        warning: data.warning ?? null,
        items: (data.items || []).map((it) => ({
          clientId: newId(),
          rawName: it.rawName ?? it.canonicalName ?? "",
          canonicalName: it.canonicalName ?? it.rawName ?? "",
          category: PRODUCT_CATEGORIES.includes(it.category) ? it.category : "Altro",
          quantity: it.quantity ?? 1,
          // Keep null prices null (highlighted "da inserire"), never silently 0.
          totalPrice: typeof it.totalPrice === "number" ? it.totalPrice : null,
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
        { clientId: newId(), rawName: "", canonicalName: "", category: "Altro", quantity: 1, totalPrice: null },
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
        items: draft.items.map((it) => {
          const qty = Number(it.quantity) || 1;
          const price = missingPrice(it) ? 0 : Number(it.totalPrice) || 0;
          return {
            rawName: it.rawName,
            canonicalName: (it.canonicalName || it.rawName || "").trim().toLowerCase(),
            category: it.category,
            quantity: qty,
            unitPrice: price ? price / qty : null,
            totalPrice: price,
          };
        }),
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

  // Live reconciliation between the editable product lines and the receipt total.
  const itemsSum = draft ? draft.items.reduce((s, it) => s + (Number(it.totalPrice) || 0), 0) : 0;
  const totalNum = Number(draft?.total) || 0;
  const reconciles = Math.abs(itemsSum - totalNum) <= 0.01;
  const missingCount = draft ? draft.items.filter(missingPrice).length : 0;

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
          <p className="text-sm text-slate-500">Controlla e correggi prima di registrare. Il saldo verrà scalato una sola volta sul <b>Totale</b>.</p>

          {/* Warning banner when the OCR extraction is likely incomplete/inaccurate */}
          {(draft.warning || missingCount > 0) && (
            <div className="text-sm bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3">
              ⚠️ Verifica i prodotti: alcuni prezzi o righe potrebbero essere errati o mancanti
              {missingCount > 0 ? ` (${missingCount} senza prezzo)` : ""}. Il <b>Totale</b> in fondo
              allo scontrino è affidabile: correggi pure i prodotti con calma, la contabilità usa il Totale.
            </div>
          )}

          {/* Live reconciliation: products sum vs receipt total */}
          <div className={`text-sm rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 ${reconciles ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
            <span>Somma prodotti: <b>{eur(itemsSum)}</b> · Totale scontrino: <b>{eur(totalNum)}</b></span>
            <span className="font-semibold">
              {reconciles ? "✓ Quadra" : `Differenza ${eur(Math.abs(itemsSum - totalNum))}`}
            </span>
          </div>

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
            </div>
            {draft.items.map((it) => {
              const noPrice = missingPrice(it);
              return (
                <div
                  key={it.clientId}
                  className={`flex flex-wrap gap-2 items-center text-sm rounded p-1.5 ${noPrice ? "bg-amber-50 ring-1 ring-amber-300" : "border-b border-slate-50 sm:border-0"}`}
                >
                  <input
                    value={it.rawName}
                    onChange={(e) => setItem(it.clientId, "rawName", e.target.value)}
                    placeholder="Prodotto"
                    className="w-full sm:flex-1 px-2 py-1.5 border border-slate-300 rounded"
                  />
                  <select
                    value={it.category}
                    onChange={(e) => setItem(it.clientId, "category", e.target.value)}
                    className="flex-1 sm:flex-none px-1 py-1.5 border border-slate-300 rounded sm:w-32"
                  >
                    {PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="number" step="1" min="0" inputMode="numeric"
                    value={it.quantity}
                    onChange={(e) => setItem(it.clientId, "quantity", e.target.value)}
                    className="w-14 px-1 py-1.5 border border-slate-300 rounded text-center"
                    title="Quantità"
                  />
                  <input
                    type="number" step="0.01" min="0" inputMode="decimal"
                    value={it.totalPrice ?? ""}
                    onChange={(e) => setItem(it.clientId, "totalPrice", e.target.value)}
                    placeholder={noPrice ? "da inserire" : "€"}
                    className={`w-24 px-2 py-1.5 border rounded text-right ${noPrice ? "border-amber-400 bg-white placeholder-amber-500" : "border-slate-300"}`}
                    title="Prezzo €"
                  />
                  <button onClick={() => removeItem(it.clientId)} className="text-slate-300 hover:text-rose-600 px-1" title="Elimina">✕</button>
                </div>
              );
            })}
            {draft.items.length === 0 && <p className="text-xs text-slate-400">Nessun prodotto. Aggiungine uno o registra solo il totale.</p>}

            {/* Prominent add-row button for products the OCR skipped */}
            <button
              onClick={addItem}
              className="w-full mt-1 px-4 py-2 border border-dashed border-emerald-400 text-emerald-700 rounded-lg hover:bg-emerald-50"
            >
              + Aggiungi riga
            </button>
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
