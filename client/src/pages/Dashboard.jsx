import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useTransactionStore } from "../store/transactionStore.js";
import { useTaxStore } from "../store/taxStore.js";
import { useAuthStore } from "../store/authStore.js";
import api from "../lib/api.js";
import { eur } from "../lib/format.js";
import { PAY_METHOD_LABELS } from "../lib/constants.js";
import NotificationsToggle from "../components/NotificationsToggle.jsx";
import { useGoalStore } from "../store/goalStore.js";

// Lazy: recharts (~150KB) esce dal bundle iniziale; il grafico appare al mount.
const BalanceTrendChart = lazy(() => import("../components/BalanceTrendChart.jsx"));

const now = new Date();
const MONTH = now.getMonth() + 1;
const YEAR = now.getFullYear();
const MONTH_NAME = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(now);

// Previous calendar month (handles January → December rollover).
const prevDate = new Date(YEAR, MONTH - 2, 1);
const PREV_MONTH = prevDate.getMonth() + 1;
const PREV_YEAR = prevDate.getFullYear();

// Percentage change current vs previous. null = no baseline (prev was 0).
function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / prev) * 100;
}

// Colored arrow + percentage. goodWhenUp flips the green/red meaning.
function Delta({ value, goodWhenUp }) {
  if (value == null) return <span className="text-ink-400">n.d.</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const color = flat ? "text-ink-400" : up === goodWhenUp ? "text-brand-600" : "text-rose-600";
  const arrow = flat ? "→" : up ? "▲" : "▼";
  return <span className={`${color} font-medium nums`}>{arrow} {Math.abs(value).toFixed(0)}%</span>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { transactions, fetchTransactions } = useTransactionStore();
  const { summary, fetchSummary } = useTaxStore();
  const user = useAuthStore((s) => s.user);
  const goalSummary = useGoalStore((s) => s.summary);
  const fetchGoals = useGoalStore((s) => s.fetchGoals);
  useEffect(() => { fetchGoals().catch(() => {}); }, [fetchGoals]);
  // Previous month totals, fetched separately so the store keeps the current month.
  const [prev, setPrev] = useState(null);
  // Prossima scadenza fiscale entro 60 giorni (incluse quelle scadute).
  const [nextDeadline, setNextDeadline] = useState(null);
  // Fatture emesse in attesa d'incasso (null = nessuna).
  const [incoming, setIncoming] = useState(null);
  // Banner verifica email: "sent" dopo il reinvio.
  const [resendState, setResendState] = useState("idle");
  // Disponibile reale (saldo − tasse pending − obiettivi − fisse residue − prestiti).
  const [avail, setAvail] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  useEffect(() => {
    api.get("/api/dashboard/available").then(({ data }) => setAvail(data)).catch(() => setAvail(null));
  }, [transactions]);
  // Primo accesso: nessun punto zero e nessuna transazione → wizard "Punto zero" (una volta sola).
  useEffect(() => {
    if (!avail || avail.hasOpeningBalance || transactions.length > 0 || avail.balance !== 0) return;
    let seen = "1";
    try { seen = localStorage.getItem("onboardingSeen"); } catch { /* storage non disponibile */ }
    if (!seen) navigate("/onboarding");
  }, [avail, transactions, navigate]);

  useEffect(() => {
    fetchTransactions({ month: MONTH, year: YEAR });
    fetchSummary();
  }, [fetchTransactions, fetchSummary]);

  useEffect(() => {
    api
      .get("/api/transactions", { params: { month: PREV_MONTH, year: PREV_YEAR } })
      .then(({ data }) => {
        let income = 0, expense = 0, tax = 0;
        for (const t of data) {
          if (t.type === "INCOME") { income += t.amount; tax += t.taxAmount || 0; }
          else { expense += t.amount; }
        }
        setPrev({ income, expense, tax });
      })
      .catch(() => setPrev(null));
  }, []);

  useEffect(() => {
    api
      .get("/api/treasury/expected-collections")
      .then(({ data }) => setIncoming(data))
      .catch(() => setIncoming(null));
  }, []);

  useEffect(() => {
    api
      .get("/api/deadlines", { params: { includePaid: "false" } })
      .then(({ data }) => {
        const upcoming = data.find((d) => d.daysUntil <= 60);
        setNextDeadline(upcoming || null);
      })
      .catch(() => setNextDeadline(null));
  }, []);

  const { income, expense, taxSetAside } = useMemo(() => {
    let income = 0, expense = 0, taxSetAside = 0;
    for (const t of transactions) {
      if (t.type === "INCOME") {
        income += t.amount;
        // Tasse accantonate da questa entrata: non sono soldi spendibili.
        taxSetAside += t.taxAmount || 0;
      } else {
        expense += t.amount;
      }
    }
    return { income, expense, taxSetAside };
  }, [transactions]);

  // Saldo spendibile: le tasse accantonate sono escluse (non sono soldi miei).
  const saldo = income - expense - taxSetAside;
  const max = Math.max(income, expense, 1);
  const recent = transactions.slice(0, 5);

  // Previsione spesa a fine mese: media giornaliera × giorni del mese.
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(YEAR, MONTH, 0).getDate();
  const avgDailyExpense = dayOfMonth > 0 ? expense / dayOfMonth : 0;
  const forecastExpense = avgDailyExpense * daysInMonth;

  return (
    <div className="space-y-4">
      {/* Banner verifica email (non bloccante). Solo quando il flag è presente e false. */}
      {user?.emailVerified === false && (
        <div className="bg-tax-50 text-tax-600 rounded-xl p-3 text-sm flex items-center justify-between gap-3">
          <span>✉ Conferma la tua email: controlla la posta ({user.email}).</span>
          <button
            type="button"
            disabled={resendState !== "idle"}
            className="shrink-0 text-xs font-semibold underline disabled:opacity-50"
            onClick={async () => {
              setResendState("sending");
              try {
                await api.post("/api/auth/resend-verification");
                setResendState("sent");
              } catch {
                setResendState("idle");
              }
            }}
          >
            {resendState === "sent" ? "Inviata ✓" : resendState === "sending" ? "Invio…" : "Reinvia"}
          </button>
        </div>
      )}

      <NotificationsToggle />

      {/* Hero: Disponibile reale (tap → breakdown). Colore: verde / giallo (< 20% delle fisse) / rosso (< 0) */}
      <div className={`text-white rounded-2xl p-6 shadow-sm ${
        avail?.status === "NEGATIVE" ? "bg-rose-600" : avail?.status === "LOW" ? "bg-tax-600" : "bg-brand-600"
      }`}>
        <button type="button" onClick={() => setShowBreakdown((v) => !v)} className="text-left w-full">
          <div className="text-[11px] uppercase tracking-widest text-white/70">
            Disponibile reale {avail ? "· tocca per il dettaglio" : ""}
          </div>
          <div className="text-4xl sm:text-5xl font-bold tracking-tight mt-1 nums">
            {eur(avail ? avail.available : saldo)}
          </div>
          {avail && (
            <div className="text-sm text-white/75 mt-1 nums">
              Saldo effettivo {eur(avail.balance)}
              {!avail.hasOpeningBalance && (
                <span className="text-white/60"> · imposta il saldo iniziale in Impostazioni</span>
              )}
            </div>
          )}
        </button>
        {showBreakdown && avail && (
          <ul className="mt-3 bg-white/10 rounded-xl p-3 text-sm space-y-1">
            {avail.breakdown.map((b) => (
              <li key={b.key} className="flex justify-between gap-3">
                <span className="text-white/85">{b.label}</span>
                <span className="font-semibold nums">{b.sign < 0 ? "− " : ""}{eur(b.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-white/20 pt-1 mt-1">
              <span>Disponibile reale</span>
              <span className="font-bold nums">{eur(avail.available)}</span>
            </li>
            {avail.committedItems.length > 0 && (
              <li className="text-xs text-white/70 pt-1">
                Fisse in arrivo: {avail.committedItems.map((i) => `${i.description} ${dayjs(i.date).format("D/M")}`).join(", ")}
              </li>
            )}
          </ul>
        )}
        <div className="text-xs text-white/60 mt-3 uppercase tracking-widest">{MONTH_NAME}</div>
        <div className="flex gap-6 mt-4 text-sm text-white/85">
          <button
            type="button"
            className="text-left hover:text-white transition"
            onClick={() => navigate("/income")}
          >
            <span className="block text-xs text-white/60">Entrate</span>
            <span className="font-semibold nums">+ {eur(income)}</span>
          </button>
          <button
            type="button"
            className="text-left hover:text-white transition"
            onClick={() => navigate("/expenses")}
          >
            <span className="block text-xs text-white/60">Uscite</span>
            <span className="font-semibold nums">− {eur(expense)}</span>
          </button>
          {taxSetAside > 0 && (
            <div className="text-left">
              <span className="block text-xs text-white/60">Accantonate</span>
              <span className="font-semibold nums">{eur(taxSetAside)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Salvadanaio tasse: l'ambra è il suo colore riservato */}
      <button
        type="button"
        onClick={() => navigate("/tax-savings")}
        className="card w-full p-4 flex items-center justify-between hover:border-brand-200 transition text-left"
      >
        <div>
          <div className="text-sm text-ink-600">Salvadanaio tasse</div>
          <div className="text-lg font-bold text-tax-600 nums">{eur(summary?.totalPending)}</div>
        </div>
        {(summary?.totalPending ?? 0) > 0 && (
          <span className="text-[11px] font-semibold bg-tax-50 text-tax-600 px-2.5 py-1 rounded-full">
            Da trasferire
          </span>
        )}
      </button>

      {/* Obiettivi: soldi parcheggiati e quota del mese */}
      {goalSummary && goalSummary.count > 0 && (
        <button
          type="button"
          onClick={() => navigate("/goals")}
          className="card w-full p-4 flex items-center justify-between hover:border-brand-200 transition text-left"
        >
          <div>
            <div className="text-sm text-ink-600">Obiettivi · {eur(goalSummary.parked)} parcheggiati</div>
            <div className="text-xs text-ink-400 mt-0.5 nums">
              Quota del mese {eur(goalSummary.monthQuota)} · versati {eur(goalSummary.monthContributed)}
              {goalSummary.behind > 0 && <span className="text-rose-600 font-semibold"> · {goalSummary.behind} in ritardo</span>}
            </div>
          </div>
          <span className={`text-lg font-bold nums ${goalSummary.monthContributed >= goalSummary.monthQuota ? "text-brand-600" : "text-tax-600"}`}>
            {eur(Math.max(0, goalSummary.monthQuota - goalSummary.monthContributed))}
          </span>
        </button>
      )}

      {/* Incassi attesi: fatture emesse non ancora incassate */}
      {incoming && incoming.count > 0 && (
        <button
          type="button"
          onClick={() => navigate("/invoices")}
          className="card w-full p-4 flex items-center justify-between hover:border-brand-200 transition text-left"
        >
          <div>
            <div className="text-sm text-ink-600">
              In arrivo · {incoming.count} {incoming.count === 1 ? "fattura" : "fatture"}
            </div>
            <div className="text-xs text-ink-400 mt-0.5">
              Primo incasso stimato {dayjs(incoming.nextExpectedAt).format("D MMM")}
              {incoming.taxPercent > 0 && ` · netto accantonamento ${eur(incoming.net)}`}
            </div>
          </div>
          <span className="text-lg font-bold text-brand-600 nums">{eur(incoming.gross)}</span>
        </button>
      )}

      {/* Prossima scadenza fiscale (entro 60 giorni) */}
      {nextDeadline && (
        <button
          type="button"
          onClick={() => navigate("/treasury")}
          className="card w-full p-4 flex items-center justify-between hover:border-brand-200 transition text-left"
        >
          <div>
            <div className="text-sm text-ink-600">Prossima scadenza · {nextDeadline.name}</div>
            <div className={`text-xs mt-0.5 ${nextDeadline.overdue ? "text-rose-600 font-semibold" : "text-ink-400"}`}>
              {nextDeadline.overdue
                ? `Scaduta da ${Math.abs(nextDeadline.daysUntil)} giorni`
                : `Tra ${nextDeadline.daysUntil} giorni`}
            </div>
          </div>
          <span className={`text-lg font-bold nums ${nextDeadline.overdue ? "text-rose-600" : nextDeadline.daysUntil <= 30 ? "text-tax-600" : "text-ink-900"}`}>
            {eur(nextDeadline.expectedAmount)}
          </span>
        </button>
      )}

      {/* Confronto con il mese precedente */}
      {prev && (
        <div className="card p-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <div className="text-ink-400">Entrate vs mese prec.</div>
            <Delta value={pctChange(income, prev.income)} goodWhenUp />
          </div>
          <div>
            <div className="text-ink-400">Uscite vs mese prec.</div>
            <Delta value={pctChange(expense, prev.expense)} goodWhenUp={false} />
          </div>
          <div>
            <div className="text-ink-400">Tasse vs mese prec.</div>
            <Delta value={pctChange(taxSetAside, prev.tax)} goodWhenUp={false} />
          </div>
        </div>
      )}

      {/* Previsione spesa a fine mese */}
      <div className="card p-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-600">Previsione spesa fine mese</div>
          <div className="text-xs text-ink-400 mt-0.5 nums">
            Media {eur(avgDailyExpense)}/giorno · {dayOfMonth} di {daysInMonth} giorni
          </div>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-ink-900 nums">{eur(forecastExpense)}</div>
      </div>

      <Suspense fallback={<div className="card h-64 animate-pulse" />}>
        <BalanceTrendChart transactions={transactions} month={MONTH} year={YEAR} />
      </Suspense>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink-600 mb-3">Entrate vs Uscite</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-600">Entrate</span>
            <div className="flex-1 bg-paper rounded-full h-3">
              <div className="bg-brand-500 h-3 rounded-full" style={{ width: `${(income / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs nums">{eur(income)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-600">Uscite</span>
            <div className="flex-1 bg-paper rounded-full h-3">
              <div className="bg-ink-400 h-3 rounded-full" style={{ width: `${(expense / max) * 100}%` }} />
            </div>
            <span className="w-24 text-right text-xs nums">{eur(expense)}</span>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-ink-600 mb-3">Ultime transazioni</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-400">Nessuna transazione questo mese.</p>
        ) : (
          <ul className="divide-y divide-card-line">
            {recent.map((t) => (
              <li key={t.id} className="py-2.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{t.category}</span>
                  <span className="text-ink-400 ml-2">{PAY_METHOD_LABELS[t.method]}</span>
                  {t.recurringRuleId && <span className="text-brand-600 ml-2 text-xs" title="Ricorrente">↻</span>}
                  {t.user?.name && <span className="text-ink-400 ml-2 text-xs">· {t.user.name}</span>}
                </div>
                <span className={`font-semibold nums ${t.type === "INCOME" ? "text-brand-600" : "text-ink-900"}`}>
                  {t.type === "INCOME" ? "+ " : "− "}{eur(t.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
