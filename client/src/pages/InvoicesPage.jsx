import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { useInvoiceStore } from "../store/invoiceStore.js";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { eur } from "../lib/format.js";
import { PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import Segmented from "../components/Segmented.jsx";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

const WARNING_LABELS = {
  PAGAMENTI_NON_COINCIDONO: "Gli importi di pagamento nel file non coincidono col netto calcolato",
  TOTALE_DOCUMENTO_DIVERSO: "Il totale dichiarato nel file non coincide coi calcoli",
};

export default function InvoicesPage() {
  const {
    invoices, loading, filters, setFilters, fetchInvoices,
    importing, importResult, importXml,
    collect, uncollect, remove,
    aruba, fetchAruba, connectAruba, disconnectAruba, syncing, syncResult, syncAruba,
  } = useInvoiceStore();
  const { fiscalProfile, fetchFiscalProfile } = useTreasuryStore();

  const fileRef = useRef(null);
  const [collectTarget, setCollectTarget] = useState(null); // invoice per il modal
  const [collectForm, setCollectForm] = useState({ taxPercent: "", method: "TRANSFER", date: "" });
  const [arubaForm, setArubaForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    fetchInvoices();
    fetchAruba();
    fetchFiscalProfile();
  }, [fetchInvoices, fetchAruba, fetchFiscalProfile]);

  const handleImport = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = ""; // permette il re-upload dello stesso file
    if (!files.length) return;
    setError("");
    try {
      await importXml(files);
    } catch (err) {
      setError(err.response?.data?.error || "Import fallito");
    }
  };

  const openCollect = (inv) => {
    setCollectTarget(inv);
    setCollectForm({
      taxPercent: fiscalProfile?.defaultTaxPercent ?? "",
      method: "TRANSFER",
      date: dayjs().format("YYYY-MM-DD"),
    });
  };

  const submitCollect = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await collect(collectTarget.id, {
        taxPercent: collectForm.taxPercent === "" ? null : Number(collectForm.taxPercent),
        method: collectForm.method,
        date: collectForm.date,
      });
      setCollectTarget(null);
    } catch (err) {
      setError(err.response?.data?.error || "Registrazione incasso fallita");
    }
  };

  const handleConnectAruba = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await connectAruba(arubaForm.username, arubaForm.password);
      setArubaForm({ username: "", password: "" });
    } catch (err) {
      setError(err.response?.data?.error || "Connessione Aruba fallita");
    }
  };

  const previewTax =
    collectTarget && collectForm.taxPercent !== ""
      ? (collectTarget.netToPay * Number(collectForm.taxPercent)) / 100
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Fatture</h1>
        <div className="flex flex-wrap gap-2">
          <Segmented
            size="sm"
            value={filters.status}
            onChange={(v) => setFilters({ status: v })}
            options={[
              { value: "", label: "Tutte" },
              { value: "EMESSA", label: "Emesse" },
              { value: "INCASSATA", label: "Incassate" },
            ]}
          />
          <Segmented
            size="sm"
            value={filters.year}
            onChange={(v) => setFilters({ year: v })}
            options={YEARS.map((y) => ({ value: y, label: String(y) }))}
          />
        </div>
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {!fiscalProfile?.partitaIva && (
        <div className="bg-tax-50 text-tax-600 rounded-xl p-3 text-sm">
          ⚠ Imposta la tua <strong>Partita IVA</strong> nel{" "}
          <Link to="/treasury" className="underline font-semibold">profilo fiscale</Link>: serve a
          verificare che le fatture importate siano davvero tue.
        </div>
      )}

      {/* Upload */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-sm">Importa fatture elettroniche</h2>
            <p className="text-xs text-ink-400 mt-0.5">
              File XML FatturaPA (anche più di uno). Da Fattura24/altri gestionali: scarica l'XML
              della fattura emessa. I .p7m firmati non sono supportati.
            </p>
          </div>
          <input ref={fileRef} type="file" accept=".xml" multiple className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {importing ? "Importazione…" : "Carica XML"}
          </button>
        </div>

        {importResult && (
          <div className="mt-3 space-y-1 text-xs">
            {importResult.imported.length > 0 && (
              <div className="text-brand-700 bg-brand-50 rounded p-2">
                ✓ {importResult.imported.length}{" "}
                {importResult.imported.length === 1 ? "fattura importata" : "fatture importate"}
              </div>
            )}
            {importResult.skipped.map((s, i) => (
              <div key={i} className="text-tax-600 bg-tax-50 rounded p-2">
                ⏭ {s.file}{s.numero ? ` (n. ${s.numero})` : ""}: {s.reason}
              </div>
            ))}
            {importResult.errors.map((e2, i) => (
              <div key={i} className="text-rose-600 bg-rose-50 rounded p-2">
                ✕ {e2.file}: {e2.error}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="card divide-y divide-card-line">
        {loading ? (
          <p className="p-4 text-sm text-ink-400">Caricamento…</p>
        ) : invoices.length === 0 ? (
          <p className="p-4 text-sm text-ink-400">
            Nessuna fattura per i filtri scelti. Carica gli XML o sincronizza Aruba.
          </p>
        ) : (
          invoices.map((inv) => (
            <div key={inv.id} className="p-3 flex flex-wrap items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  Fattura {inv.numero}
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                      inv.status === "INCASSATA" ? "bg-brand-50 text-brand-700" : "bg-tax-50 text-tax-600"
                    }`}
                  >
                    {inv.status === "INCASSATA" ? "Incassata" : "In attesa"}
                  </span>
                  {inv.warning && (
                    <span
                      className="text-tax-600 cursor-help"
                      title={inv.warning.split(",").map((w) => WARNING_LABELS[w] || w).join(" · ")}
                    >
                      ⚠
                    </span>
                  )}
                  {inv.source === "ARUBA" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-paper text-ink-400">Aruba</span>
                  )}
                </div>
                <div className="text-ink-400">
                  {dayjs(inv.date).format("D MMM YYYY")} · {inv.customerName}
                  {inv.status === "INCASSATA" && inv.collectedAt
                    ? ` · incassata il ${dayjs(inv.collectedAt).format("D MMM YYYY")}`
                    : inv.dueDate
                      ? ` · scade il ${dayjs(inv.dueDate).format("D MMM YYYY")}`
                      : ""}
                </div>
              </div>
              <span className={`font-semibold nums ${inv.status === "INCASSATA" ? "text-brand-600" : "text-ink-900"}`}>
                {eur(inv.netToPay)}
              </span>
              {inv.status === "EMESSA" ? (
                <>
                  <button
                    onClick={() => openCollect(inv)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-brand-600 text-brand-600 hover:bg-brand-50"
                  >
                    Segna incassata
                  </button>
                  <button onClick={() => remove(inv.id)} className="text-ink-400 hover:text-rose-600 px-1" title="Elimina">✕</button>
                </>
              ) : (
                <button
                  onClick={() => window.confirm("Annullare l'incasso? L'entrata e l'accantonamento tasse verranno rimossi.") && uncollect(inv.id)}
                  className="px-2.5 py-1 text-xs rounded-lg border border-card-line text-ink-600 hover:bg-paper"
                >
                  Annulla incasso
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Connettore Aruba */}
      <div className="card p-4 space-y-3">
        <div>
          <h2 className="font-semibold text-sm">Connettore Aruba Fatturazione Elettronica</h2>
          <p className="text-xs text-ink-400 mt-0.5">
            Importa automaticamente le fatture inviate dal tuo account Aruba. La password è
            conservata cifrata sul server.
          </p>
        </div>
        {!aruba?.connected ? (
          <form onSubmit={handleConnectAruba} className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-ink-600 mb-1">Username Aruba</label>
              <input
                value={arubaForm.username}
                onChange={(e) => setArubaForm((f) => ({ ...f, username: e.target.value }))}
                required
                className="px-2 py-1.5 border border-card-line rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Password</label>
              <input
                type="password"
                value={arubaForm.password}
                onChange={(e) => setArubaForm((f) => ({ ...f, password: e.target.value }))}
                required
                className="px-2 py-1.5 border border-card-line rounded-lg"
              />
            </div>
            <button type="submit" className="px-4 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
              Collega Aruba
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Connesso come <strong>{aruba.username}</strong>
              <span className="text-ink-400 text-xs ml-2">
                Ultima sincronizzazione: {aruba.lastSyncAt ? dayjs(aruba.lastSyncAt).format("D MMM YYYY HH:mm") : "mai"}
              </span>
            </span>
            <button
              onClick={() => syncAruba().catch((err) => setError(err.response?.data?.error || "Sync fallito"))}
              disabled={syncing}
              className="px-4 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {syncing ? "Sincronizzo…" : "Sincronizza ora"}
            </button>
            <button
              onClick={() => window.confirm("Scollegare Aruba?") && disconnectAruba()}
              className="text-rose-600 text-xs hover:underline"
            >
              Scollega
            </button>
            {syncResult && (
              <span className="text-xs text-ink-600">
                {syncResult.imported} importate · {syncResult.skipped} saltate
                {syncResult.errors?.length ? ` · ${syncResult.errors.length} errori` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Modal incasso */}
      {collectTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-10">
          <form onSubmit={submitCollect} className="card p-6 w-full max-w-sm space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Registra incasso</h2>
              <p className="text-sm text-ink-600 mt-0.5">
                Fattura {collectTarget.numero} — {collectTarget.customerName}
              </p>
            </div>
            <div className="bg-paper rounded-lg p-3 flex justify-between items-baseline">
              <span className="text-sm text-ink-600">Importo che incassi</span>
              <span className="text-xl font-bold text-brand-600 nums">{eur(collectTarget.netToPay)}</span>
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">% tasse da accantonare</label>
              <input
                type="number" step="1" min="0" max="100"
                value={collectForm.taxPercent}
                onChange={(e) => setCollectForm((f) => ({ ...f, taxPercent: e.target.value }))}
                className="w-full px-2 py-2 border border-card-line rounded-lg nums"
              />
              {previewTax != null && previewTax > 0 && (
                <p className="text-xs text-tax-600 mt-1 nums">
                  {eur(previewTax)} andranno nel salvadanaio tasse
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Metodo</label>
              <Segmented
                size="sm"
                value={collectForm.method}
                onChange={(v) => setCollectForm((f) => ({ ...f, method: v }))}
                options={PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }))}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Data incasso</label>
              <input
                type="date" required
                value={collectForm.date}
                onChange={(e) => setCollectForm((f) => ({ ...f, date: e.target.value }))}
                className="px-2 py-2 border border-card-line rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCollectTarget(null)} className="px-4 py-2 text-ink-600 hover:text-ink-900">
                Annulla
              </button>
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                Registra incasso
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
