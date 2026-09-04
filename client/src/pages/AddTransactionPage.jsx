import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import { CATEGORIES, PAY_METHODS, PAY_METHOD_LABELS } from "../lib/constants.js";
import Segmented from "../components/Segmented.jsx";
import AccountPicker from "../components/AccountPicker.jsx";
import RecurrenceFields, { emptyRecurrence, recurrenceToPayload } from "../components/RecurrenceFields.jsx";
import AllocateModal from "../components/AllocateModal.jsx";
import { useTransactionStore } from "../store/transactionStore.js";
import { useRecurringStore } from "../store/recurringStore.js";
import { useGoalStore } from "../store/goalStore.js";
import { useTreasuryStore } from "../store/treasuryStore.js";
import { useAccountStore } from "../store/accountStore.js";

// Nuovo movimento a pagina intera (sostituisce la finestra): importo grande,
// poi "Dove" (negozio/venditore, con memoria dei negozi già usati: categoria,
// metodo e "Cosa" si precompilano), "Cosa" (cosa hai comprato), categoria,
// quando, conto e metodo. Le opzioni rare (ripeti, % tasse, nota) stanno in
// "Altre opzioni". Barra fissa in basso con Salva e "Salva e un'altra".

const today = () => dayjs().format("YYYY-MM-DD");

