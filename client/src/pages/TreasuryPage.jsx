import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { eur } from "../lib/format.js";
import Segmented from "../components/Segmented.jsx";

const DEADLINE_TYPES = [
  { value: "IRPEF_SALDO", label: "IRPEF saldo" },
  { value: "IRPEF_ACCONTO", label: "IRPEF acconto" },
  { value: "IVA", label: "IVA" },
  { value: "INPS", label: "INPS" },
  { value: "ALTRO", label: "Altro" },
];
const TYPE_LABELS = Object.fromEntries(DEADLINE_TYPES.map((t) => [t.value, t.label]));

const VERDICT_STYLES = {
  OK: { badge: "bg-brand-50 text-brand-700", label: "Ce la fai" },
  RISCHIO: { badge: "bg-tax-50 text-tax-600", label: "Rischioso" },
  NO: { badge: "bg-rose-50 text-rose-600", label: "Non ce la fai" },
};

const emptyDeadline = { name: "", type: "IVA", dueDate: "", expectedAmount: "" };

export default function TreasuryPage() {
  const {
    deadlines, fetchDeadlines, saveDeadline, deleteDeadline, togglePaid,
    profile, fetchProfile,
    simulation, simulating, simulate,
    fiscalProfile, suggestedMinPercent, belowSuggested, fetchFiscalProfile, saveFiscalProfile,
  } = useTreasuryStore();

  const [scope, setScope] = useState("user");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyDeadline);
  const [simAmount, setSimAmount] = useState("");
  const [fiscal, setFiscal] = useState({
    regime: "FORFETTARIO", partitaIva: "", coeffRedditivita: "", aliquotaImposta: "", aliquotaInps: "", defaultTaxPercent: "",
  });
  const [fiscalSaved, setFiscalSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchDeadlines();
    fetchFiscalProfile();
  }, [fetchDeadlines, fetchFiscalProfile]);

  useEffect(() => {
    fetchProfile(scope);
  }, [scope, fetchProfile]);

  useEffect(() => {
    if (fiscalProfile) {
      setFiscal({
        regime: fiscalProfile.regime ?? "FORFETTARIO",
        partitaIva: fiscalProfile.partitaIva ?? "",
        coeffRedditivita: fiscalProfile.coeffRedditivita ?? "",
        aliquotaImposta: fiscalProfile.aliquotaImposta ?? "",
        aliquotaInps: fiscalProfile.aliquotaInps ?? "",
        defaultTaxPercent: fiscalProfile.defaultTaxPercent ?? "",
      });
    }
  }, [fiscalProfile]);

  const openNew = () => { setForm(emptyDeadline); setEditId(null); setShowForm(true); };
  const openEdit = (d) => {
    setForm({ name: d.name, type: d.type, dueDate: String(d.dueDate).slice(0, 10), expectedAmount: d.expectedAmount });
    setEditId(d.id);
    setShowForm(true);
  };

  const submitDeadline = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await saveDeadline(
        { name: form.name, type: form.type, dueDate: form.dueDate, expectedAmount: Number(form.expectedAmount) },
        editId
      );
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error || "Errore nel salvataggio della scadenza");
    }
  };

  const runSimulation = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await simulate(Number(simAmount), scope);
    } catch (err) {
      setError(err.response?.data?.error || "Simulazione fallita");
    }
  };

  const submitFiscal = async (e) => {
    e.preventDefault();
    setError("");
    setFiscalSaved(false);
    try {
      await saveFiscalProfile({
        regime: fiscal.regime,
        partitaIva: fiscal.partitaIva.trim() || null,
        coeffRedditivita: fiscal.coeffRedditivita === "" ? null : Number(fiscal.coeffRedditivita),
        aliquotaImposta: fiscal.aliquotaImposta === "" ? null : Number(fiscal.aliquotaImposta),
        aliquotaInps: fiscal.aliquotaInps === "" ? null : Number(fiscal.aliquotaInps),
        defaultTaxPercent: fiscal.defaultTaxPercent === "" ? null : Number(fiscal.defaultTaxPercent),
      });
      setFiscalSaved(true);
      setTimeout(() => setFiscalSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || "Errore nel salvataggio del profilo");
    }
  };

  const insufficientData = profile && profile.ok === false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tesoreria</h1>
        <Segmented
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "user", label: "Solo io" },
            { value: "household", label: "Famiglia" },
          ]}
        />
      </div>

      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {/* ============ (a) Scadenze fiscali ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Scadenze fiscali</h2>
          <button onClick={openNew} className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            + Nuova scadenza
          </button>
        </div>

        {showForm && (
          <form onSubmit={submitDeadline} className="card p-4 space-y-3 text-sm">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-600 mb-1">Nome</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="es. Saldo IRPEF 2026"
                  className="w-full px-2 py-1.5 border border-card-line rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-600 mb-1">Importo previsto €</label>
                <input
                  type="number" step="0.01" min="0.01" required
                  value={form.expectedAmount}
                  onChange={(e) => setForm((f) => ({ ...f, expectedAmount: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-card-line rounded-lg nums"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Tipo</label>
              <Segmented
                size="sm"
                value={form.type}
                onChange={(v) => setForm((f) => ({ ...f, type: v }))}
                options={DEADLINE_TYPES}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Data scadenza</label>
              <input
                type="date" required
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                className="px-2 py-1.5 border border-card-line rounded-lg"
              />
              {form.dueDate && dayjs(form.dueDate).isBefore(dayjs(), "day") && (
                <p className="text-xs text-tax-600 mt-1">Attenzione: la data è nel passato</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-ink-600 hover:text-ink-900">
                Annulla
              </button>
              <button type="submit" className="px-4 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                {editId ? "Salva modifiche" : "Aggiungi scadenza"}
              </button>
            </div>
          </form>
        )}

        <div className="card divide-y divide-card-line">
          {deadlines.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">
              Nessuna scadenza. Aggiungi le tue scadenze fiscali (saldo, acconti, IVA, INPS) per attivare i promemoria e il simulatore.
            </p>
          ) : (
            deadlines.map((d) => (
              <div key={d.id} className="p-3 flex flex-wrap items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {d.name}
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-paper text-ink-600">{TYPE_LABELS[d.type] || d.type}</span>
                    {d.overdue && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 font-semibold">Scaduta</span>}
                    {d.paid && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Pagata</span>}
                  </div>
                  <div className="text-ink-400">
                    {dayjs(d.dueDate).format("D MMMM YYYY")}
                    {!d.paid && d.daysUntil >= 0 && <span> · tra {d.daysUntil} giorni</span>}
                  </div>
                </div>
                <span className={`font-semibold nums ${d.paid ? "text-ink-400 line-through" : "text-tax-600"}`}>
                  {eur(d.expectedAmount)}
                </span>
                <button
                  onClick={() => togglePaid(d.id, !d.paid)}
                  className={`px-2.5 py-1 text-xs rounded-lg border ${d.paid ? "border-card-line text-ink-600 hover:bg-paper" : "border-brand-600 text-brand-600 hover:bg-brand-50"}`}
                >
                  {d.paid ? "Segna da pagare" : "Segna pagata"}
                </button>
                <button onClick={() => openEdit(d)} className="text-ink-400 hover:text-brand-600 px-1" title="Modifica">✎</button>
                <button onClick={() => deleteDeadline(d.id)} className="text-ink-400 hover:text-rose-600 px-1" title="Elimina">✕</button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ============ (b) Profilo finanziario ============ */}
      <section className="space-y-3">
        <h2 className="font-semibold">Il tuo profilo finanziario</h2>
        {!profile ? (
          <p className="text-sm text-ink-400">Caricamento…</p>
        ) : insufficientData ? (
          <div className="card p-4 text-sm text-ink-600">
            <strong>Dati insufficienti.</strong> Servono almeno 3 mesi di transazioni per costruire il profilo
            (hai {profile.monthsAnalyzed} {profile.monthsAnalyzed === 1 ? "mese" : "mesi"}). Continua a registrare
            entrate e uscite: il simulatore si attiverà da solo.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-3">
              <div className="text-[11px] text-ink-600 leading-tight">Entrata mediana / mese</div>
              <div className="text-lg font-bold text-brand-600 nums mt-1">{eur(profile.medianMonthlyIncome)}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] text-ink-600 leading-tight">Spesa media / mese{scope === "user" ? " (tua quota)" : ""}</div>
              <div className="text-lg font-bold text-ink-900 nums mt-1">{eur(profile.avgMonthlyExpense)}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] text-ink-600 leading-tight">Capacità / mese (prudente)</div>
              <div className={`text-lg font-bold nums mt-1 ${profile.capacity.buffered.p50 > 0 ? "text-brand-600" : "text-rose-600"}`}>
                {eur(profile.capacity.buffered.p50)}
              </div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] text-ink-600 leading-tight">Aliquota effettiva</div>
              <div className="text-lg font-bold text-tax-600 nums mt-1">
                {profile.effectiveTaxPercent != null ? `${profile.effectiveTaxPercent.toFixed(1)}%` : "n.d."}
              </div>
            </div>
          </div>
        )}
        {profile?.ok && profile.recurring?.length > 0 && (
          <div className="card p-3 text-xs text-ink-600">
            <span className="font-semibold">Spese ricorrenti rilevate:</span>{" "}
            {profile.recurring.map((r) => `${r.category} (${eur(r.avgMonthly)}/mese)`).join(" · ")}
          </div>
        )}
      </section>

      {/* ============ (c) Simulatore ============ */}
      <section className="space-y-3">
        <h2 className="font-semibold">Posso usare il fondo tasse?</h2>
        <p className="text-sm text-ink-600">
          Simula un prelievo dal salvadanaio tasse: il sistema calcola in quanto tempo riesci a
          reintegrarlo con le tue entrate e lo confronta con la prossima scadenza.
        </p>
        <form onSubmit={runSimulation} className="card p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Importo che ti serve €</label>
            <input
              type="number" step="1" min="1" required
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              disabled={insufficientData}
              className="w-40 px-2 py-2 border border-card-line rounded-lg nums disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={simulating || insufficientData}
            className="px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {simulating ? "Calcolo…" : "Simula"}
          </button>
          {insufficientData && <span className="text-xs text-ink-400">Disponibile con almeno 3 mesi di dati</span>}
        </form>

        {simulation?.ok && (
          <div className="space-y-3">
            {/* Verdetto complessivo */}
            <div className={`card p-4 flex items-center justify-between ${VERDICT_STYLES[simulation.overallVerdict].badge}`}>
              <div>
                <div className="text-xs opacity-80">Verdetto per {eur(simulation.amount)}</div>
                <div className="text-xl font-bold">{VERDICT_STYLES[simulation.overallVerdict].label}</div>
              </div>
              <div className="text-right text-xs">
                <div>Fondo tasse disponibile: <strong className="nums">{eur(simulation.fundAvailable)}</strong></div>
                {simulation.exceedsFund && (
                  <div className="text-rose-600 font-semibold mt-0.5">L'importo supera il fondo disponibile</div>
                )}
                {simulation.overdueCount > 0 && (
                  <div className="text-rose-600 font-semibold mt-0.5">{simulation.overdueCount} scadenza/e già oltre la data</div>
                )}
              </div>
            </div>

            {/* Incassi attesi (fatture emesse non ancora incassate) */}
            {simulation.expectedCollections && (
              <div className="card p-4 text-sm bg-brand-50/50">
                <div className="font-semibold mb-1">
                  Incassi attesi: {simulation.expectedCollections.count}{" "}
                  {simulation.expectedCollections.count === 1 ? "fattura" : "fatture"} per{" "}
                  <span className="nums">{eur(simulation.expectedCollections.gross)}</span>
                </div>
                <p className="text-xs text-ink-600">
                  Al netto dell'accantonamento tasse ({simulation.expectedCollections.taxPercent}%) valgono{" "}
                  <strong className="nums">{eur(simulation.expectedCollections.net)}</strong> di capacità di rientro.
                  Primo incasso stimato: <strong>{dayjs(simulation.expectedCollections.nextExpectedAt).format("D MMM YYYY")}</strong>{" "}
                  ({simulation.expectedCollections.delaySource === "storico"
                    ? `in base ai tuoi tempi medi d'incasso, ~${simulation.expectedCollections.delayDays} gg`
                    : `stima prudenziale ${simulation.expectedCollections.delayDays} gg, ancora pochi incassi storici`}).
                  Contano negli scenari realistico e ottimista; il pessimista li esclude per prudenza.
                </p>
              </div>
            )}

            {/* Scenari */}
            <div className="grid sm:grid-cols-3 gap-3">
              {simulation.scenarios.map((s) => (
                <div key={s.name} className="card p-4 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold capitalize">{s.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${VERDICT_STYLES[s.verdict].badge}`}>
                      {s.verdict}
                    </span>
                  </div>
                  {s.monthsToRepay == null ? (
                    <p className="text-ink-400 text-xs">Capacità mensile insufficiente per rientrare.</p>
                  ) : (
                    <div className="space-y-1 text-xs text-ink-600">
                      <div>Rientro: <strong className="nums">{eur(s.monthlyCapacity)}</strong>/mese</div>
                      <div>Tempo: <strong>{s.monthsToRepay} {s.monthsToRepay === 1 ? "mese" : "mesi"}</strong></div>
                      <div>Reintegro entro: <strong>{dayjs(s.repaidBy).format("D MMM YYYY")}</strong></div>
                      {simulation.expectedCollections && (
                        <div className="text-ink-400">
                          {s.withCollections ? "Include gli incassi attesi" : "Senza incassi attesi"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {simulation.nextDeadline && (
              <p className="text-sm text-ink-600">
                Prossima scadenza: <strong>{simulation.nextDeadline.name}</strong> —{" "}
                <span className="text-tax-600 font-semibold nums">{eur(simulation.nextDeadline.expectedAmount)}</span>{" "}
                il {dayjs(simulation.nextDeadline.dueDate).format("D MMMM YYYY")}
              </p>
            )}
            <p className="text-xs text-ink-400">{simulation.disclaimer}</p>
          </div>
        )}
      </section>

      {/* ============ (d) Profilo fiscale ============ */}
      <section className="space-y-3">
        <h2 className="font-semibold">Profilo fiscale</h2>
        {belowSuggested && (
          <div className="bg-tax-50 text-tax-600 rounded-xl p-3 text-sm">
            ⚠ Stai accantonando il <strong>{fiscalProfile?.defaultTaxPercent}%</strong>, ma con il tuo profilo
            la stima minima è <strong>{suggestedMinPercent}%</strong>. Rischi di trovarti scoperto alla prossima scadenza.
          </div>
        )}
        <form onSubmit={submitFiscal} className="card p-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs text-ink-600 mb-1">Regime</label>
            <Segmented
              size="sm"
              value={fiscal.regime}
              onChange={(v) => setFiscal((f) => ({ ...f, regime: v }))}
              options={[
                { value: "FORFETTARIO", label: "Forfettario" },
                { value: "ORDINARIO", label: "Ordinario" },
                { value: "ALTRO", label: "Altro" },
              ]}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-600 mb-1">Partita IVA (per l'import fatture)</label>
            <input
              type="text" inputMode="numeric" maxLength={11} placeholder="11 cifre"
              value={fiscal.partitaIva}
              onChange={(e) => setFiscal((f) => ({ ...f, partitaIva: e.target.value.replace(/\D/g, "") }))}
              className="w-44 px-2 py-1.5 border border-card-line rounded-lg nums"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-ink-600 mb-1">Coeff. redditività (0–1)</label>
              <input type="number" step="0.01" min="0.01" max="1" value={fiscal.coeffRedditivita}
                onChange={(e) => setFiscal((f) => ({ ...f, coeffRedditivita: e.target.value }))}
                placeholder="0.78"
                className="w-full px-2 py-1.5 border border-card-line rounded-lg nums" />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Imposta %</label>
              <input type="number" step="0.01" min="0" max="100" value={fiscal.aliquotaImposta}
                onChange={(e) => setFiscal((f) => ({ ...f, aliquotaImposta: e.target.value }))}
                placeholder="15"
                className="w-full px-2 py-1.5 border border-card-line rounded-lg nums" />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">INPS %</label>
              <input type="number" step="0.01" min="0" max="100" value={fiscal.aliquotaInps}
                onChange={(e) => setFiscal((f) => ({ ...f, aliquotaInps: e.target.value }))}
                placeholder="26.23"
                className="w-full px-2 py-1.5 border border-card-line rounded-lg nums" />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">% accantonamento tua</label>
              <input type="number" step="1" min="0" max="100" value={fiscal.defaultTaxPercent}
                onChange={(e) => setFiscal((f) => ({ ...f, defaultTaxPercent: e.target.value }))}
                placeholder="30"
                className="w-full px-2 py-1.5 border border-card-line rounded-lg nums" />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs text-ink-600">
              {suggestedMinPercent != null
                ? <>Stima minima suggerita: <strong className="text-tax-600">{suggestedMinPercent}%</strong></>
                : "Compila coefficiente e aliquote per la stima minima"}
              <span className="text-ink-400"> · Stima, non consulenza fiscale</span>
            </span>
            <div className="flex items-center gap-2">
              {fiscalSaved && <span className="text-brand-600 text-xs">Salvato ✓</span>}
              <button type="submit" className="px-4 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
                Salva profilo
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
