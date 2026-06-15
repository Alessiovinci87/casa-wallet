import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import { PAY_METHOD_LABELS } from "../lib/constants.js";

export default function OcrPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError("");
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const { data } = await api.post("/api/ocr/parse", fd);
      setResult(data);
    } catch {
      setError("Analisi non riuscita");
    } finally {
      setBusy(false);
    }
  };

  const useData = () => {
    // Hand the parsed data to the transactions form via router state.
    navigate("/transactions", { state: { prefill: result } });
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-bold">Leggi notifica bancaria</h1>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
        className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center text-slate-500 cursor-pointer hover:border-emerald-400"
      >
        {preview ? (
          <img src={preview} alt="anteprima" className="max-h-64 mx-auto rounded" />
        ) : (
          <span>Trascina qui uno screenshot o clicca per caricarlo</span>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </label>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {file && (
        <button onClick={analyze} disabled={busy} className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "Analisi…" : "Analizza"}
        </button>
      )}

      {result && (
        <div className="bg-white rounded-xl p-4 shadow-sm space-y-1 text-sm">
          <h2 className="font-semibold mb-2">Dati estratti</h2>
          <div>Importo: <b>{result.amount != null ? eur(result.amount) : "—"}</b></div>
          <div>Tipo: <b>{result.type ?? "—"}</b></div>
          <div>Metodo: <b>{result.method ? PAY_METHOD_LABELS[result.method] ?? result.method : "—"}</b></div>
          <div>Data: <b>{result.date ?? "—"}</b></div>
          <div>Descrizione: <b>{result.description ?? "—"}</b></div>
          <button onClick={useData} className="mt-3 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
            Usa questi dati
          </button>
        </div>
      )}
    </div>
  );
}
