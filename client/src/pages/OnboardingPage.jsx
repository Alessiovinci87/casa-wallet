import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import { CATEGORIES } from "../lib/constants.js";
import Segmented from "../components/Segmented.jsx";
import AccountsManager from "../components/AccountsManager.jsx";
import { useHouseholdStore } from "../store/householdStore.js";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { useRecurringStore } from "../store/recurringStore.js";
import { useGoalStore } from "../store/goalStore.js";
import { useAuthStore } from "../store/authStore.js";

// Onboarding "Punto zero" (F8): 1) saldo iniziale e data · 2) ricorrenze note ·
// 3) % tasse (se P.IVA) · 4) primi obiettivi · 5) invito al partner.
// Al termine la Dashboard mostra già Disponibile reale e quota obiettivi.
export const ONBOARDING_KEY = "onboardingSeen";

const STEPS = ["Saldo", "Estratto conto", "Ricorrenze", "Tasse", "Obiettivi", "Partner"];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const { household, fetchHousehold, setOpeningBalance } = useHouseholdStore();
  const { fiscalProfile, fetchFiscalProfile, saveFiscalProfile } = useTreasuryStore();
  const { rules, fetchRules, createRule } = useRecurringStore();
  const { goals, fetchGoals, createGoal } = useGoalStore();
  const [step, setStep] = useState(() => Math.min(STEPS.length - 1, Math.max(0, Number(params.get("step")) || 0)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [opening, setOpening] = useState({ amount: "", date: new Date().toISOString().slice(0, 10) });
  const [rule, setRule] = useState({ type: "EXPENSE", description: "", amount: "", dayOfMonth: "", category: "" });
  const [hasVat, setHasVat] = useState(null);
  const [taxPct, setTaxPct] = useState("");
  const [taxOpening, setTaxOpening] = useState("");
  const [goal, setGoal] = useState({ name: "", amount: "", date: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchHousehold();
    fetchFiscalProfile();
    fetchRules().catch(() => {});
    fetchGoals().catch(() => {});
  }, [fetchHousehold, fetchFiscalProfile, fetchRules, fetchGoals]);
  useEffect(() => {
    if (household?.openingBalance != null) {
      setOpening({ amount: household.openingBalance, date: String(household.openingBalanceDate).slice(0, 10) });
    }
  }, [household]);
  useEffect(() => {
    if (fiscalProfile?.defaultTaxPercent != null) { setTaxPct(fiscalProfile.defaultTaxPercent); setHasVat(true); }
  }, [fiscalProfile]);

  const finish = () => {
    try { localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* storage non disponibile */ }
    navigate("/");
  };
  const wrap = async (fn) => {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(err.response?.data?.error || "Operazione non riuscita"); } finally { setBusy(false); }
  };

  const saveOpening = () => wrap(async () => {
    if (opening.amount === "" || !Number.isFinite(Number(opening.amount))) throw new Error("Il saldo iniziale è obbligatorio: è il punto zero di tutto il resto");
    await setOpeningBalance(Number(opening.amount), opening.date);
    setStep(1);
  });
  const addRule = () => wrap(async () => {
    if (!rule.description || !rule.amount || !rule.category) throw new Error("Compila descrizione, importo e categoria");
    await createRule({
      type: rule.type, amount: Number(rule.amount), category: rule.category, method: "TRANSFER",
      description: rule.description, frequency: "MONTHLY",
      dayOfMonth: rule.dayOfMonth === "" ? null : Number(rule.dayOfMonth),
      startDate: new Date().toISOString(), autoPost: true,
    });
    setRule({ type: "EXPENSE", description: "", amount: "", dayOfMonth: "", category: "" });
  });
  const saveTax = () => wrap(async () => {
    if (hasVat && taxPct !== "") {
      await saveFiscalProfile({ ...(fiscalProfile || {}), regime: fiscalProfile?.regime || "FORFETTARIO", defaultTaxPercent: Number(taxPct) });
    }
    // "Già accantonato per le tasse": fondo iniziale personale (reversibile da Tesoreria).
    if (hasVat && taxOpening !== "" && Number(taxOpening) > 0) {
      await api.put("/api/tax-savings/opening", { amount: Number(taxOpening) });
    }
    setStep(4);
  });
  const addGoal = () => wrap(async () => {
    if (!goal.name || !goal.amount || !goal.date) throw new Error("Compila nome, importo e data");
    await createGoal({ kind: "GOAL", name: goal.name, targetAmount: Number(goal.amount), targetDate: goal.date, icon: "🎯" });
    setGoal({ name: "", amount: "", date: "" });
  });
  const goalQuota = goal.amount && goal.date ? Number(goal.amount) / Math.max(1, Math.ceil(dayjs(goal.date).diff(dayjs(), "day") / 30.4375)) : null;

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(household.inviteCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* http non sicuro */ }
  };

  const monthlyFixed = rules.filter((r) => r.active && r.type === "EXPENSE").reduce((s, r) => s + r.monthlyEquivalent, 0);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="sr-only">Punto zero</h1>
        {step > 0 && <button onClick={finish} className="text-sm text-ink-600 hover:text-ink-900">Salta</button>}
      </div>
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} style={{ minHeight: 0, minWidth: 0 }} className={`flex-1 h-1.5 rounded-full ${i <= step ? "bg-brand-600" : "bg-card-line"}`} title={s} aria-label={s} />
        ))}
      </div>
      <div className="text-xs text-ink-400">Passo {step + 1} di {STEPS.length} · {STEPS[step]}</div>
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded p-2">{error}</div>}

      {step === 0 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Quanto c'è sul conto oggi? <span className="text-[13px] font-normal text-ink-400">(obbligatorio)</span></h2>
          <p className="text-sm text-ink-600">Il saldo che vedi in banca adesso. I movimenti di oggi sono già compresi; da domani l'app aggiunge le entrate e toglie le uscite che registri.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-600 mb-1">Saldo €</label>
              <input type="number" step="0.01" value={opening.amount} onChange={(e) => setOpening((o) => ({ ...o, amount: e.target.value }))} placeholder="es. 2500" className="w-full px-2 py-2 border border-card-line rounded nums" />
            </div>
            <div>
              <label className="block text-xs text-ink-600 mb-1">Alla data</label>
              <input type="date" value={opening.date} onChange={(e) => setOpening((o) => ({ ...o, date: e.target.value }))} className="w-full px-2 py-2 border border-card-line rounded" />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={saveOpening} disabled={busy || opening.amount === ""} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">Avanti</button>
          </div>
          {household?.openingBalance != null && (
            <details className="border-t border-card-line pt-3">
              <summary className="text-sm text-brand-600 cursor-pointer min-h-[44px] flex items-center">Hai più di un conto (es. stipendi e mutuo)? Aggiungilo qui</summary>
              <div className="mt-2"><AccountsManager compact /></div>
            </details>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Hai l'estratto conto? <span className="text-[13px] font-normal text-ink-400">(facoltativo)</span></h2>
          <p className="text-sm text-ink-600">
            Scaricalo dalla tua banca in PDF, Excel, XML o CSV e caricalo: l'app legge i movimenti, propone le categorie e riconosce le spese che si ripetono ogni mese.
          </p>
          <p className="text-xs text-ink-400">
            I movimenti precedenti alla data del saldo iniziale servono solo per le analisi e le ricorrenze: il saldo non cambia.
          </p>
          <div className="flex justify-between">
            <button onClick={() => navigate("/import?from=onboarding")} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">Carica estratto conto</button>
            <button onClick={() => setStep(2)} className="px-4 py-2 border border-card-line rounded text-ink-600">Non ora</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Le spese fisse che conosci</h2>
          <p className="text-sm text-ink-600">Rata, affitto, internet, abbonamenti: l'app le registrerà da sola ogni mese e le toglierà dal disponibile.</p>
          {rules.length > 0 && (
            <ul className="text-sm divide-y divide-card-line">
              {rules.map((r) => (
                <li key={r.id} className="py-1.5 flex justify-between"><span>{r.description || r.category} <span className="text-ink-400 text-xs">il {r.dayOfMonth ?? dayjs(r.startDate).date()}</span></span><span className="nums">{r.type === "INCOME" ? "+" : "−"}{eur(r.amount)}</span></li>
              ))}
              <li className="py-1.5 flex justify-between text-xs text-ink-600"><span>Fisse al mese</span><span className="nums font-semibold">{eur(monthlyFixed)}</span></li>
            </ul>
          )}
          <Segmented size="sm" value={rule.type} onChange={(v) => setRule((r) => ({ ...r, type: v, category: "" }))} options={[{ value: "EXPENSE", label: "Uscita" }, { value: "INCOME", label: "Entrata" }]} />
          <div className="grid grid-cols-3 gap-2">
            <input type="text" placeholder="Descrizione" value={rule.description} onChange={(e) => setRule((r) => ({ ...r, description: e.target.value }))} className="col-span-3 sm:col-span-1 px-2 py-2 border border-card-line rounded" />
            <input type="number" step="0.01" placeholder="Importo €" value={rule.amount} onChange={(e) => setRule((r) => ({ ...r, amount: e.target.value }))} className="px-2 py-2 border border-card-line rounded nums" />
            <input type="number" min="1" max="31" placeholder="Giorno" value={rule.dayOfMonth} onChange={(e) => setRule((r) => ({ ...r, dayOfMonth: e.target.value }))} className="px-2 py-2 border border-card-line rounded nums" />
          </div>
          <Segmented size="sm" value={rule.category} onChange={(v) => setRule((r) => ({ ...r, category: v }))} options={CATEGORIES[rule.type].map((c) => ({ value: c, label: c }))} />
          <div className="flex justify-between">
            <button onClick={addRule} disabled={busy} className="px-4 py-2 border border-card-line rounded text-ink-600 disabled:opacity-50">+ Aggiungi</button>
            <button onClick={() => setStep(3)} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">Avanti</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Hai la Partita IVA?</h2>
          <p className="text-sm text-ink-600">Se sì, su ogni entrata l'app mette da parte una % per le tasse in un salvadanaio personale. Ogni membro imposta la propria.</p>
          <Segmented value={hasVat} onChange={setHasVat} options={[{ value: true, label: "Sì" }, { value: false, label: "No" }]} />
          {hasVat && (
            <div>
              <label className="block text-xs text-ink-600 mb-1">% da accantonare su ogni entrata</label>
              <input type="number" min="0" max="100" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} placeholder="es. 30" className="w-40 px-2 py-2 border border-card-line rounded nums" />
              <p className="text-[11px] text-ink-400 mt-1">In Tesoreria puoi affinare regime, coefficiente e aliquote: l'app ti dirà la % minima consigliata.</p>
              <label className="block text-xs text-ink-600 mb-1 mt-3">Già accantonato per le tasse (facoltativo)</label>
              <input type="number" min="0" step="0.01" value={taxOpening} onChange={(e) => setTaxOpening(e.target.value)} placeholder="es. 3000" className="w-40 px-2 py-2 border border-card-line rounded nums" />
              <p className="text-[11px] text-ink-400 mt-1">Soldi già messi da parte per le tasse e compresi nel saldo iniziale: partono nel fondo tasse fin da subito.</p>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={saveTax} disabled={busy || hasVat === null} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50">Avanti</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Un primo obiettivo</h2>
          <p className="text-sm text-ink-600">Dimmi cosa vuoi e quando: ti dico quanto mettere via ogni mese.</p>
          {goals.length > 0 && (
            <ul className="text-sm divide-y divide-card-line">
              {goals.map((g) => <li key={g.id} className="py-1.5 flex justify-between"><span>{g.icon} {g.name}</span><span className="nums text-ink-600">{g.monthlyQuota != null ? `${eur(g.monthlyQuota)}/mese` : eur(g.target)}</span></li>)}
            </ul>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input type="text" placeholder="Es. Vacanze" value={goal.name} onChange={(e) => setGoal((g) => ({ ...g, name: e.target.value }))} className="col-span-3 sm:col-span-1 px-2 py-2 border border-card-line rounded" />
            <input type="number" step="0.01" placeholder="Importo €" value={goal.amount} onChange={(e) => setGoal((g) => ({ ...g, amount: e.target.value }))} className="px-2 py-2 border border-card-line rounded nums" />
            <input type="date" value={goal.date} onChange={(e) => setGoal((g) => ({ ...g, date: e.target.value }))} className="px-2 py-2 border border-card-line rounded" />
          </div>
          {goalQuota != null && Number.isFinite(goalQuota) && (
            <div className="bg-brand-50 rounded-xl p-3 text-sm text-brand-700 font-semibold">Servono circa {eur(goalQuota)} al mese</div>
          )}
          <div className="flex justify-between">
            <button onClick={addGoal} disabled={busy} className="px-4 py-2 border border-card-line rounded text-ink-600 disabled:opacity-50">+ Aggiungi</button>
            <button onClick={() => setStep(5)} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">Avanti</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold">Invita il partner</h2>
          <p className="text-sm text-ink-600">Con questo codice entra nella famiglia <strong>{household?.name}</strong>: vedrete le stesse spese, entrate e obiettivi. Il salvadanaio tasse resta personale.</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg tracking-widest bg-paper rounded px-3 py-2 nums">{household?.inviteCode}</span>
            <button onClick={copyInvite} className="px-3 py-2 text-sm bg-paper rounded hover:bg-brand-50">{copied ? "Copiato ✓" : "Copia"}</button>
          </div>
          {household?.members?.length > 1 && <p className="text-xs text-ink-400">Già in famiglia: {household.members.filter((m) => m.id !== user?.id).map((m) => m.name).join(", ")}</p>}
          <div className="flex justify-end">
            <button onClick={finish} className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700">Vai alla Dashboard</button>
          </div>
        </div>
      )}
    </div>
  );
}