function Chips({ items, value, onPick, empty }) {
  if (!items.length) return empty ? <p className="text-[13px] text-ink-400">{empty}</p> : null;
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 snap-x">
      {items.map((it) => {
        const active = value && it.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={it}
            type="button"
            onClick={() => onPick(it)}
            className={`chip shrink-0 snap-start px-3.5 text-[13px] ${active ? "chip-active" : ""}`}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}

export default function AddTransactionPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addTransaction = useTransactionStore((s) => s.addTransaction);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const createRule = useRecurringStore((s) => s.createRule);
  const goals = useGoalStore((s) => s.goals);
  const goalsLoaded = useGoalStore((s) => s.loaded);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);
  const fiscalProfile = useTreasuryStore((s) => s.fiscalProfile);
  const fetchFiscalProfile = useTreasuryStore((s) => s.fetchFiscalProfile);
  const accounts = useAccountStore((s) => s.accounts);

  const [type, setType] = useState(params.get("type") === "income" ? "INCOME" : "EXPENSE");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [what, setWhat] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("CARD");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [more, setMore] = useState(false);
  const [showCategory, setShowCategory] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [recurrence, setRecurrence] = useState(emptyRecurrence);
  const [suggest, setSuggest] = useState({ merchants: [], recentWhats: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [allocateFor, setAllocateFor] = useState(null);
  const amountRef = useRef(null);

  useEffect(() => { amountRef.current?.focus(); }, []);
  useEffect(() => {
    api.get("/api/transactions/merchants", { params: { type } }).then(({ data }) => setSuggest(data)).catch(() => {});
  }, [type]);
  useEffect(() => { fetchFiscalProfile(); }, [fetchFiscalProfile]);
  useEffect(() => {
    if (type === "INCOME" && !goalsLoaded) fetchGoals().catch(() => {});
    if (type === "INCOME" && taxPercent === "" && fiscalProfile?.defaultTaxPercent != null) setTaxPercent(fiscalProfile.defaultTaxPercent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, fiscalProfile]);
  const hasGoals = goals.some((g) => g.active && g.status !== "DONE");

  // Suggerimenti "Dove"/"Cosa": stessa voce per la stessa cosa. Una voce già usata
  // viene proposta se contiene ciò che scrivi O se condivide una parola (3+ lettere)
  // con quello che scrivi: "acquisto sigarette" propone "sigarette".
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9àèéìòù]+/).filter((w) => w.length >= 3);
  const similar = (q, cand) => {
    const ql = q.toLowerCase();
    const cl = cand.toLowerCase();
    if (cl.includes(ql) || ql.includes(cl)) return true;
    const qw = words(ql);
    const cw = words(cl);
    return qw.some((w) => cw.some((c) => c.startsWith(w) || w.startsWith(c)));
  };
  const merchantMatches = useMemo(() => {
    const q = merchant.trim();
    const list = suggest.merchants.map((m) => m.merchant);
    if (!q) return list.slice(0, 12);
    return list.filter((m) => similar(q, m)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant, suggest]);
  const known = useMemo(() => suggest.merchants.find((m) => m.merchant.toLowerCase() === merchant.trim().toLowerCase()) || null, [merchant, suggest]);
  // "Intendevi ...?": voce esistente simile ma non identica a quello che hai scritto.
  const merchantHint = useMemo(() => {
    const q = merchant.trim();
    if (!q || known) return null;
    return merchantMatches.find((m) => m.toLowerCase() !== q.toLowerCase()) || null;
  }, [merchant, known, merchantMatches]);
  const whatMatches = useMemo(() => {
    const q = what.trim();
    const base = [...(known?.whats || []), ...suggest.recentWhats];
    const uniq = [...new Map(base.map((w) => [w.toLowerCase(), w])).values()];
    return (q ? uniq.filter((w) => similar(q, w)) : uniq).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what, known, suggest]);
  const whatHint = useMemo(() => {
    const q = what.trim();
    if (!q) return null;
    if (whatMatches.some((w) => w.toLowerCase() === q.toLowerCase())) return null;
    return whatMatches[0] || null;
  }, [what, whatMatches]);

  // Scegliere un negozio conosciuto precompila categoria e metodo (se non già scelti a mano).
  const pickMerchant = (m) => {
    setMerchant(m);
    const k = suggest.merchants.find((x) => x.merchant.toLowerCase() === m.toLowerCase());
    if (k) {
      if (k.category && CATEGORIES[type].includes(k.category)) setCategory(k.category);
      if (k.method && PAY_METHODS.includes(k.method)) setMethod(k.method);
    }
  };

  const amountNum = Number(String(amount).replace(",", "."));
  const valid = Number.isFinite(amountNum) && amountNum > 0 && category;

  const reset = () => {
    setAmount(""); setMerchant(""); setWhat(""); setCategory(""); setNote(""); setRepeat(false); setRecurrence(emptyRecurrence);
    setDate(today());
    amountRef.current?.focus();
  };

  const save = async (again) => {
    setError("");
    if (!Number.isFinite(amountNum) || amountNum <= 0) return setError("Inserisci l'importo");
    if (!category) return setError("Scegli una categoria");
    setSaving(true);
    const payload = {
      amount: amountNum,
      type,
      category,
      method,
      merchant: merchant.trim() || null,
      what: what.trim() || null,
      description: note.trim() || null,
      date: new Date(date).toISOString(),
      taxPercent: type === "INCOME" && taxPercent !== "" ? Number(taxPercent) : null,
      accountId: accountId || null,
    };
    try {
      if (repeat) {
        await createRule({
          type, amount: amountNum, category, method,
          description: [payload.merchant, payload.what].filter(Boolean).join(" · ") || payload.description,
          accountId: payload.accountId, startDate: payload.date, postFirst: true,
          ...recurrenceToPayload(recurrence),
        });
        await fetchTransactions();
      } else {
        const created = await addTransaction(payload);
        if (type === "INCOME" && hasGoals && created?.id) { setAllocateFor(created.id); setSaving(false); return; }
      }
      api.get("/api/transactions/merchants", { params: { type } }).then(({ data }) => setSuggest(data)).catch(() => {});
      if (again) {
        setToast(`Salvata: ${eur(amountNum)}${payload.merchant ? ` · ${payload.merchant}` : ""}`);
        setTimeout(() => setToast(""), 2500);
        reset();
        setSaving(false);
      } else {
        navigate(-1);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Salvataggio non riuscito");
      setSaving(false);
    }
  };

  if (allocateFor) return <AllocateModal incomeTransactionId={allocateFor} onClose={() => navigate(-1)} />;

  const isExpense = type === "EXPENSE";
  const dateChip = date === today() ? "today" : date === dayjs().subtract(1, "day").format("YYYY-MM-DD") ? "yesterday" : "other";

  return (
    <div className="space-y-5 -mb-4">
      <h1 className="sr-only">Nuovo movimento</h1>
      {toast && <div className="text-sm text-brand-700 bg-brand-50 rounded-lg p-2">{toast}</div>}
      {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg p-2">{error}</div>}

      <Segmented
        value={type}
        onChange={(v) => { setType(v); setCategory(""); }}
        options={[{ value: "EXPENSE", label: "Uscita" }, { value: "INCOME", label: "Entrata" }]}
        className="[&>button]:flex-1"
      />

      {/* Importo grande */}
      <div className="card p-4">
        <label className="block text-xs text-ink-600 mb-1">Importo</label>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${isExpense ? "text-ink-400" : "text-brand-600"}`}>{isExpense ? "−" : "+"}</span>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            className="flex-1 min-w-0 text-4xl font-bold nums bg-transparent outline-none placeholder:text-ink-400/50"
            aria-label="Importo in euro"
          />
          <span className="text-2xl text-ink-400">€</span>
        </div>
        {isExpense && (
          <button type="button" onClick={() => navigate("/ocr")} className="mt-2 text-[13px] text-brand-600 min-h-[44px] flex items-center">
            📷 Ho lo scontrino: fotografalo e leggi i prodotti
          </button>
        )}
      </div>

      {/* Dove */}
      <div className="card p-4 space-y-2">
        <label className="block text-xs text-ink-600">{isExpense ? "Dove (negozio, sito, chi hai pagato)" : "Da chi (cliente, datore, ente)"}</label>
        {/* Prima le scorciatoie: un tocco su un negozio noto compila anche categoria e metodo */}
        <Chips items={merchantMatches} value={merchant} onPick={pickMerchant} empty={suggest.merchants.length ? null : "I negozi che usi compariranno qui come scorciatoie."} />
        <input
          type="text"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          placeholder={isExpense ? "oppure scrivi: Amazon, Conad…" : "es. PICS SRL, INPS"}
          className="w-full px-3 py-2 border border-card-line rounded-lg min-h-[44px]"
          autoCapitalize="words"
        />
        {merchantHint && (
          <button type="button" onClick={() => pickMerchant(merchantHint)} className="w-full text-left min-h-[44px] px-3 rounded-lg bg-tax-50 text-tax-600 text-[13px]">
            Intendevi <span className="font-semibold">{merchantHint}</span>? Tocca per usare la stessa voce.
          </button>
        )}
        {known && <p className="text-[13px] text-ink-400">{known.count} {known.count === 1 ? "volta" : "volte"} · in tutto {eur(known.total)}{known.category ? ` · di solito ${known.category}` : ""}</p>}
      </div>

      {/* Cosa */}
      <div className="card p-4 space-y-2">
        <label className="block text-xs text-ink-600">{isExpense ? "Cosa hai comprato" : "Per cosa"}</label>
        <input
          type="text"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder={isExpense ? "es. cuffie, spesa settimanale, regalo Mia" : "es. fattura n. 12, stipendio agosto"}
          className="w-full px-3 py-2 border border-card-line rounded-lg min-h-[44px]"
        />
        {whatHint && (
          <button type="button" onClick={() => setWhat(whatHint)} className="w-full text-left min-h-[44px] px-3 rounded-lg bg-tax-50 text-tax-600 text-[13px]">
            Intendevi <span className="font-semibold">{whatHint}</span>? Tocca per usare la stessa voce.
          </button>
        )}
        <Chips items={whatMatches} value={what} onPick={setWhat} />
      </div>

      {/* Categoria: compatta quando è già suggerita dal negozio, tocca per cambiarla */}
      {category && known?.category === category && !showCategory ? (
        <button type="button" onClick={() => setShowCategory(true)} className="card card-tap w-full text-left p-4 flex items-center justify-between gap-3">
          <span><span className="block text-xs text-ink-600">Categoria</span><span className="font-medium">{category}</span> <span className="text-[13px] text-ink-400">· come le altre volte da {known.merchant}</span></span>
          <span className="text-brand-600 text-[13px] font-medium shrink-0">Cambia</span>
        </button>
      ) : (
        <div className="card p-4">
          <label className="block text-xs text-ink-600 mb-2">Categoria</label>
          <Segmented size="sm" value={category} onChange={(c) => { setCategory(c); setShowCategory(false); }} options={CATEGORIES[type].map((c) => ({ value: c, label: c }))} />
        </div>
      )}

      {/* Quando */}
      <div className="card p-4">
        <label className="block text-xs text-ink-600 mb-2">Quando</label>
        <div className="flex flex-wrap items-center gap-1.5">
          <Segmented
            size="sm"
            value={dateChip}
            onChange={(v) => { if (v === "today") setDate(today()); else if (v === "yesterday") setDate(dayjs().subtract(1, "day").format("YYYY-MM-DD")); }}
            options={[{ value: "today", label: "Oggi" }, { value: "yesterday", label: "Ieri" }, { value: "other", label: dateChip === "other" ? dayjs(date).format("D MMM YYYY") : "Altra data" }]}
          />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-2 border border-card-line rounded-lg min-h-[44px]" aria-label="Data" />
        </div>
      </div>

      {/* Conto e metodo */}
      <div className="card p-4 space-y-3">
        {accounts.length > 1 && <AccountPicker value={accountId} onChange={setAccountId} label={isExpense ? "Da quale conto" : "Su quale conto"} />}
        {accounts.length <= 1 && <AccountPicker value={accountId} onChange={setAccountId} />}
        <div>
          <label className="block text-xs text-ink-600 mb-1">Metodo</label>
          <Segmented size="sm" value={method} onChange={setMethod} options={PAY_METHODS.map((m) => ({ value: m, label: PAY_METHOD_LABELS[m] }))} />
        </div>
      </div>

      {/* Altre opzioni */}
      <div className="card p-4">
        <button type="button" onClick={() => setMore((o) => !o)} className="w-full min-h-[44px] flex items-center justify-between text-sm font-medium" aria-expanded={more}>
          <span>Altre opzioni {repeat && <span className="text-brand-600 font-normal">· si ripete</span>}{type === "INCOME" && taxPercent !== "" && <span className="text-tax-600 font-normal"> · {taxPercent}% tasse</span>}</span>
          <span className="text-ink-400">{more ? "▴" : "▾"}</span>
        </button>
        {more && (
          <div className="space-y-3 mt-2">
            {type === "INCOME" && (
              <div>
                <label className="block text-xs text-ink-600 mb-1">% da accantonare per le tasse</label>
                <input type="number" min="0" max="100" step="0.5" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} placeholder="es. 30" className="w-32 px-2 py-2 border border-card-line rounded-lg nums min-h-[44px]" />
              </div>
            )}
            <div>
              <label className="block text-xs text-ink-600 mb-1">Nota</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="facoltativa" className="w-full px-3 py-2 border border-card-line rounded-lg min-h-[44px]" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Si ripete</span>
              <Segmented size="sm" value={repeat} onChange={setRepeat} options={[{ value: false, label: "No" }, { value: true, label: "Sì" }]} />
            </div>
            {repeat && <RecurrenceFields value={recurrence} onChange={setRecurrence} startDate={date} amount={amount} onStartDateChange={setDate} />}
          </div>
        )}
      </div>

      {/* Barra Salva: sticky in fondo all'area scorrevole (resta visibile anche con la tastiera aperta) */}
      <div className="sticky bottom-0 z-30 -mx-4 action-bar px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="min-w-0 flex-1 text-[13px] text-ink-600 truncate">
            <span className={`font-semibold nums ${isExpense ? "text-ink-900" : "text-brand-600"}`}>{isExpense ? "−" : "+"}{eur(Number.isFinite(amountNum) ? amountNum : 0)}</span>
            {merchant && <> · {merchant}</>}{what && <> · {what}</>}{category && <> · {category}</>}
          </div>
          <button type="button" onClick={() => save(true)} disabled={saving || !valid} className="btn btn-secondary px-3 text-[13px]">+ un'altra</button>
          <button type="button" onClick={() => save(false)} disabled={saving || !valid} className="btn btn-primary">{saving ? "…" : "Salva"}</button>
        </div>
      </div>
    </div>
  );
}
