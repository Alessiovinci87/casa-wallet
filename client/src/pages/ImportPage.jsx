import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";
import { useRecurringStore } from "../store/recurringStore.js";
import { useTransactionStore } from "../store/transactionStore.js";

// Import estratto conto (CSV, Excel, XML, PDF): 1) file → 2) mappa colonne (salvata sulla famiglia; saltata per PDF/camt)
// → 3) anteprima con categorie proposte e duplicati → 4) esito + ricorrenze rilevate.

const FORMAT_LABELS = { csv: "CSV", xlsx: "Excel", xls: "Excel", "xml-excel": "Excel XML", xml: "XML", camt: "XML camt.053", pdf: "PDF" };

const COLS = [
  { key: "dateCol", label: "Data" },
  { key: "descCol", label: "Descrizione" },
  { key: "amountCol", label: "Importo (unica colonna, segno ±)" },
  { key: "debitCol", label: "Uscite (colonna separata)" },
  { key: "creditCol", label: "Entrate (colonna separata)" },
];

export default function ImportPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromOnboarding = params.get("from") === "onboarding";
  const createRule = useRecurringStore((s) => s.createRule);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({ dateCol: "", descCol: "", amountCol: "", debitCol: "", creditCol: "", invertSign: false });
  const [rows, setRows] = useState([]);
  const [method, setMethod] = useState("TRANSFER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [created, setCreated] = useState({});
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);

  const upload = async (f, map, save) => {
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      if (map) fd.append("mapping", JSON.stringify(map));
      if (save) fd.append("saveMapping", "true");
      const { data } = await api.post("/api/import/bank-csv/preview", fd);
      setPreview(data);
      if (data.mapping) {
        setMapping({
          dateCol: data.mapping.dateCol ?? "",
          descCol: data.mapping.descCol ?? "",
          amountCol: data.mapping.amountCol ?? "",
          debitCol: data.mapping.debitCol ?? "",
          creditCol: data.mapping.creditCol ?? "",
          invertSign: Boolean(data.mapping.invertSign),
        });
      }
      if (data.parsed) {
        // Senza categoria → "Altro", con flag per il filtro "da categorizzare".
        setRows(data.parsed.map((r) => ({ ...r, include: !r.error && !r.duplicate, learn: false, needsCategory: !r.error && !r.category, category: r.category || (r.error ? null : "Altro") })));
      }
    } catch (err) {
      setError(err.response?.data?.error || "Lettura del file non riuscita");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(null);
    setRows([]);
    setResult(null);
    upload(f, null, false);
  };

  const applyMapping = () => {
    const m = {
      dateCol: mapping.dateCol,
      descCol: mapping.descCol,
      amountCol: mapping.amountCol,
      debitCol: mapping.debitCol,
      creditCol: mapping.creditCol,
      invertSign: mapping.invertSign,
    };
    if (m.dateCol === "" || m.descCol === "" || (m.amountCol === "" && (m.debitCol === "" || m.creditCol === ""))) {
      setError("Indica almeno Data, Descrizione e Importo (oppure Uscite + Entrate).");
      return;
    }
    upload(file, m, true);
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const commit = async () => {
    const selected = rows.filter((r) => r.include && !r.error);
    if (selected.some((r) => !r.category)) {
      setError("Assegna una categoria a tutte le righe selezionate (o deselezionale).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/api/import/bank-csv/commit", {
        rows: selected.map((r) => ({ date: r.date, amount: r.amount, type: r.type, description: r.description, category: r.category, hash: r.hash, learn: r.learn })),
        method,
      });
      setResult(data);
      fetchTransactions();
      const c = await api.get("/api/import/recurrence-candidates");
      setCandidates(c.data.proposals);
    } catch (err) {
      setError(err.response?.data?.error || "Import non riuscito");
    } finally {
      setBusy(false);
    }
  };

  const makeRule = async (p, i) => {
    try {
      await createRule({
        type: p.type,
        amount: p.amount,
        category: p.category || (p.type === "INCOME" ? "Altro" : "Altro"),
        method: "TRANSFER",
        description: p.description.replace(/\s*n\.?\s*\d+.*$/i, "").trim().slice(0, 60),
        frequency: "MONTHLY",
        dayOfMonth: p.dayOfMonth,
        startDate: p.lastDate || new Date().toISOString(),
        autoPost: true,
        linkTransactionIds: p.transactionIds, // le righe già importate finiscono in Fisse
      });
      fetchTransactions();
      setCreated((c) => ({ ...c, [i]: true }));
    } catch (err) {
      window.alert(err.response?.data?.error || "Creazione ricorrenza non riuscita");
    }
  };

  useEffect(() => {
    // Anche senza import: mostra le ricorrenze rilevate dallo storico.
    api.get("/api/import/recurrence-candidates").then((r) => setCandidates(r.data.proposals)).catch(() => {});
  }, []);

  const colOptions = preview ? [{ value: "", label: "—" }, ...preview.headers.map((h, i) => ({ value: i, label: h || `col ${i + 1}` }))] : [];
  const selectedCount = rows.filter((r) => r.include && !r.error).length;

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Importa estratto conto</h1>
      <p className="text-sm text-ink-600">
        Scarica l'estratto conto dalla tua banca (CSV, Excel, XML o PDF) e caricalo qui. Per CSV ed Excel mappi le colonne una volta sola; l'app riconosce i doppioni e propone le categorie.
      </p>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {/* 1) File */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <label className="px-4 py-2 bg-brand-600 text-white rounded cursor-pointer hover:bg-brand-700">
          {busy && !preview ? "Leggo…" : "Scegli file"}
          <input type="file" accept=".csv,text/csv,.txt,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xml,text/xml,application/xml,.pdf,application/pdf" className="hidden" onChange={onFile} />
        </label>
        {file && (
          <span className="text-sm text-ink-600">
            {file.name} {preview && `· ${preview.totalRows} righe · ${FORMAT_LABELS[preview.format] || preview.format}`}
            {preview?.format === "csv" && ` · separatore "${preview.delimiter === "	" ? "TAB" : preview.delimiter}"`}
          </span>
        )}
        {preview?.format === "pdf" && (
          <p className="w-full text-xs text-tax-600">
            Dal PDF leggo data, descrizione e importo riga per riga: controlla nell'anteprima che il segno (entrata/uscita) sia giusto. Se puoi, preferisci Excel o XML.
          </p>
        )}
      </div>

      {/* 2) Mappa colonne */}
      {preview && !preview.autoMapped && (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink-600">Colonne {preview.savedMapping && <span className="text-ink-400 font-normal">· mapping salvato</span>}</h2>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead><tr>{preview.headers.map((h, i) => <th key={i} className="text-left px-2 py-1 text-ink-600 whitespace-nowrap">{h || `col ${i + 1}`}</th>)}</tr></thead>
              <tbody>{preview.sample.map((r, i) => <tr key={i} className="border-t border-card-line">{r.map((c, j) => <td key={j} className="px-2 py-1 whitespace-nowrap max-w-[220px] truncate">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {COLS.map((c) => (
            <div key={c.key}>
              <label className="block text-xs text-ink-600 mb-1">{c.label}</label>
              <Segmented size="sm" value={mapping[c.key]} onChange={(v) => setMapping((m) => ({ ...m, [c.key]: v }))} options={colOptions} />
            </div>
          ))}
          <div>
            <label className="block text-xs text-ink-600 mb-1">Segno degli importi</label>
            <Segmented size="sm" value={mapping.invertSign} onChange={(v) => setMapping((m) => ({ ...m, invertSign: v }))} options={[{ value: false, label: "Negativo = uscita" }, { value: true, label: "Positivo = uscita" }]} />
          </div>
          <button onClick={applyMapping} disabled={busy} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
            {busy ? "…" : "Applica e salva mapping"}
          </button>
        </div>
      )}

      {/* 3) Anteprima */}
      {preview?.parsed && !result && (
        <div className="card">
          <div className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-semibold">{preview.stats.total} righe</span>
              <span className="text-ink-400"> · {preview.stats.duplicates} già presenti · {preview.stats.errors} non lette · {preview.stats.uncategorized} senza categoria</span>
            </div>
            <Segmented size="sm" value={onlyUncategorized} onChange={setOnlyUncategorized} options={[{ value: false, label: "Tutte" }, { value: true, label: `Da categorizzare (${rows.filter((r) => r.needsCategory).length})` }]} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-600">Metodo</span>
              <Segmented size="sm" value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }))} />
            </div>
          </div>
          <div className="divide-y divide-card-line max-h-[60vh] overflow-y-auto">
            {rows.map((r, i) => (onlyUncategorized && !r.needsCategory) ? null : (
              <div key={i} className={`p-3 flex items-center gap-3 text-sm ${r.error || r.duplicate ? "opacity-50" : ""}`}>
                <input type="checkbox" checked={Boolean(r.include)} disabled={Boolean(r.error)} onChange={(e) => setRow(i, { include: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{r.error ? <span className="text-rose-600">riga {r.line}: {r.error}</span> : r.description}</div>
                  {!r.error && (
                    <div className="text-xs text-ink-400">
                      {dayjs(r.date).format("DD/MM/YYYY")} · {r.type === "INCOME" ? "entrata" : "uscita"}
                      {r.duplicate && <span className="text-tax-600"> · già importata</span>}
                      {r.categorySource === "rule" && <span> · categoria da regola</span>}
                      {r.needsCategory && <span className="text-tax-600"> · da categorizzare</span>}
                    </div>
                  )}
                  {!r.error && r.include && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {/* Categoria: tendina qui per compattezza (molte righe × molte categorie). */}
                      <select value={r.category || ""} onChange={(e) => setRow(i, { category: e.target.value, needsCategory: false })} className={`px-2 py-1 border rounded-lg text-xs min-h-[44px] ${r.needsCategory ? "border-tax-600" : "border-card-line"}`}>
                        <option value="">— categoria —</option>
                        {CATEGORIES[r.type].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <label className="text-[11px] text-ink-600 flex items-center gap-1">
                        <input type="checkbox" checked={Boolean(r.learn)} onChange={(e) => setRow(i, { learn: e.target.checked })} /> ricorda
                      </label>
                    </div>
                  )}
                </div>
                {!r.error && <span className={`shrink-0 font-semibold nums ${r.type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>{r.type === "INCOME" ? "+" : "−"}{eur(r.amount)}</span>}
              </div>
            ))}
          </div>
          <div className="p-3 flex justify-end">
            <button onClick={commit} disabled={busy || selectedCount === 0} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">
              {busy ? "Importo…" : `Importa ${selectedCount} righe`}
            </button>
          </div>
        </div>
      )}

      {/* 4) Esito */}
      {result && (
        <div className="card p-4 text-sm">
          <div className="font-semibold text-brand-700">Import completato</div>
          <div className="text-ink-600 mt-1">{result.created} transazioni create · {result.skipped} saltate (già presenti){result.errors.length ? ` · ${result.errors.length} errori` : ""}</div>
          <div className="mt-2 flex gap-2">
            {fromOnboarding ? (
              <button onClick={() => navigate("/onboarding?step=2")} className="px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold">Torna al Punto zero</button>
            ) : (
              <button onClick={() => navigate("/movements?tab=expenses")} className="px-3 py-1.5 border border-card-line rounded-lg text-ink-600 text-xs">Vai a Uscite</button>
            )}
            <button onClick={() => { setResult(null); setPreview(null); setFile(null); setRows([]); }} className="px-3 py-1.5 border border-card-line rounded-lg text-ink-600 text-xs">Nuovo import</button>
          </div>
        </div>
      )}

      {/* Ricorrenze rilevate */}
      {candidates && candidates.length > 0 && (
        <div className="card">
          <div className="p-3">
            <h2 className="text-sm font-semibold text-ink-600">Ricorrenze rilevate</h2>
            <p className="text-xs text-ink-400">Stesso importo (±2%) e stesso giorno (±3) per almeno 3 mesi. Un tocco e diventano regole.</p>
          </div>
          <ul className="divide-y divide-card-line">
            {candidates.map((p, i) => (
              <li key={i} className="p-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.description}</div>
                  <div className="text-xs text-ink-400">{p.type === "INCOME" ? "entrata" : "uscita"} · il {p.dayOfMonth} · {p.months} mesi · {p.category || "senza categoria"}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold nums">{eur(p.amount)}</span>
                  {created[i] ? (
                    <span className="text-xs text-brand-600">Creata ✓</span>
                  ) : (
                    <button onClick={() => makeRule(p, i)} className="px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg">Crea ricorrenza</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
